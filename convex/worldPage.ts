import { ConvexError, v, type Infer } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { signedOwnerMutation } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { canonicalTagKey } from "./helpers";
import { buildR2PublicUrl, resolveAssetThumbUrl, resolveAssetUrl } from "./r2_url";
import { isShowcaseOwner, isWorldFolder } from "./showcase";
import { sectionKeyForTagName } from "../lib/collection-sections";

// ---------------------------------------------------------------------------
// The public world page (/w/<slug>): a pitch made of the world's pictures.
//
// Authless reads, slim rows. A tile carries what the grid and the lightbox
// draw and nothing else: no prompt, no tags, no folder list. Featured pieces
// (the curator star) come first in their own small list; the rest pages in
// newest first. Hidden, archived, reference and inspiration pieces never
// leave the server.
// ---------------------------------------------------------------------------

const SECTIONS = ["characters", "locations", "scenes"] as const;
type Section = (typeof SECTIONS)[number];
const sectionValidator = v.union(...SECTIONS.map((key) => v.literal(key)));

const tileValidator = v.object({
  id: v.id("assets"),
  kind: v.union(v.literal("image"), v.literal("video")),
  w: v.number(),
  h: v.number(),
  /** Grid picture: an image's thumbnail, a video's poster. */
  src: v.string(),
  /** "<url> <width>w, …", smallest first, for the tile srcset. */
  srcSet: v.optional(v.string()),
  /** Original file: full-res image or the video itself. */
  full: v.string(),
  section: v.optional(sectionValidator),
  featured: v.boolean(),
  /** Takes of one job share it, so the page can keep them apart. */
  group: v.optional(v.string()),
});
export type WorldTile = Infer<typeof tileValidator>;

const sideValidator = v.object({ key: v.string(), label: v.string() });

const HIDDEN_ROLES = new Set(["reference", "inspiration_capture", "bookmark"]);
// Starred pieces read to find a world's featured ones. Most are elsewhere in
// the vault; the cap bounds the read, not the reel.
const STAR_SCAN_LIMIT = 400;
const HERO_SCAN_LIMIT = 300;
const SHOWREEL_TAG = "showreel";

type WorldContext = {
  root: Doc<"folders">;
  side: { key: string; label: string; folder: Doc<"folders"> };
  sides: Array<{ key: string; label: string; folderId: Id<"folders"> }>;
  allMembers: boolean;
  /** Pieces the lead list places; the paged list skips them. */
  leadIds: Set<string>;
  sectionTags: Map<Id<"tags">, Section | "inspirations">;
};

/** Tag ids that say what a piece is, read once per call (ten index reads). */
const loadSectionTags = async (ctx: QueryCtx) => {
  const names = [
    "character", "characters", "location", "locations", "scene", "scenes",
    "still", "stills", "inspiration", "inspirations",
  ];
  const map = new Map<Id<"tags">, Section | "inspirations">();
  for (const name of names) {
    const key = canonicalTagKey(name);
    const tags = await ctx.db
      .query("tags")
      .withIndex("by_canonicalKey", (q) => q.eq("canonicalKey", key))
      .take(4);
    const section = sectionKeyForTagName(name);
    if (!section) continue;
    for (const tag of tags) map.set(tag._id, section);
  }
  return map;
};

const resolveWorld = async (
  ctx: QueryCtx,
  slug: string,
  sideKey: string | undefined,
): Promise<WorldContext | null> => {
  const key = slug.trim();
  if (!key) return null;
  const root = await ctx.db
    .query("folders")
    .withIndex("by_slug", (q) => q.eq("slug", key))
    .first();
  if (!root || root.showcased !== true) return null;
  if (!isShowcaseOwner(root.ownerUserId)) return null;
  if (!(await isWorldFolder(ctx, root))) return null;

  const configured = root.worldPage?.sides ?? [];
  const sides = configured.length
    ? configured
    : [{ key: "world", label: root.name, folderId: root._id }];
  const chosen = sides.find((side) => side.key === sideKey) ?? sides[0];
  const folder =
    chosen.folderId === root._id ? root : await ctx.db.get(chosen.folderId);
  // A side is the root or one of its universe siblings, owned by the same
  // owner. Anything else in the settings is ignored, never served.
  if (
    !folder ||
    (folder._id !== root._id && folder.universeRootId !== root._id) ||
    folder.ownerUserId !== root.ownerUserId
  ) {
    return null;
  }
  return {
    root,
    side: { key: chosen.key, label: chosen.label, folder },
    sides,
    allMembers:
      (folder.worldPage?.allMembers ?? root.worldPage?.allMembers) === true,
    leadIds: new Set(
      (folder._id === root._id ? root.worldPage?.leadAssetIds : folder.worldPage?.leadAssetIds) ?? [],
    ),
    sectionTags: await loadSectionTags(ctx),
  };
};

const sectionOf = (world: WorldContext, asset: Doc<"assets">) => {
  let section: Section | "inspirations" | undefined;
  for (const tagId of asset.tagIds) {
    const found = world.sectionTags.get(tagId);
    if (found === "inspirations") return "inspirations" as const;
    section ??= found;
  }
  return section;
};

const isArchived = async (ctx: QueryCtx, assetId: Id<"assets">) =>
  (await ctx.db
    .query("assetArchive")
    .withIndex("by_asset", (q) => q.eq("assetId", assetId))
    .first()) !== null;

/** The slim public row, or null when the piece must not be shown. */
const toTile = async (
  ctx: QueryCtx,
  world: WorldContext,
  asset: Doc<"assets"> | null,
): Promise<WorldTile | null> => {
  if (!asset || asset.worldPageHidden) return null;
  if (asset.ownerUserId !== world.root.ownerUserId) return null;
  if (asset.assetRole && HIDDEN_ROLES.has(asset.assetRole)) return null;
  if (!world.allMembers && asset.isPublic !== true) return null;
  const section = sectionOf(world, asset);
  if (section === "inspirations") return null;
  const [full, thumb] = await Promise.all([
    resolveAssetUrl(ctx, asset),
    resolveAssetThumbUrl(ctx, asset),
  ]);
  if (!full) return null;
  // A video without a poster has nothing to draw in the grid.
  const src = thumb ?? (asset.kind === "image" ? full : undefined);
  if (!src) return null;
  if (await isArchived(ctx, asset._id)) return null;

  const w = asset.width ?? asset.thumbWidth ?? 16;
  const h = asset.height ?? asset.thumbHeight ?? 9;
  const variants = (asset.thumbVariants ?? [])
    .flatMap((variant) => {
      const url = buildR2PublicUrl(variant.r2Key);
      return url ? [{ url, width: variant.width }] : [];
    })
    .sort((a, b) => a.width - b.width);
  if (thumb && asset.thumbWidth) variants.push({ url: thumb, width: asset.thumbWidth });
  return {
    id: asset._id,
    kind: asset.kind,
    w,
    h,
    src,
    srcSet: variants.length > 1
      ? variants.map((variant) => `${variant.url} ${variant.width}w`).join(", ")
      : undefined,
    full,
    ...(section ? { section } : {}),
    featured: Boolean(asset.starredAt),
    ...((asset.assetPackId ?? asset.promptId)
      ? { group: (asset.assetPackId ?? asset.promptId) as string }
      : {}),
  };
};

const isMemberOf = async (
  ctx: QueryCtx,
  assetId: Id<"assets">,
  folderId: Id<"folders">,
) =>
  (await ctx.db
    .query("assetFolders")
    .withIndex("by_asset_folder", (q) =>
      q.eq("assetId", assetId).eq("folderId", folderId),
    )
    .first()) !== null;

/** Featured members of the side, newest star first. */
const loadFeatured = async (ctx: QueryCtx, world: WorldContext) => {
  const starred: Doc<"assets">[] = [];
  for (const owner of resolveUserIdCandidates(world.root.ownerUserId ?? "")) {
    starred.push(
      ...(await ctx.db
        .query("assets")
        .withIndex("by_owner_starredAt", (q) =>
          q.eq("ownerUserId", owner).gt("starredAt", 0),
        )
        .order("desc")
        .take(STAR_SCAN_LIMIT)),
    );
  }
  starred.sort((a, b) => (b.starredAt ?? 0) - (a.starredAt ?? 0));
  const tiles: WorldTile[] = [];
  for (const asset of starred) {
    if (!(await isMemberOf(ctx, asset._id, world.side.folder._id))) continue;
    const tile = await toTile(ctx, world, asset);
    if (tile) tiles.push(tile);
  }
  return tiles;
};

/** The lead frames of the side, in the owner's order, minus featured ones. */
const loadLead = async (ctx: QueryCtx, world: WorldContext, featured: WorldTile[]) => {
  const featuredIds = new Set(featured.map((tile) => tile.id as string));
  const tiles: WorldTile[] = [];
  for (const id of world.leadIds) {
    if (featuredIds.has(id)) continue;
    const asset = await ctx.db.get(id as Id<"assets">);
    if (!asset || !(await isMemberOf(ctx, asset._id, world.side.folder._id))) continue;
    const tile = await toTile(ctx, world, asset);
    if (tile) tiles.push(tile);
  }
  return tiles;
};

/**
 * The hero film. In order: the reel pinned on the side or the world
 * (worldPage.heroReelAssetId), the newest member tagged showreel, a featured
 * video, the newest video. A hidden piece is never the hero.
 */
const loadHero = async (
  ctx: QueryCtx,
  world: WorldContext,
  featured: WorldTile[],
): Promise<WorldTile | null> => {
  const pinned =
    world.side.folder.worldPage?.heroReelAssetId ??
    world.root.worldPage?.heroReelAssetId;
  if (pinned) {
    const tile = await toTile(ctx, { ...world, allMembers: true }, await ctx.db.get(pinned));
    if (tile) return tile;
  }

  const reelTags = await ctx.db
    .query("tags")
    .withIndex("by_canonicalKey", (q) => q.eq("canonicalKey", canonicalTagKey(SHOWREEL_TAG)))
    .take(4);
  for (const tag of reelTags) {
    const links = await ctx.db
      .query("assetTags")
      .withIndex("by_tag_createdAt", (q) => q.eq("tagId", tag._id))
      .order("desc")
      .take(50);
    for (const link of links) {
      const asset = await ctx.db.get(link.assetId);
      if (asset?.kind !== "video") continue;
      if (
        !(await isMemberOf(ctx, asset._id, world.root._id)) &&
        !(await isMemberOf(ctx, asset._id, world.side.folder._id))
      )
        continue;
      const tile = await toTile(ctx, { ...world, allMembers: true }, asset);
      if (tile) return tile;
    }
  }

  const featuredVideo = featured.find((tile) => tile.kind === "video");
  if (featuredVideo) return featuredVideo;

  for (const folderId of [world.side.folder._id, world.root._id]) {
    const links = await ctx.db
      .query("assetFolders")
      .withIndex("by_folder_createdAt", (q) => q.eq("folderId", folderId))
      .order("desc")
      .take(HERO_SCAN_LIMIT);
    for (const link of links) {
      const asset = await ctx.db.get(link.assetId);
      if (asset?.kind !== "video") continue;
      const tile = await toTile(ctx, world, asset);
      if (tile) return tile;
    }
  }
  return featured[0] ?? null;
};

export const getWorldPage = query({
  args: { slug: v.string(), side: v.optional(v.string()) },
  returns: v.union(
    v.null(),
    v.object({
      folderId: v.id("folders"),
      slug: v.string(),
      name: v.string(),
      side: v.string(),
      sides: v.array(sideValidator),
      hero: v.union(v.null(), tileValidator),
      featured: v.array(tileValidator),
      lead: v.array(tileValidator),
    }),
  ),
  handler: async (ctx, args) => {
    const world = await resolveWorld(ctx, args.slug, args.side);
    if (!world) return null;
    const featured = await loadFeatured(ctx, world);
    // The reel belongs to the world, not the side: switching sides keeps it.
    const rootWorld =
      world.side.folder._id === world.root._id
        ? world
        : { ...world, side: { ...world.side, folder: world.root } };
    const hero = await loadHero(
      ctx,
      rootWorld,
      rootWorld === world ? featured : [],
    );
    return {
      folderId: world.root._id,
      slug: world.root.slug ?? args.slug,
      name: world.root.name,
      side: world.side.key,
      sides: world.sides.map(({ key, label }) => ({ key, label })),
      hero,
      featured,
      lead: await loadLead(ctx, world, featured),
    };
  },
});

/**
 * A side's frames, newest first, a page at a time. Lead frames are left out
 * (getWorldPage lists them, after the featured ones, which also come back
 * here; the page shows each frame once). A filtered page can come back
 * short or empty while `isDone` is false; the grid keeps asking.
 */
export const listWorldPage = query({
  args: {
    slug: v.string(),
    side: v.optional(v.string()),
    section: v.optional(sectionValidator),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(tileValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(
      v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null()),
    ),
  }),
  handler: async (ctx, args) => {
    const world = await resolveWorld(ctx, args.slug, args.side);
    if (!world) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db
      .query("assetFolders")
      .withIndex("by_folder_createdAt", (q) =>
        q.eq("folderId", world.side.folder._id),
      )
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(args.paginationOpts.numItems, 96),
      });
    const page: WorldTile[] = [];
    const seen = new Set<string>();
    for (const link of result.page) {
      if (seen.has(link.assetId)) continue;
      seen.add(link.assetId);
      const asset = await ctx.db.get(link.assetId);
      // Featured pieces stay in the stream too (the page drops the repeat):
      // a star older than the featured scan must never hide a frame.
      if (!asset || world.leadIds.has(asset._id)) continue;
      const tile = await toTile(ctx, world, asset);
      if (!tile) continue;
      if (args.section && tile.section !== args.section) continue;
      page.push(tile);
    }
    return {
      page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      splitCursor: result.splitCursor,
      pageStatus: result.pageStatus,
    };
  },
});

// --- Owner settings ---------------------------------------------------------

const requireOwnedFolder = async (
  ctx: { db: MutationCtx["db"] },
  ownerUserId: string,
  folderId: Id<"folders">,
) => {
  const folder = await ctx.db.get(folderId);
  if (!folder || !canActorAccessOwnerUserId(ownerUserId, folder.ownerUserId)) {
    throw new ConvexError("World not found.");
  }
  return folder;
};

const worldPageSettings = {
  allMembers: v.optional(v.boolean()),
  leadAssetIds: v.optional(v.array(v.id("assets"))),
  heroReelAssetId: v.optional(v.union(v.id("assets"), v.null())),
  sides: v.optional(
    v.array(v.object({ key: v.string(), label: v.string(), folderId: v.id("folders") })),
  ),
};

/** Change a world page's settings; omitted fields keep their value, null clears the reel. */
export const setWorldPageSettings = signedOwnerMutation({
  args: { ownerUserId: v.string(), folderId: v.id("folders"), ...worldPageSettings },
  returns: v.null(),
  handler: async (ctx, { ownerUserId, folderId, ...patch }) => {
    const folder = await requireOwnedFolder(ctx, ownerUserId, folderId);
    for (const side of patch.sides ?? []) {
      await requireOwnedFolder(ctx, ownerUserId, side.folderId);
    }
    await applyWorldPageSettings(ctx, folder, patch);
    return null;
  },
});

const applyWorldPageSettings = async (
  ctx: { db: MutationCtx["db"] },
  folder: Doc<"folders">,
  patch: {
    allMembers?: boolean;
    heroReelAssetId?: Id<"assets"> | null;
    leadAssetIds?: Id<"assets">[];
    sides?: Array<{ key: string; label: string; folderId: Id<"folders"> }>;
  },
) => {
  const current = folder.worldPage ?? {};
  const next = {
    ...current,
    ...(patch.allMembers !== undefined ? { allMembers: patch.allMembers } : {}),
    ...(patch.sides !== undefined ? { sides: patch.sides } : {}),
    ...(patch.leadAssetIds !== undefined ? { leadAssetIds: patch.leadAssetIds.slice(0, 200) } : {}),
  };
  if (patch.heroReelAssetId === null) delete next.heroReelAssetId;
  else if (patch.heroReelAssetId) next.heroReelAssetId = patch.heroReelAssetId;
  await ctx.db.patch(folder._id, { worldPage: next, updatedAt: Date.now() });
};

/** Show or hide pieces on public world pages. The vault is unaffected. */
export const setWorldPageHidden = signedOwnerMutation({
  args: {
    ownerUserId: v.string(),
    assetIds: v.array(v.id("assets")),
    hidden: v.boolean(),
    reason: v.optional(v.string()),
  },
  returns: v.number(),
  handler: async (ctx, { ownerUserId, assetIds, hidden, reason }) => {
    let changed = 0;
    for (const assetId of assetIds.slice(0, 500)) {
      const asset = await ctx.db.get(assetId);
      if (!asset || !canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) continue;
      changed += await patchHidden(ctx, asset, hidden, reason);
    }
    return changed;
  },
});

const patchHidden = async (
  ctx: { db: MutationCtx["db"] },
  asset: Doc<"assets">,
  hidden: boolean,
  reason: string | undefined,
) => {
  const nextReason = hidden ? reason?.trim().slice(0, 200) || undefined : undefined;
  if (Boolean(asset.worldPageHidden) === hidden && asset.worldPageHiddenReason === nextReason) {
    return 0;
  }
  await ctx.db.patch(asset._id, {
    worldPageHidden: hidden || undefined,
    worldPageHiddenReason: nextReason,
  });
  return 1;
};

// Operator twins for `convex run` (curation passes and setup, no browser).
export const curateInternal = internalMutation({
  args: {
    hide: v.array(v.object({ assetId: v.id("assets"), reason: v.string() })),
    show: v.optional(v.array(v.id("assets"))),
  },
  returns: v.object({ hidden: v.number(), shown: v.number() }),
  handler: async (ctx, { hide, show = [] }) => {
    let hidden = 0;
    let shown = 0;
    for (const entry of hide) {
      const asset = await ctx.db.get(entry.assetId);
      if (asset) hidden += await patchHidden(ctx, asset, true, entry.reason);
    }
    for (const assetId of show) {
      const asset = await ctx.db.get(assetId);
      if (asset) shown += await patchHidden(ctx, asset, false, undefined);
    }
    return { hidden, shown };
  },
});

export const configureInternal = internalMutation({
  args: { folderId: v.id("folders"), ...worldPageSettings },
  returns: v.null(),
  handler: async (ctx, { folderId, ...patch }) => {
    const folder = await ctx.db.get(folderId);
    if (!folder) throw new ConvexError("World not found.");
    await applyWorldPageSettings(ctx, folder, patch);
    return null;
  },
});
