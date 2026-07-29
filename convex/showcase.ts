import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { collectAssetsForFolder } from "./assets";
import { collectProjectCollectionLinks } from "./projects";
import {
  galleryAssetResultValidator,
  hydrateGalleryAssetResults,
} from "./galleryAssetResults";
import { resolveAssetThumbUrl, resolveAssetUrl } from "./r2_url";
import { resolveUserIdCandidates } from "./authz";

// ---------------------------------------------------------------------------
// Public "My Taste" showcase.
//
// Everything here is AUTHLESS by design — it powers the root page for
// anonymous visitors. Three curation surfaces feed it, all owner-controlled:
//   - assets with isPublic=true      -> the "selected works" grid
//   - folders (kind undefined) with showcased=true -> public collections
//   - folders (kind "storybook") with showcased=true -> public storybooks
// Projects are never exposed here (they are shared via /b/<token> only).
//
// A showcased collection/storybook exposes its WHOLE member set — the folder
// is the curation unit, so members are not additionally filtered by isPublic.
// ---------------------------------------------------------------------------

// The public showcase belongs to exactly one owner. Reads are scoped to it so
// a second authenticated user flagging their own folders can never place
// content on the public home. Unconfigured => the showcase renders empty.
const showcaseOwnerCandidates = () => {
  const owner = (
    process.env.SHOWCASE_OWNER_USER_ID ??
    process.env.KB_OWNER_USER_ID ??
    ""
  ).trim();
  return owner ? resolveUserIdCandidates(owner) : [];
};

const isShowcaseOwner = (ownerUserId: string | undefined) => {
  if (!ownerUserId?.trim()) return false;
  return showcaseOwnerCandidates().includes(ownerUserId.trim());
};

// How many members feed a home card's preview stack.
const CARD_PREVIEW_LIMIT = 4;
// Ceiling on assets pulled into any single showcased set / the taste grid.
const SET_ASSET_LIMIT = 200;
const SELECTED_WORKS_LIMIT = 120;
// Membership reads over-fetch by this factor before the isPublic filter, so a
// set whose recent members are private still fills its limit.
const PUBLIC_OVERFETCH = 3;
// How many pieces lead the public home.
const FEATURED_REEL_LIMIT = 12;

const previewAssetValidator = v.object({
  assetId: v.id("assets"),
  kind: v.union(v.literal("image"), v.literal("video")),
  contentType: v.optional(v.string()),
  url: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  thumbWidth: v.optional(v.number()),
  thumbHeight: v.optional(v.number()),
});

// A "world" is a showcased project: a story universe grouping its member
// collections as named sections (Characters, Locations, Stills, Beats).
const worldSectionValidator = v.object({
  key: v.union(
    v.literal("beats"),
    v.literal("episodes"),
    v.literal("characters"),
    v.literal("locations"),
    v.literal("stills"),
    v.literal("story"),
    v.literal("other"),
  ),
  label: v.string(),
  count: v.number(),
});

const worldSummaryValidator = v.object({
  folderId: v.id("folders"),
  slug: v.optional(v.string()),
  name: v.string(),
  logline: v.optional(v.string()),
  count: v.number(),
  featured: v.boolean(),
  cover: v.optional(previewAssetValidator),
  previewAssets: v.array(previewAssetValidator),
  sections: v.array(worldSectionValidator),
});

const showcaseSetSummaryValidator = v.object({
  folderId: v.id("folders"),
  name: v.string(),
  // Storybooks carry a story (folder.description); plain collections may too.
  story: v.optional(v.string()),
  kind: v.union(v.literal("collection"), v.literal("storybook")),
  count: v.number(),
  featured: v.boolean(),
  updatedAt: v.optional(v.number()),
  previewAssets: v.array(previewAssetValidator),
  // Sub-collections of a showcased parent ("Characters", "Locations", …) —
  // surfaced on the card and as chapters inside the opened set.
  chapters: v.array(
    v.object({
      folderId: v.id("folders"),
      name: v.string(),
      count: v.number(),
    }),
  ),
});

const buildPreviewAssets = async (
  ctx: Parameters<typeof resolveAssetUrl>[0],
  members: Doc<"assets">[],
) =>
  Promise.all(
    members.slice(0, CARD_PREVIEW_LIMIT).map(async (asset) => {
      const [url, thumbUrl] = await Promise.all([
        resolveAssetUrl(ctx, asset),
        resolveAssetThumbUrl(ctx, asset),
      ]);
      return {
        assetId: asset._id,
        kind: asset.kind,
        contentType: asset.contentType,
        url: url ?? undefined,
        thumbUrl: thumbUrl ?? undefined,
        width: asset.width,
        height: asset.height,
        thumbWidth: asset.thumbWidth,
        thumbHeight: asset.thumbHeight,
      };
    }),
  );

const orderShowcased = (a: Doc<"folders">, b: Doc<"folders">) => {
  const ao = a.showcaseOrder ?? Number.POSITIVE_INFINITY;
  const bo = b.showcaseOrder ?? Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao - bo;
  return (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0);
};

// Starred assets lead every set they appear in, newest star first — the same
// promotion the owner sees in the vault, carried onto the public page. Ties
// (and everything unstarred) keep the existing newest-first order.
const starredFirst = (a: Doc<"assets">, b: Doc<"assets">) => {
  const as = a.starredAt ?? 0;
  const bs = b.starredAt ?? 0;
  if (as !== bs) return bs - as;
  return (b.createdAt ?? 0) - (a.createdAt ?? 0);
};

// Public membership of one folder: only assets the owner individually marked
// isPublic. Over-fetches before filtering so a set whose newest members are
// private still fills up to the limit.
const collectPublicAssetsForFolder = async (
  ctx: Parameters<typeof hydrateGalleryAssetResults>[0],
  ownerUserIds: string[],
  folderId: Id<"folders">,
) => {
  const members = await collectAssetsForFolder(
    ctx,
    ownerUserIds,
    folderId,
    SET_ASSET_LIMIT * PUBLIC_OVERFETCH,
  );
  return members
    .filter((asset) => asset.isPublic === true)
    .sort(starredFirst)
    .slice(0, SET_ASSET_LIMIT);
};

// A showcased set's public membership: the folder's own public assets plus
// every sub-collection's ("Characters", "Locations", …), deduped, cover-first.
const collectSetMembers = async (
  ctx: Parameters<typeof hydrateGalleryAssetResults>[0],
  folder: Doc<"folders">,
) => {
  const ownerUserIds = resolveUserIdCandidates(folder.ownerUserId ?? "");
  const own = await collectPublicAssetsForFolder(ctx, ownerUserIds, folder._id);

  // Only plain collections nest; storybooks never have chapters.
  const childFolders =
    folder.kind === undefined
      ? (
          await ctx.db
            .query("folders")
            .withIndex("by_parent", (q) => q.eq("parentFolderId", folder._id))
            .collect()
        )
          .filter((f) => f.kind === undefined)
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];
  const chapters = await Promise.all(
    childFolders.map(async (child) => ({
      folder: child,
      members: await collectPublicAssetsForFolder(ctx, ownerUserIds, child._id),
    })),
  );

  const seen = new Set<string>();
  const all: Doc<"assets">[] = [];
  for (const asset of [...own, ...chapters.flatMap((c) => c.members)]) {
    if (seen.has(asset._id)) continue;
    seen.add(asset._id);
    all.push(asset);
  }
  // The chosen cover fronts the preview stack when set.
  if (folder.coverAssetId) {
    const idx = all.findIndex((a) => a._id === folder.coverAssetId);
    if (idx > 0) {
      const [cover] = all.splice(idx, 1);
      all.unshift(cover);
    }
  }
  return { own, chapters, all: all.slice(0, SET_ASSET_LIMIT) };
};

const SECTION_LABELS = {
  beats: "Beats",
  // Episode folders carry no assets themselves (their beats do), so this
  // bucket stays empty in practice — it exists so the section union is total.
  episodes: "Episodes",
  characters: "Characters",
  locations: "Locations",
  stills: "Stills",
  // A storybook's own frames — it has no sub-structure, the story IS the set.
  story: "Story",
  other: "More",
} as const;

type WorldSectionKey = keyof typeof SECTION_LABELS;

// A WORLD is the single public concept for "a story universe". Three vault
// shapes produce one, so publishing never forces a restructure:
//   - a project (kind:"project") whose member collections carry an explicit
//     projectCollections.section
//   - a plain collection with sub-collections ("Dear Annette" > Scenes,
//     Characters, Locations), where the child's NAME names the section
//   - a storybook (kind:"storybook"), whose own frames are its one "Story"
//     section — a storybook IS a world, just one without sub-structure
// A childless plain collection is a plain set, not a world.
const SECTION_BY_NAME: Array<[RegExp, WorldSectionKey]> = [
  [/^(scenes?|beats?|shots?|storyboard)$/i, "beats"],
  [/^(characters?|cast)$/i, "characters"],
  [/^(locations?|places?|environments?)$/i, "locations"],
  [/^(stills?|frames?|renders?)$/i, "stills"],
];

const sectionKeyForName = (name: string): WorldSectionKey => {
  const trimmed = name.trim();
  for (const [pattern, key] of SECTION_BY_NAME) {
    if (pattern.test(trimmed)) return key;
  }
  return "other";
};

// A world's children: plain sub-collections AND nested projects. The project
// tier is the second level of the hierarchy — world > project > beats >
// statics — so a world that holds only a project is still a world.
const worldChildFolders = async (
  ctx: Parameters<typeof hydrateGalleryAssetResults>[0],
  world: Doc<"folders">,
) =>
  (
    await ctx.db
      .query("folders")
      .withIndex("by_parent", (q) => q.eq("parentFolderId", world._id))
      .collect()
  ).filter((child) => child.kind === undefined || child.kind === "project");

// Is this showcased folder a world (sectioned) rather than a flat set?
const isWorldFolder = async (
  ctx: Parameters<typeof hydrateGalleryAssetResults>[0],
  folder: Doc<"folders">,
) => {
  if (folder.kind === "project" || folder.kind === "storybook") return true;
  if (folder.kind !== undefined) return false;
  return (await worldChildFolders(ctx, folder)).length > 0;
};

// A world's public content, grouped into sections and carrying only assets
// marked isPublic. An asset filed into more than one member collection is
// presented once, in the first section that claims it, so the world page never
// repeats a frame.
const collectWorldSections = async (
  ctx: Parameters<typeof hydrateGalleryAssetResults>[0],
  world: Doc<"folders">,
) => {
  const ownerUserIds = resolveUserIdCandidates(world.ownerUserId ?? "");

  // Normalize every shape to (folderId, sectionKey) pairs before reading any
  // membership, so the grouping below is shape-agnostic.
  const members: Array<{ folderId: Id<"folders">; key: WorldSectionKey }> = [];

  // A project's own member collections carry an explicit section.
  const pushProjectMembers = async (projectId: Id<"folders">) => {
    for (const link of await collectProjectCollectionLinks(
      ctx,
      ownerUserIds,
      projectId,
    )) {
      members.push({ folderId: link.folderId, key: link.section ?? "other" });
    }
  };

  if (world.kind === "project") {
    await pushProjectMembers(world._id);
  } else {
    for (const child of await worldChildFolders(ctx, world)) {
      if (child.kind === "project") {
        // A project inside a world holds no assets itself — it contributes
        // the sectioned collections filed under it.
        await pushProjectMembers(child._id);
      } else {
        members.push({
          folderId: child._id,
          key: sectionKeyForName(child.name),
        });
      }
    }
  }

  // Non-project worlds also show whatever sits directly on the folder itself:
  // a storybook's frames ARE its story; a plain collection's loose members go
  // under "More" so nothing published goes missing.
  if (world.kind !== "project") {
    members.push({
      folderId: world._id,
      key: world.kind === "storybook" ? "story" : "other",
    });
  }

  const seen = new Set<string>();
  const byKey = new Map<
    WorldSectionKey,
    { key: WorldSectionKey; label: string; assets: Doc<"assets">[] }
  >();

  for (const member of members) {
    const collectionMembers = await collectPublicAssetsForFolder(
      ctx,
      ownerUserIds,
      member.folderId,
    );
    const fresh = collectionMembers.filter((asset) => {
      if (seen.has(asset._id)) return false;
      seen.add(asset._id);
      return true;
    });
    if (fresh.length === 0) continue;
    const key = member.key;
    const bucket = byKey.get(key) ?? {
      key,
      label: SECTION_LABELS[key],
      assets: [],
    };
    bucket.assets.push(...fresh);
    byKey.set(key, bucket);
  }

  // Stable, narrative order regardless of how the collections were linked.
  const ORDER: WorldSectionKey[] = [
    "story",
    "episodes",
    "beats",
    "characters",
    "locations",
    "stills",
    "other",
  ];
  const sections = ORDER.map((key) => byKey.get(key)).filter(
    (section): section is NonNullable<typeof section> => section !== undefined,
  );
  const all = sections.flatMap((section) => section.assets);
  return { sections, all };
};

// A world's public identity, as stamped onto any asset that belongs to it.
const worldRefValidator = v.object({
  folderId: v.id("folders"),
  slug: v.optional(v.string()),
  name: v.string(),
});

const summarizeWorld = async (
  ctx: Parameters<typeof hydrateGalleryAssetResults>[0],
  world: Doc<"folders">,
) => {
  const { sections, all } = await collectWorldSections(ctx, world);
  // The chosen cover fronts the card; otherwise the first public frame does.
  const ordered = [...all];
  if (world.coverAssetId) {
    const idx = ordered.findIndex((a) => a._id === world.coverAssetId);
    if (idx > 0) ordered.unshift(ordered.splice(idx, 1)[0]);
  }
  const previewAssets = await buildPreviewAssets(ctx, ordered);
  return {
    // Not part of the card payload — lets the caller stamp each world's
    // members without walking the membership a second time.
    assetIds: all.map((asset) => asset._id),
    summary: {
      folderId: world._id,
      slug: world.slug,
      name: world.name,
      logline: world.description,
      count: all.length,
      featured: world.showcaseFeatured === true,
      cover: previewAssets[0],
      previewAssets,
      sections: sections.map((section) => ({
        key: section.key,
        label: section.label,
        count: section.assets.length,
      })),
    },
  };
};

/**
 * The whole public home in one shot:
 *   featured    — showcased sets flagged showcaseFeatured (hero treatment)
 *   storybooks  — remaining showcased storybooks (stack cards)
 *   collections — remaining showcased collections (stack cards)
 *   inspiration — when a taste collection exists (folders.tasteCollection),
 *                 exactly its members, newest first: the owner curates the
 *                 grid by filing assets into that one collection. Without
 *                 one, the legacy tail: individually public assets NOT
 *                 already inside a showcased set.
 * Returns empty arrays (never null) so the page renders a clean empty state
 * before anything is published.
 */
export const getShowcaseHome = query({
  args: {},
  returns: v.object({
    // Each featured piece carries the world it belongs to, when it belongs to
    // one — the card surfaces it on hover.
    featuredReel: v.array(
      v.object({
        asset: galleryAssetResultValidator,
        world: v.optional(worldRefValidator),
      }),
    ),
    worlds: v.array(worldSummaryValidator),
    featured: v.array(showcaseSetSummaryValidator),
    collections: v.array(showcaseSetSummaryValidator),
    storybooks: v.array(showcaseSetSummaryValidator),
    inspiration: v.array(galleryAssetResultValidator),
  }),
  handler: async (ctx) => {
    const tasteFolder =
      (
        await ctx.db
          .query("folders")
          .withIndex("by_tasteCollection", (q) => q.eq("tasteCollection", true))
          .collect()
      ).find((f) => f.kind === undefined && isShowcaseOwner(f.ownerUserId)) ??
      null;

    // --- Showcased sets: root-level collections + storybooks. The taste
    // collection never doubles as a stack — it IS the inspiration grid. ---
    const showcasedFolders = (
      await ctx.db
        .query("folders")
        .withIndex("by_showcased", (q) => q.eq("showcased", true))
        .collect()
    ).filter(
      (f) => isShowcaseOwner(f.ownerUserId) && f.parentFolderId === undefined,
    );

    // --- Worlds: showcased projects, plus showcased collections that carry
    // sub-collections (Dear Annette > Scenes / Characters / Locations). Both
    // shapes present identically to a visitor.
    const worldFolders: Doc<"folders">[] = [];
    const setFolders: Doc<"folders">[] = [];
    for (const folder of showcasedFolders) {
      if (folder._id === tasteFolder?._id) continue;
      if (await isWorldFolder(ctx, folder)) worldFolders.push(folder);
      else if (folder.kind === undefined || folder.kind === "storybook") {
        setFolders.push(folder);
      }
    }

    const summarizedWorlds = await Promise.all(
      worldFolders.sort(orderShowcased).map((world) => summarizeWorld(ctx, world)),
    );
    const worlds = summarizedWorlds.map((entry) => entry.summary);

    // assetId -> the world it belongs to, so a featured piece can say where it
    // comes from. First world wins if an asset somehow sits in two.
    const worldByAssetId = new Map<string, (typeof worlds)[number]>();
    for (const entry of summarizedWorlds) {
      for (const assetId of entry.assetIds) {
        if (!worldByAssetId.has(assetId)) {
          worldByAssetId.set(assetId, entry.summary);
        }
      }
    }

    const showcasedSetFolders = setFolders;

    const showcasedAssetIds = new Set<string>();
    const summarize = async (folder: Doc<"folders">) => {
      const { chapters, all } = await collectSetMembers(ctx, folder);
      for (const asset of all) showcasedAssetIds.add(asset._id);
      return {
        folder,
        summary: {
          folderId: folder._id,
          name: folder.name,
          story: folder.description,
          kind: (folder.kind === "storybook" ? "storybook" : "collection") as
            | "collection"
            | "storybook",
          count: all.length,
          featured: folder.showcaseFeatured === true,
          updatedAt: folder.updatedAt ?? folder.createdAt,
          previewAssets: await buildPreviewAssets(ctx, all),
          chapters: chapters.map((c) => ({
            folderId: c.folder._id,
            name: c.folder.name,
            count: c.members.length,
          })),
        },
      };
    };

    const summarized = await Promise.all(
      [...showcasedSetFolders].sort(orderShowcased).map(summarize),
    );

    const featured = summarized
      .filter((s) => s.folder.showcaseFeatured === true)
      .map((s) => s.summary);
    const collections = summarized
      .filter(
        (s) => s.folder.showcaseFeatured !== true && s.folder.kind === undefined,
      )
      .map((s) => s.summary);
    const storybooks = summarized
      .filter(
        (s) =>
          s.folder.showcaseFeatured !== true && s.folder.kind === "storybook",
      )
      .map((s) => s.summary);

    // --- Featured reel: the pieces that lead the page. Public + flagged
    // featured, owner-ordered (orderPriority) with videos winning ties so the
    // reel opens on motion. ---
    const featuredReelAssets = (
      await ctx.db
        .query("assets")
        .withIndex("by_isPublic_createdAt", (q) =>
          q.eq("isPublic", true).gte("createdAt", 0),
        )
        .order("desc")
        .take(SELECTED_WORKS_LIMIT * PUBLIC_OVERFETCH)
    )
      .filter((a) => a.isFeatured === true && isShowcaseOwner(a.ownerUserId))
      .sort((a, b) => {
        // HIGHER first — the same convention as the schema comment and the
        // project workspace. This used to sort ascending, which silently
        // inverted the owner's intent: `setAssetOrderPriority("top")` writes
        // +Date.now(), so a piece sent to the top landed LAST out here. It went
        // unnoticed because nothing had a priority set, leaving every asset on
        // the videos-then-newest fallback below.
        const ao = a.orderPriority ?? Number.NEGATIVE_INFINITY;
        const bo = b.orderPriority ?? Number.NEGATIVE_INFINITY;
        if (ao !== bo) return bo - ao;
        const av = a.kind === "video" ? 0 : 1;
        const bv = b.kind === "video" ? 0 : 1;
        if (av !== bv) return av - bv;
        return (b.createdAt ?? 0) - (a.createdAt ?? 0);
      })
      .slice(0, FEATURED_REEL_LIMIT);
    const hydratedReel = await hydrateGalleryAssetResults(
      ctx,
      featuredReelAssets,
    );
    const featuredReel = hydratedReel.map((asset) => {
      const world = worldByAssetId.get(asset._id);
      return {
        asset,
        world: world
          ? { folderId: world.folderId, slug: world.slug, name: world.name }
          : undefined,
      };
    });

    // --- Inspiration ---
    let inspiration;
    if (tasteFolder) {
      // Exclusively the taste collection's members (whole set, same exposure
      // rule as showcased folders), newest first.
      const { all } = await collectSetMembers(ctx, tasteFolder);
      inspiration = await hydrateGalleryAssetResults(
        ctx,
        [...all].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
      );
    } else {
      // Legacy tail: public assets not already inside a showcased set.
      const publicAssets = await ctx.db
        .query("assets")
        .withIndex("by_isPublic_createdAt", (q) =>
          q.eq("isPublic", true).gte("createdAt", 0),
        )
        .order("desc")
        .take(SELECTED_WORKS_LIMIT);
      const unsorted = publicAssets
        .filter((a) => isShowcaseOwner(a.ownerUserId) && !showcasedAssetIds.has(a._id))
        .sort((a, b) => {
          const af = a.isFeatured ? 1 : 0;
          const bf = b.isFeatured ? 1 : 0;
          if (af !== bf) return bf - af;
          return (b.createdAt ?? 0) - (a.createdAt ?? 0);
        });
      inspiration = await hydrateGalleryAssetResults(ctx, unsorted);
    }

    return { featuredReel, worlds, featured, collections, storybooks, inspiration };
  },
});

const worldViewValidator = v.union(
  v.null(),
  v.object({
    folderId: v.id("folders"),
    slug: v.optional(v.string()),
    name: v.string(),
    logline: v.optional(v.string()),
    cover: v.optional(previewAssetValidator),
    sections: v.array(
      v.object({
        key: worldSectionValidator.fields.key,
        label: v.string(),
        assets: v.array(galleryAssetResultValidator),
      }),
    ),
  }),
);

/**
 * One world by slug (or raw folder id, for worlds published before slugs
 * existed). Returns null unless the project is currently showcased — revoking
 * the flag closes the public door immediately. Only isPublic members are ever
 * returned.
 */
export const getWorld = query({
  args: { slug: v.string() },
  returns: worldViewValidator,
  handler: async (ctx, args) => {
    const key = args.slug.trim();
    if (!key) return null;

    const bySlug = await ctx.db
      .query("folders")
      .withIndex("by_slug", (q) => q.eq("slug", key))
      .first();
    // ctx.db.get throws on a malformed id, so only try the id path when the
    // slug lookup missed and the key could plausibly be one.
    const world =
      bySlug ??
      (await (async () => {
        try {
          return await ctx.db.get(key as Id<"folders">);
        } catch {
          return null;
        }
      })());

    if (!world) return null;
    if (world.showcased !== true) return null;
    if (!isShowcaseOwner(world.ownerUserId)) return null;
    if (!(await isWorldFolder(ctx, world))) return null;

    const { sections } = await collectWorldSections(ctx, world);
    const cover = (await buildPreviewAssets(ctx, sections[0]?.assets ?? []))[0];
    return {
      folderId: world._id,
      slug: world.slug,
      name: world.name,
      logline: world.description,
      cover,
      sections: await Promise.all(
        sections.map(async (section) => ({
          key: section.key,
          label: section.label,
          assets: await hydrateGalleryAssetResults(ctx, section.assets),
        })),
      ),
    };
  },
});

const showcaseSetValidator = v.union(
  v.null(),
  v.object({
    folderId: v.id("folders"),
    name: v.string(),
    story: v.optional(v.string()),
    kind: v.union(v.literal("collection"), v.literal("storybook")),
    updatedAt: v.optional(v.number()),
    // The set's own (unfiled) assets — chapter members are excluded so
    // nothing renders twice.
    assets: v.array(galleryAssetResultValidator),
    // Sub-collections rendered as named chapters ("Characters", …).
    chapters: v.array(
      v.object({
        folderId: v.id("folders"),
        name: v.string(),
        story: v.optional(v.string()),
        assets: v.array(galleryAssetResultValidator),
      }),
    ),
  }),
);

// Shared loader for a single showcased set. Returns null unless the folder is
// currently showcased AND matches the expected kind — a revoked showcase flag
// instantly closes the public door.
const loadShowcaseSet = async (
  ctx: Parameters<typeof hydrateGalleryAssetResults>[0],
  folderId: Id<"folders">,
  expected: "collection" | "storybook",
) => {
  const folder = await ctx.db.get(folderId);
  if (!folder || folder.showcased !== true) return null;
  if (!isShowcaseOwner(folder.ownerUserId)) return null;
  const folderKind = folder.kind === "storybook" ? "storybook" : "collection";
  if (folderKind !== expected) return null;
  // Guard: only plain collections and storybooks are ever public here.
  if (folder.kind === "project" || folder.kind === "beat") return null;

  const { own, chapters } = await collectSetMembers(ctx, folder);
  const chapterAssetIds = new Set(
    chapters.flatMap((c) => c.members.map((m) => m._id as string)),
  );
  const assets = await hydrateGalleryAssetResults(
    ctx,
    own.filter((a) => !chapterAssetIds.has(a._id)),
  );
  const hydratedChapters = await Promise.all(
    chapters.map(async (chapter) => ({
      folderId: chapter.folder._id,
      name: chapter.folder.name,
      story: chapter.folder.description,
      assets: await hydrateGalleryAssetResults(ctx, chapter.members),
    })),
  );
  return {
    folderId: folder._id,
    name: folder.name,
    story: folder.description,
    kind: expected,
    updatedAt: folder.updatedAt ?? folder.createdAt,
    assets,
    chapters: hydratedChapters,
  };
};

export const getShowcaseCollection = query({
  args: { folderId: v.id("folders") },
  returns: showcaseSetValidator,
  handler: (ctx, args) => loadShowcaseSet(ctx, args.folderId, "collection"),
});

export const getShowcaseStorybook = query({
  args: { folderId: v.id("folders") },
  returns: showcaseSetValidator,
  handler: (ctx, args) => loadShowcaseSet(ctx, args.folderId, "storybook"),
});

/**
 * One public asset by id — backs the shareable deep link
 * `?asset=<id>` on the public surfaces, so a link opens straight onto the same
 * piece even when it sits deep past the visitor's first loaded page.
 *
 * Authless, so the guard is the whole point: an asset is only returned when it
 * is individually `isPublic` AND owned by the showcase owner. A private asset,
 * or someone else's, returns null exactly like a bad id — the caller can't tell
 * the difference, so this can't be used to probe for what exists.
 */
export const getPublicAsset = query({
  args: { assetId: v.string() },
  returns: v.union(galleryAssetResultValidator, v.null()),
  handler: async (ctx, args) => {
    const raw = args.assetId.trim();
    if (!raw) return null;

    // ctx.db.get throws on a malformed id, and a shared link is user input.
    let asset: Doc<"assets"> | null = null;
    try {
      asset = await ctx.db.get(raw as Id<"assets">);
    } catch {
      return null;
    }
    if (!asset) return null;
    if (asset.isPublic !== true) return null;
    if (!isShowcaseOwner(asset.ownerUserId)) return null;

    const [hydrated] = await hydrateGalleryAssetResults(ctx, [asset]);
    return hydrated ?? null;
  },
});
