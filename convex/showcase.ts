import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { collectAssetsForFolder } from "./assets";
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

// How many members feed a home card's preview stack.
const CARD_PREVIEW_LIMIT = 4;
// Ceiling on assets pulled into any single showcased set / the taste grid.
const SET_ASSET_LIMIT = 200;
const SELECTED_WORKS_LIMIT = 120;

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

// A showcased set's full membership: the folder's own assets plus every
// sub-collection's ("Characters", "Locations", …), deduped, cover-first.
const collectSetMembers = async (
  ctx: Parameters<typeof hydrateGalleryAssetResults>[0],
  folder: Doc<"folders">,
) => {
  const ownerUserIds = resolveUserIdCandidates(folder.ownerUserId ?? "");
  const own = await collectAssetsForFolder(
    ctx,
    ownerUserIds,
    folder._id,
    SET_ASSET_LIMIT,
  );

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
      members: await collectAssetsForFolder(
        ctx,
        ownerUserIds,
        child._id,
        SET_ASSET_LIMIT,
      ),
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

/**
 * The whole public home in one shot:
 *   featured    — showcased sets flagged showcaseFeatured (hero treatment)
 *   storybooks  — remaining showcased storybooks (stack cards)
 *   collections — remaining showcased collections (stack cards)
 *   inspiration — individually public assets NOT already inside a showcased
 *                 set: the "random / unsorted" tail of the page.
 * Returns empty arrays (never null) so the page renders a clean empty state
 * before anything is published.
 */
export const getShowcaseHome = query({
  args: {},
  returns: v.object({
    featured: v.array(showcaseSetSummaryValidator),
    collections: v.array(showcaseSetSummaryValidator),
    storybooks: v.array(showcaseSetSummaryValidator),
    inspiration: v.array(galleryAssetResultValidator),
  }),
  handler: async (ctx) => {
    // --- Showcased sets: root-level collections + storybooks. ---
    const showcasedFolders = (
      await ctx.db
        .query("folders")
        .withIndex("by_showcased", (q) => q.eq("showcased", true))
        .collect()
    ).filter(
      (f) =>
        f.parentFolderId === undefined &&
        (f.kind === undefined || f.kind === "storybook"),
    );

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
      [...showcasedFolders].sort(orderShowcased).map(summarize),
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

    // --- Inspiration: public assets not already inside a showcased set. ---
    const publicAssets = await ctx.db
      .query("assets")
      .withIndex("by_isPublic_createdAt", (q) =>
        q.eq("isPublic", true).gte("createdAt", 0),
      )
      .order("desc")
      .take(SELECTED_WORKS_LIMIT);
    const unsorted = publicAssets
      .filter((a) => !showcasedAssetIds.has(a._id))
      .sort((a, b) => {
        const af = a.isFeatured ? 1 : 0;
        const bf = b.isFeatured ? 1 : 0;
        if (af !== bf) return bf - af;
        return (b.createdAt ?? 0) - (a.createdAt ?? 0);
      });
    const inspiration = await hydrateGalleryAssetResults(ctx, unsorted);

    return { featured, collections, storybooks, inspiration };
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
  const folderKind = folder.kind === "storybook" ? "storybook" : "collection";
  if (folderKind !== expected) return null;
  // Guard: only plain collections and storybooks are ever public here.
  if (folder.kind === "project" || folder.kind === "direction") return null;

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
