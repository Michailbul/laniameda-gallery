import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import { ownerMutation, ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { bumpTagUsage, dedupeIds } from "./helpers";
import {
  galleryAssetResultValidator,
  hydrateGalleryAssetResults,
} from "./galleryAssetResults";
import {
  bookmarkMediaValidator,
  bookmarkMetricsValidator,
  bookmarkPlatformValidator,
  bookmarkPostFields,
  bookmarkQuotedPostValidator,
} from "./validators";

const reindexAssetAction = makeFunctionReference<"action">(
  "semanticIndex:reindexAsset",
);

const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 500;
const MAX_NOTE_LENGTH = 2000;

const findBookmark = async (
  ctx: QueryCtx,
  ownerUserId: string,
  platform: Doc<"bookmarks">["platform"],
  externalId: string,
) => {
  for (const ownerCandidate of resolveUserIdCandidates(ownerUserId)) {
    const row = await ctx.db
      .query("bookmarks")
      .withIndex("by_owner_platform_externalId", (q) =>
        q
          .eq("ownerUserId", ownerCandidate)
          .eq("platform", platform)
          .eq("externalId", externalId),
      )
      .unique();
    if (row) return row;
  }
  return null;
};

// Used by the save action to decide between "new post" and "re-save".
// `assetId` is only returned when the preview asset still exists.
export const getBookmarkForSave = internalQuery({
  args: {
    ownerUserId: v.string(),
    platform: bookmarkPlatformValidator,
    externalId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      bookmarkId: v.id("bookmarks"),
      assetId: v.optional(v.id("assets")),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await findBookmark(ctx, args.ownerUserId, args.platform, args.externalId);
    if (!row) return null;
    const asset = row.assetId ? await ctx.db.get(row.assetId) : null;
    return { bookmarkId: row._id, assetId: asset ? asset._id : undefined };
  },
});

// Idempotent per (owner, platform, post id). A re-save refreshes what the
// page showed (text edits, metrics) but never blanks a field the new capture
// missed, and never drops the owner's note.
export const upsertBookmarkRecord = internalMutation({
  args: {
    ownerUserId: v.string(),
    ...bookmarkPostFields,
    userNote: v.optional(v.string()),
    assetId: v.optional(v.id("assets")),
  },
  returns: v.object({
    bookmarkId: v.id("bookmarks"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    if (args.assetId) {
      const asset = await ctx.db.get(args.assetId);
      if (!asset || !canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
        throw new ConvexError("Bookmark preview asset does not belong to this user.");
      }
    }

    const now = Date.now();
    const existing = await findBookmark(ctx, ownerUserId, args.platform, args.externalId);
    let bookmarkId: Id<"bookmarks">;
    let created = false;
    if (existing) {
      bookmarkId = existing._id;
      await ctx.db.patch(existing._id, {
        url: args.url,
        authorName: args.authorName ?? existing.authorName,
        authorHandle: args.authorHandle ?? existing.authorHandle,
        authorAvatarUrl: args.authorAvatarUrl ?? existing.authorAvatarUrl,
        authorVerified: args.authorVerified ?? existing.authorVerified,
        text: args.text ?? existing.text,
        lang: args.lang ?? existing.lang,
        postedAt: args.postedAt ?? existing.postedAt,
        media: args.media.length > 0 ? args.media : existing.media,
        quotedPost: args.quotedPost ?? existing.quotedPost,
        metrics: args.metrics ?? existing.metrics,
        userNote: args.userNote ?? existing.userNote,
        assetId: existing.assetId && (await ctx.db.get(existing.assetId))
          ? existing.assetId
          : args.assetId,
        updatedAt: now,
      });
    } else {
      created = true;
      bookmarkId = await ctx.db.insert("bookmarks", {
        ownerUserId,
        platform: args.platform,
        externalId: args.externalId,
        url: args.url,
        authorName: args.authorName,
        authorHandle: args.authorHandle,
        authorAvatarUrl: args.authorAvatarUrl,
        authorVerified: args.authorVerified,
        text: args.text,
        lang: args.lang,
        postedAt: args.postedAt,
        media: args.media,
        quotedPost: args.quotedPost,
        metrics: args.metrics,
        userNote: args.userNote,
        assetId: args.assetId,
        createdAt: now,
        updatedAt: now,
      });
    }

    const linkedAssetId = (await ctx.db.get(bookmarkId))?.assetId;
    if (linkedAssetId) {
      const asset = await ctx.db.get(linkedAssetId);
      // Only the link is written here. A preview asset is created with the
      // role "bookmark"; a media piece that was already in the gallery keeps
      // its own role and stays an ordinary tile.
      if (asset && asset.bookmarkId !== bookmarkId) {
        await ctx.db.patch(linkedAssetId, { bookmarkId });
      }
      // The post text is part of the asset's search text lane.
      await ctx.scheduler.runAfter(0, reindexAssetAction, { assetId: linkedAssetId });
    }

    return { bookmarkId, created };
  },
});

// The bookmarks view: saved posts newest first, as regular gallery results
// (each carries `bookmark`). `folderId` narrows to one collection, including
// its sub-collections.
export const listBookmarks = ownerQuery({
  args: {
    ownerUserId: v.string(),
    folderId: v.optional(v.id("folders")),
    platform: v.optional(bookmarkPlatformValidator),
    limit: v.optional(v.number()),
  },
  returns: v.array(galleryAssetResultValidator),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const limit = Math.max(
      1,
      Math.min(Math.floor(args.limit ?? DEFAULT_LIST_LIMIT), MAX_LIST_LIMIT),
    );

    let folderAssetIds: Set<Id<"assets">> | null = null;
    if (args.folderId) {
      const folder = await ctx.db.get(args.folderId);
      if (!folder || !canActorAccessOwnerUserId(ownerUserId, folder.ownerUserId)) {
        return [];
      }
      const children = await ctx.db
        .query("folders")
        .withIndex("by_parent", (q) => q.eq("parentFolderId", folder._id))
        .collect();
      folderAssetIds = new Set();
      for (const scopeFolder of [folder, ...children]) {
        const links = await ctx.db
          .query("assetFolders")
          .withIndex("by_folder_createdAt", (q) => q.eq("folderId", scopeFolder._id))
          .collect();
        for (const link of links) folderAssetIds.add(link.assetId);
      }
    }

    const rows: Doc<"bookmarks">[] = [];
    for (const ownerCandidate of resolveUserIdCandidates(ownerUserId)) {
      const forOwner = await ctx.db
        .query("bookmarks")
        .withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", ownerCandidate))
        .order("desc")
        .collect();
      rows.push(...forOwner);
    }
    rows.sort((left, right) => right.createdAt - left.createdAt);

    const assets: Doc<"assets">[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (assets.length >= limit) break;
      if (args.platform && row.platform !== args.platform) continue;
      if (!row.assetId || seen.has(row.assetId)) continue;
      if (folderAssetIds && !folderAssetIds.has(row.assetId)) continue;
      const asset = await ctx.db.get(row.assetId);
      if (!asset) continue;
      seen.add(asset._id);
      assets.push(asset);
    }

    return await hydrateGalleryAssetResults(ctx, assets);
  },
});

export const updateBookmarkNote = ownerMutation({
  args: {
    ownerUserId: v.string(),
    bookmarkId: v.id("bookmarks"),
    userNote: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    const bookmark = await ctx.db.get(args.bookmarkId);
    if (!bookmark || !canActorAccessOwnerUserId(ownerUserId, bookmark.ownerUserId)) {
      throw new ConvexError("Bookmark not found.");
    }
    const userNote = args.userNote?.trim().slice(0, MAX_NOTE_LENGTH) || undefined;
    await ctx.db.patch(bookmark._id, { userNote, updatedAt: Date.now() });
    if (bookmark.assetId) {
      await ctx.scheduler.runAfter(0, reindexAssetAction, { assetId: bookmark.assetId });
    }
    return null;
  },
});

// Pieces already in the gallery that came from this post: every asset whose
// sourceUrl is one of the given spellings of the permalink. The agent save
// links them to the post instead of storing a second copy of its picture.
export const findAssetsForXPost = internalQuery({
  args: {
    ownerUserId: v.string(),
    sourceUrls: v.array(v.string()),
  },
  returns: v.array(v.id("assets")),
  handler: async (ctx, args) => {
    const urls = dedupeIds(args.sourceUrls.map((url) => url.trim()).filter(Boolean));
    const found: Doc<"assets">[] = [];
    for (const ownerCandidate of resolveUserIdCandidates(args.ownerUserId)) {
      for (const sourceUrl of urls) {
        const matches = await ctx.db
          .query("assets")
          .withIndex("by_owner_sourceUrl", (q) =>
            q.eq("ownerUserId", ownerCandidate).eq("sourceUrl", sourceUrl),
          )
          .collect();
        found.push(...matches);
      }
    }
    found.sort((left, right) => left.createdAt - right.createdAt);
    return dedupeIds(found.map((asset) => asset._id));
  },
});

// Points existing assets at their post. Each keeps its role, collections and
// description; it gains the post (author, text, counts) for the detail panel
// and the search text lane, plus the given tags so tag filters find it.
export const linkAssetsToBookmark = internalMutation({
  args: {
    ownerUserId: v.string(),
    bookmarkId: v.id("bookmarks"),
    assetIds: v.array(v.id("assets")),
    tagIds: v.array(v.id("tags")),
  },
  returns: v.object({ linked: v.array(v.id("assets")) }),
  handler: async (ctx, args) => {
    const bookmark = await ctx.db.get(args.bookmarkId);
    if (!bookmark || !canActorAccessOwnerUserId(args.ownerUserId, bookmark.ownerUserId)) {
      throw new ConvexError("Bookmark not found.");
    }
    const linked: Id<"assets">[] = [];
    for (const assetId of dedupeIds(args.assetIds)) {
      const asset = await ctx.db.get(assetId);
      if (!asset || !canActorAccessOwnerUserId(args.ownerUserId, asset.ownerUserId)) continue;
      const missingTagIds = args.tagIds.filter((tagId) => !asset.tagIds.includes(tagId));
      if (asset.bookmarkId !== bookmark._id || missingTagIds.length > 0) {
        await ctx.db.patch(asset._id, {
          bookmarkId: bookmark._id,
          tagIds: [...asset.tagIds, ...missingTagIds],
        });
        await bumpTagUsage(ctx, missingTagIds, 1);
      }
      // Tag filters and their counts read the assetTags join rows, so every
      // given tag needs its row (also repaired here if one is missing).
      const tagLinks = await ctx.db
        .query("assetTags")
        .withIndex("by_asset", (q) => q.eq("assetId", asset._id))
        .collect();
      const linkedTagIds = new Set(tagLinks.map((link) => link.tagId));
      for (const tagId of args.tagIds) {
        if (linkedTagIds.has(tagId)) continue;
        await ctx.db.insert("assetTags", {
          assetId: asset._id,
          tagId,
          createdAt: asset.createdAt,
        });
      }
      await ctx.scheduler.runAfter(0, reindexAssetAction, { assetId: asset._id });
      linked.push(asset._id);
    }
    return { linked };
  },
});

const bookmarkPostResultValidator = v.object({
  id: v.string(),
  url: v.string(),
  platform: bookmarkPlatformValidator,
  authorName: v.optional(v.string()),
  authorHandle: v.optional(v.string()),
  text: v.optional(v.string()),
  lang: v.optional(v.string()),
  postedAt: v.optional(v.number()),
  media: v.array(bookmarkMediaValidator),
  quotedPost: v.optional(bookmarkQuotedPostValidator),
  metrics: v.optional(bookmarkMetricsValidator),
  userNote: v.optional(v.string()),
  savedAt: v.number(),
  // Every gallery piece of this post: its preview, or the saved media.
  assetIds: v.array(v.string()),
  folderIds: v.array(v.id("folders")),
});

const postHaystack = (row: Doc<"bookmarks">) =>
  [
    row.authorName,
    row.authorHandle ? `@${row.authorHandle}` : undefined,
    row.text,
    row.quotedPost?.authorHandle,
    row.quotedPost?.text,
    row.userNote,
    row.url,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

// The agent's reading list: saved posts as text, newest first. `search`
// keeps posts where every word appears in the text, author, quote or note.
export const listBookmarkPosts = ownerQuery({
  args: {
    ownerUserId: v.string(),
    search: v.optional(v.string()),
    authorHandle: v.optional(v.string()),
    folderId: v.optional(v.id("folders")),
    limit: v.optional(v.number()),
  },
  returns: v.array(bookmarkPostResultValidator),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 50), MAX_LIST_LIMIT));
    const words = (args.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const handle = args.authorHandle?.trim().replace(/^@+/, "").toLowerCase();

    let scopeFolderIds: Set<Id<"folders">> | null = null;
    if (args.folderId) {
      const folder = await ctx.db.get(args.folderId);
      if (!folder || !canActorAccessOwnerUserId(ownerUserId, folder.ownerUserId)) {
        return [];
      }
      const children = await ctx.db
        .query("folders")
        .withIndex("by_parent", (q) => q.eq("parentFolderId", folder._id))
        .collect();
      scopeFolderIds = new Set([folder._id, ...children.map((child) => child._id)]);
    }

    const rows: Doc<"bookmarks">[] = [];
    for (const ownerCandidate of resolveUserIdCandidates(ownerUserId)) {
      const forOwner = await ctx.db
        .query("bookmarks")
        .withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", ownerCandidate))
        .order("desc")
        .collect();
      rows.push(...forOwner);
    }
    rows.sort((left, right) => right.createdAt - left.createdAt);

    const results = [];
    for (const row of rows) {
      if (results.length >= limit) break;
      if (handle && row.authorHandle?.toLowerCase() !== handle) continue;
      if (words.length > 0) {
        const haystack = postHaystack(row);
        if (!words.every((word) => haystack.includes(word))) continue;
      }
      const assets = await ctx.db
        .query("assets")
        .withIndex("by_bookmark", (q) => q.eq("bookmarkId", row._id))
        .collect();
      const folderIds = new Set<Id<"folders">>();
      for (const asset of assets) {
        if (asset.folderId) folderIds.add(asset.folderId);
        const links = await ctx.db
          .query("assetFolders")
          .withIndex("by_asset", (q) => q.eq("assetId", asset._id))
          .collect();
        for (const link of links) folderIds.add(link.folderId);
      }
      if (scopeFolderIds && ![...folderIds].some((id) => scopeFolderIds!.has(id))) continue;
      results.push({
        id: `bookmark:${row._id}`,
        url: row.url,
        platform: row.platform,
        authorName: row.authorName,
        authorHandle: row.authorHandle,
        text: row.text,
        lang: row.lang,
        postedAt: row.postedAt,
        media: row.media,
        quotedPost: row.quotedPost,
        metrics: row.metrics,
        userNote: row.userNote,
        savedAt: row.createdAt,
        assetIds: assets.map((asset) => `asset:${asset._id}`),
        folderIds: [...folderIds],
      });
    }
    return results;
  },
});
