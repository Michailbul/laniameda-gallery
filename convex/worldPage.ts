import { ConvexError, v, type Infer } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { signedOwnerMutation, signedOwnerQuery } from "./actor";
import { internal } from "./_generated/api";
import { HERO_RENDITION_WIDTH } from "../lib/topaz";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { canonicalTagKey } from "./helpers";
import { buildR2PublicUrl, resolveAssetThumbUrl, resolveAssetUrl } from "./r2_url";
import { isShowcaseOwner, isWorldFolder } from "./showcase";
import { worldsOfAsset } from "./worldCore";
import { sectionKeyForTagName } from "../lib/collection-sections";
import {
  HERO_INSERT_MAX,
  HERO_INSERT_MAX_FRAMES,
  editHeroInserts,
  normalizeHeroInserts,
  separateFilms,
} from "../lib/world-hero-inserts";

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
  /**
   * Admin view only: why the frame is not on the public page (dropped with
   * worldPageHidden, private on a world that shows public pieces only, or
   * tagged letterboxed). Public reads never carry it: those frames never
   * leave the server.
   */
  off: v.optional(v.union(v.literal("hidden"), v.literal("private"), v.literal("letterboxed"))),
});
export type WorldTile = Infer<typeof tileValidator>;

const sideValidator = v.object({ key: v.string(), label: v.string() });
/** A full-screen hero insert: one frame full bleed, two split, three a triptych. */
const insertValidator = v.object({ tiles: v.array(tileValidator) });
// Frames with burnt-in black bars (another agent tags them): they ruin a
// full-bleed wall, so the public page leaves them out.
const LETTERBOXED_TAG = "letterboxed";

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
  letterboxTags: Set<Id<"tags">>;
  /** The owner's admin view: every member, each marked with why it is off the public page. */
  admin: boolean;
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

const loadLetterboxTags = async (ctx: QueryCtx) =>
  new Set(
    (
      await ctx.db
        .query("tags")
        .withIndex("by_canonicalKey", (q) => q.eq("canonicalKey", canonicalTagKey(LETTERBOXED_TAG)))
        .take(4)
    ).map((tag) => tag._id),
  );

/**
 * The world behind /w/<slug>. Public: a showcased world of the showcase owner.
 * Admin (`adminOwnerUserId`, a signed owner): any world root of that owner,
 * published or not.
 */
const resolveWorld = async (
  ctx: QueryCtx,
  slug: string,
  sideKey: string | undefined,
  adminOwnerUserId?: string,
): Promise<WorldContext | null> => {
  const key = slug.trim();
  if (!key) return null;
  const roots = await ctx.db
    .query("folders")
    .withIndex("by_slug", (q) => q.eq("slug", key))
    .take(8);
  const root = adminOwnerUserId
    ? roots.find((folder) => canActorAccessOwnerUserId(adminOwnerUserId, folder.ownerUserId))
    : roots.find((folder) => folder.showcased === true);
  if (!root) return null;
  if (!adminOwnerUserId && !isShowcaseOwner(root.ownerUserId)) return null;
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
    letterboxTags: await loadLetterboxTags(ctx),
    admin: Boolean(adminOwnerUserId),
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
  /** A hero insert frame: its srcset also offers the high-resolution renditions. */
  hero = false,
): Promise<WorldTile | null> => {
  if (!asset) return null;
  if (asset.ownerUserId !== world.root.ownerUserId) return null;
  if (asset.assetRole && HIDDEN_ROLES.has(asset.assetRole)) return null;
  const section = sectionOf(world, asset);
  if (section === "inspirations") return null;
  const off = asset.worldPageHidden
    ? ("hidden" as const)
    : !world.allMembers && asset.isPublic !== true
      ? ("private" as const)
      : asset.tagIds.some((tagId) => world.letterboxTags.has(tagId))
        ? ("letterboxed" as const)
        : undefined;
  if (off && !world.admin) return null;
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
  // Large and retina screens pick these through the srcset; phones never do.
  if (hero && asset.kind === "image") {
    for (const variant of asset.heroRendition?.variants ?? []) {
      const url = buildR2PublicUrl(variant.r2Key);
      if (url) variants.push({ url, width: variant.width });
    }
  }
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
    ...(off ? { off } : {}),
  };
};

/** The folder and its child shelves, read once per query (one index range). */
const loadTree = async (ctx: QueryCtx, folderId: Id<"folders">) => {
  const children = await ctx.db
    .query("folders")
    .withIndex("by_parent", (q) => q.eq("parentFolderId", folderId))
    .collect();
  return new Set<string>([folderId, ...children.map((child) => child._id)]);
};

/**
 * In the world: linked to the folder itself or to one of its child shelves
 * (a reel filed on "Footage + Film" is still the world's reel). An asset has a
 * handful of links, so this is one small index range per asset.
 */
const isMemberOf = async (
  ctx: QueryCtx,
  assetId: Id<"assets">,
  tree: Set<string>,
) => {
  const links = await ctx.db
    .query("assetFolders")
    .withIndex("by_asset", (q) => q.eq("assetId", assetId))
    .take(32);
  return links.some((link) => tree.has(link.folderId));
};

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
  const tree = await loadTree(ctx, world.side.folder._id);
  for (const asset of starred) {
    if (!(await isMemberOf(ctx, asset._id, tree))) continue;
    const tile = await toTile(ctx, world, asset);
    if (tile) tiles.push(tile);
  }
  return tiles;
};

/** The lead frames of the side, in the owner's order, minus featured ones. */
const loadLead = async (ctx: QueryCtx, world: WorldContext, featured: WorldTile[]) => {
  const featuredIds = new Set(featured.map((tile) => tile.id as string));
  const tiles: WorldTile[] = [];
  const tree = await loadTree(ctx, world.side.folder._id);
  for (const id of world.leadIds) {
    if (featuredIds.has(id)) continue;
    const asset = await ctx.db.get(id as Id<"assets">);
    if (!asset || !(await isMemberOf(ctx, asset._id, tree))) continue;
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
  const tree = await loadTree(ctx, world.root._id);
  for (const tag of reelTags) {
    const links = await ctx.db
      .query("assetTags")
      .withIndex("by_tag_createdAt", (q) => q.eq("tagId", tag._id))
      .order("desc")
      .take(50);
    for (const link of links) {
      const asset = await ctx.db.get(link.assetId);
      if (asset?.kind !== "video") continue;
      if (!(await isMemberOf(ctx, asset._id, tree))) continue;
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

/**
 * The world's hero inserts (worldPage.heroInserts on the root), in order,
 * each with the frames this reader may see. An insert whose frames are all
 * off the page is dropped; a split that loses a frame plays full. A frame
 * must be a member of the world (any side) and pass the same rules as the
 * wall: on the public page only frames the wall itself would show.
 */
const loadInserts = async (ctx: QueryCtx, world: WorldContext) => {
  const stored = world.root.worldPage?.heroInserts ?? [];
  if (!stored.length) return [];
  const trees = await Promise.all(
    world.sides.map((side) => loadTree(ctx, side.folderId)),
  );
  const tree = new Set<string>(trees.flatMap((set) => [...set]));
  tree.add(world.root._id);
  const rootWorld = { ...world, side: { ...world.side, folder: world.root } };
  const inserts: Array<{ tiles: WorldTile[] }> = [];
  for (const insert of stored.slice(0, HERO_INSERT_MAX)) {
    const tiles: WorldTile[] = [];
    for (const id of insert.assetIds.slice(0, HERO_INSERT_MAX_FRAMES)) {
      if (!(await isMemberOf(ctx, id, tree))) continue;
      const tile = await toTile(ctx, rootWorld, await ctx.db.get(id), true);
      if (tile) tiles.push(tile);
    }
    if (tiles.length) inserts.push({ tiles });
  }
  // A film is never cropped into a split or triptych panel.
  return separateFilms(inserts, (tile) => tile.kind === "video");
};

const worldPageReturns = v.union(
  v.null(),
  v.object({
    folderId: v.id("folders"),
    slug: v.string(),
    name: v.string(),
    side: v.string(),
    sides: v.array(sideValidator),
    /** The opening frame: the first insert's first frame, else the reel. */
    hero: v.union(v.null(), tileValidator),
    /** Hero inserts in order; the first opens the page, the rest cut into the wall. */
    inserts: v.array(insertValidator),
    featured: v.array(tileValidator),
    lead: v.array(tileValidator),
  }),
);

const readWorldPage = async (ctx: QueryCtx, world: WorldContext, slug: string) => {
  const featured = await loadFeatured(ctx, world);
  const inserts = await loadInserts(ctx, world);
  // The reel belongs to the world, not the side: switching sides keeps it.
  const rootWorld =
    world.side.folder._id === world.root._id
      ? world
      : { ...world, side: { ...world.side, folder: world.root } };
  const hero =
    inserts[0]?.tiles.find((tile) => !tile.off) ??
    (await loadHero(
      ctx,
      { ...rootWorld, admin: false },
      rootWorld === world ? featured.filter((tile) => !tile.off) : [],
    ));
  return {
    folderId: world.root._id,
    slug: world.root.slug ?? slug,
    name: world.root.name,
    side: world.side.key,
    sides: world.sides.map(({ key, label }) => ({ key, label })),
    hero,
    inserts,
    featured,
    lead: await loadLead(ctx, world, featured),
  };
};

export const getWorldPage = query({
  args: { slug: v.string(), side: v.optional(v.string()) },
  returns: worldPageReturns,
  handler: async (ctx, args) => {
    const world = await resolveWorld(ctx, args.slug, args.side);
    if (!world) return null;
    return await readWorldPage(ctx, world, args.slug);
  },
});

/**
 * The owner's admin view of a world page (/w/<slug>/admin): the same page with
 * every member, private, dropped and letterboxed ones too, each marked `off`
 * with the reason it stays off the public page. Null for anyone else.
 */
export const getWorldPageAdmin = signedOwnerQuery({
  args: { ownerUserId: v.string(), slug: v.string(), side: v.optional(v.string()) },
  returns: worldPageReturns,
  handler: async (ctx, args) => {
    const world = await resolveWorld(ctx, args.slug, args.side, args.ownerUserId);
    if (!world) return null;
    return await readWorldPage(ctx, world, args.slug);
  },
});

const pageReturns = v.object({
  page: v.array(tileValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
  splitCursor: v.optional(v.union(v.string(), v.null())),
  pageStatus: v.optional(
    v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null()),
  ),
});

const pageArgs = {
  slug: v.string(),
  side: v.optional(v.string()),
  section: v.optional(sectionValidator),
  paginationOpts: paginationOptsValidator,
};

const readPage = async (
  ctx: QueryCtx,
  world: WorldContext | null,
  args: { section?: Section; paginationOpts: { numItems: number; cursor: string | null } },
) => {
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
};

/**
 * A side's frames, newest first, a page at a time. Lead frames are left out
 * (getWorldPage lists them, after the featured ones, which also come back
 * here; the page shows each frame once). A filtered page can come back
 * short or empty while `isDone` is false; the grid keeps asking.
 */
export const listWorldPage = query({
  args: pageArgs,
  returns: pageReturns,
  handler: async (ctx, args) =>
    await readPage(ctx, await resolveWorld(ctx, args.slug, args.side), args),
});

/** The admin twin of listWorldPage: every member, marked `off` where it is off the public page. */
export const listWorldPageAdmin = signedOwnerQuery({
  args: { ownerUserId: v.string(), ...pageArgs },
  returns: pageReturns,
  handler: async (ctx, { ownerUserId, ...args }) => {
    const world = await resolveWorld(ctx, args.slug, args.side, ownerUserId);
    return await readPage(ctx, world, args);
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

const heroInsertsArg = v.array(v.object({ assetIds: v.array(v.id("assets")) }));

const worldPageSettings = {
  allMembers: v.optional(v.boolean()),
  leadAssetIds: v.optional(v.array(v.id("assets"))),
  /** The whole hero insert list, in order ([] clears it: the reel opens the page again). */
  heroInserts: v.optional(heroInsertsArg),
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
    for (const insert of patch.heroInserts ?? []) {
      for (const assetId of insert.assetIds) {
        const asset = await ctx.db.get(assetId);
        if (!asset || !canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
          throw new ConvexError(`asset:${assetId} not found.`);
        }
      }
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
    heroInserts?: Array<{ assetIds: Id<"assets">[] }>;
    sides?: Array<{ key: string; label: string; folderId: Id<"folders"> }>;
  },
) => {
  const current = folder.worldPage ?? {};
  const next = {
    ...current,
    ...(patch.allMembers !== undefined ? { allMembers: patch.allMembers } : {}),
    ...(patch.sides !== undefined ? { sides: patch.sides } : {}),
    ...(patch.leadAssetIds !== undefined ? { leadAssetIds: patch.leadAssetIds.slice(0, 200) } : {}),
    ...(patch.heroInserts !== undefined ? { heroInserts: normalizeHeroInserts(patch.heroInserts) } : {}),
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

// --- Hero inserts -------------------------------------------------------------

/**
 * The world page an asset's hero insert belongs to: the page's own world when
 * the caller names it, else the asset's world, lifted to its universe root
 * (a DEAR ANNETE — 3D frame cuts into the DEAR ANNETE page).
 */
const heroWorldOf = async (
  ctx: MutationCtx,
  ownerUserId: string,
  asset: Doc<"assets">,
  folderId: Id<"folders"> | undefined,
) => {
  if (folderId) return await requireOwnedFolder(ctx, ownerUserId, folderId);
  const worlds = [...(await worldsOfAsset(ctx, asset))];
  if (!worlds.length) {
    throw new ConvexError("This frame is in no world, so it has no world page to open.");
  }
  const world = await requireOwnedFolder(ctx, ownerUserId, worlds[0]);
  if (world.universeRootId) {
    const universe = await ctx.db.get(world.universeRootId);
    if (universe && canActorAccessOwnerUserId(ownerUserId, universe.ownerUserId)) return universe;
  }
  return world;
};

/**
 * Promote a frame to a full-screen hero on its world page, or take it back
 * (owner key H; Shift+H pairs it into the previous insert as a split or a
 * triptych). add / remove / pair are idempotent; toggle is the H key.
 * Visibility is unchanged: the public page shows a hero frame only when the
 * wall would show it (isPublic, or a world that shows all its members).
 */
export const setHeroInsert = signedOwnerMutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    /** The world page (its root folder); omitted = the asset's own world. */
    folderId: v.optional(v.id("folders")),
    action: v.union(v.literal("toggle"), v.literal("add"), v.literal("remove"), v.literal("pair")),
  },
  returns: v.object({
    folderId: v.id("folders"),
    world: v.string(),
    hero: v.boolean(),
    index: v.union(v.number(), v.null()),
    frames: v.number(),
    inserts: v.number(),
  }),
  handler: async (ctx, { ownerUserId, assetId, folderId, action }) => {
    const asset = await ctx.db.get(assetId);
    if (!asset || !canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
      throw new ConvexError("Frame not found.");
    }
    const world = await heroWorldOf(ctx, ownerUserId, asset, folderId);
    const current = world.worldPage?.heroInserts ?? [];
    const films = new Set<string>(asset.kind === "video" ? [assetId] : []);
    if (action === "pair") {
      for (const insert of current.slice(-1)) {
        for (const id of insert.assetIds) {
          if ((await ctx.db.get(id))?.kind === "video") films.add(id);
        }
      }
    }
    const edit = editHeroInserts(current, assetId, action, (id) => films.has(id));
    if (edit.changed) {
      await ctx.db.patch(world._id, {
        worldPage: { ...(world.worldPage ?? {}), heroInserts: edit.inserts },
        updatedAt: Date.now(),
      });
    }
    // A new hero still gets its 4K rendition (a no-op without a Topaz key on
    // the deployment; scripts/upscale-hero.ts covers that case).
    if (
      edit.changed &&
      edit.hero &&
      asset.kind === "image" &&
      !asset.heroRendition &&
      (asset.width ?? 0) < HERO_RENDITION_WIDTH
    ) {
      await ctx.scheduler.runAfter(0, internal.heroRendition.upscale, { assetId });
    }
    return {
      folderId: world._id,
      world: world.name,
      hero: edit.hero,
      index: edit.index,
      frames: edit.frames,
      inserts: edit.inserts.length,
    };
  },
});

/** Every hero frame across the owner's worlds, for the HERO chip in the vault. */
export const listHeroAssetIds = signedOwnerQuery({
  args: { ownerUserId: v.string() },
  returns: v.array(v.object({ assetId: v.id("assets"), folderId: v.id("folders"), index: v.number() })),
  handler: async (ctx, { ownerUserId }) => {
    const out: Array<{ assetId: Id<"assets">; folderId: Id<"folders">; index: number }> = [];
    for (const owner of resolveUserIdCandidates(ownerUserId)) {
      const worlds = await ctx.db
        .query("folders")
        .withIndex("by_owner_worldKey", (q) => q.eq("ownerUserId", owner).gte("worldKey", ""))
        .take(200);
      for (const world of worlds) {
        (world.worldPage?.heroInserts ?? []).forEach((insert, index) => {
          for (const assetId of insert.assetIds.slice(0, HERO_INSERT_MAX_FRAMES)) {
            out.push({ assetId, folderId: world._id, index });
          }
        });
      }
    }
    return out.slice(0, HERO_INSERT_MAX * HERO_INSERT_MAX_FRAMES * 10);
  },
});
