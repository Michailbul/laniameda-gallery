import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { ownerAction, ownerMutation, ownerQuery, signedOwnerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { storeBlobToR2 } from "./r2_store";
import { buildR2PublicUrl } from "./r2_url";
import {
  buildVideoRefSearchText,
  compareVideoRefs,
  matchesVideoRef,
  normalizeLabel,
  parseYouTubeId,
  youTubeFrameCandidates,
  youTubeThumbnailCandidates,
  youTubeWatchUrl,
  videoRefStillMetadata,
} from "../lib/video-refs";

// Video references: YouTube videos saved as research (what performs, how it
// looks, why it works). See the `videoRefs` table in schema.ts.

const MAX_ITEMS_PER_SAVE = 12;
const MAX_FRAMES = 6;
const DEFAULT_LIST_LIMIT = 300;
const MAX_LIST_LIMIT = 2000;
const MAX_TEXT = 4000;
// i.ytimg.com answers a missing still with a ~1 KB grey placeholder.
const MIN_IMAGE_BYTES = 1500;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const describedFields = {
  channelName: v.optional(v.string()),
  channelHandle: v.optional(v.string()),
  channelUrl: v.optional(v.string()),
  subscribers: v.optional(v.number()),
  medianViews: v.optional(v.number()),
  views: v.optional(v.number()),
  publishedAt: v.optional(v.number()),
  durationSeconds: v.optional(v.number()),
  isChannelBest: v.optional(v.boolean()),
  channelLastUploadAt: v.optional(v.number()),
  checkedAt: v.optional(v.number()),
  topic: v.optional(v.string()),
  styleFamily: v.optional(v.string()),
  productionStyle: v.optional(v.string()),
  language: v.optional(v.string()),
  styleDescription: v.optional(v.string()),
  format: v.optional(v.string()),
  whyItWorks: v.optional(v.string()),
  hook: v.optional(v.string()),
  titlePattern: v.optional(v.string()),
  thumbnailPattern: v.optional(v.string()),
  audience: v.optional(v.string()),
  bendIdea: v.optional(v.string()),
  agentDescription: v.optional(v.string()),
  userNote: v.optional(v.string()),
};

const videoRefInputValidator = v.object({
  // A YouTube link or a bare 11-character video id.
  url: v.string(),
  title: v.string(),
  ...describedFields,
  collections: v.optional(v.array(v.string())),
  tagNames: v.optional(v.array(v.string())),
  // Optional overrides. Left out, the action copies YouTube's own thumbnail
  // and its three numbered auto stills (capture positions are unverified).
  thumbnailUrl: v.optional(v.string()),
  frameUrls: v.optional(v.array(v.string())),
});

const frameValidator = v.object({ r2Key: v.string(), label: v.optional(v.string()), sourceKind: v.optional(v.union(v.literal("youtube-auto-still"), v.literal("supplied-still"))), sourceUrl: v.optional(v.string()) });

export const videoRefResultValidator = v.object({
  _id: v.id("videoRefs"),
  platform: v.literal("youtube"),
  externalId: v.string(),
  url: v.string(),
  title: v.string(),
  ...describedFields,
  collections: v.array(v.string()),
  tagNames: v.array(v.string()),
  thumbUrl: v.optional(v.string()),
  frames: v.array(v.object({ url: v.string(), label: v.optional(v.string()), sourceKind: v.union(v.literal("youtube-auto-still"), v.literal("supplied-still"), v.literal("legacy-unverified")), sourceUrl: v.optional(v.string()), positionVerified: v.literal(false) })),
  isLiked: v.optional(v.boolean()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const clip = (value: string | undefined) => {
  const text = value?.trim();
  return text ? text.slice(0, MAX_TEXT) : undefined;
};

const cleanLabels = (values: string[] | undefined) => [
  ...new Set((values ?? []).map(normalizeLabel).filter(Boolean)),
];

const searchTextFor = (row: {
  title: string;
  channelName?: string;
  channelHandle?: string;
  topic?: string;
  styleFamily?: string;
  productionStyle?: string;
  language?: string;
  styleDescription?: string;
  format?: string;
  whyItWorks?: string;
  hook?: string;
  titlePattern?: string;
  thumbnailPattern?: string;
  audience?: string;
  bendIdea?: string;
  agentDescription?: string;
  userNote?: string;
  collections: string[];
  tagNames: string[];
}) =>
  buildVideoRefSearchText([
    row.title,
    row.channelName,
    row.channelHandle,
    row.topic,
    row.styleFamily,
    row.productionStyle,
    row.language,
    row.styleDescription,
    row.format,
    row.whyItWorks,
    row.hook,
    row.titlePattern,
    row.thumbnailPattern,
    row.audience,
    row.bendIdea,
    row.agentDescription,
    row.userNote,
    row.collections.join(" "),
    row.tagNames.join(" "),
  ]);

const toResult = (row: Doc<"videoRefs">) => ({
  _id: row._id,
  platform: row.platform,
  externalId: row.externalId,
  url: row.url,
  title: row.title,
  channelName: row.channelName,
  channelHandle: row.channelHandle,
  channelUrl: row.channelUrl,
  subscribers: row.subscribers,
  medianViews: row.medianViews,
  views: row.views,
  publishedAt: row.publishedAt,
  durationSeconds: row.durationSeconds,
  isChannelBest: row.isChannelBest,
  channelLastUploadAt: row.channelLastUploadAt,
  checkedAt: row.checkedAt,
  topic: row.topic,
  styleFamily: row.styleFamily,
  productionStyle: row.productionStyle,
  language: row.language,
  styleDescription: row.styleDescription,
  format: row.format,
  whyItWorks: row.whyItWorks,
  hook: row.hook,
  titlePattern: row.titlePattern,
  thumbnailPattern: row.thumbnailPattern,
  audience: row.audience,
  bendIdea: row.bendIdea,
  agentDescription: row.agentDescription,
  userNote: row.userNote,
  collections: row.collections,
  tagNames: row.tagNames,
  thumbUrl: row.thumbR2Key ? buildR2PublicUrl(row.thumbR2Key) : undefined,
  frames: row.frames.flatMap((frame, index) => {
    const url = buildR2PublicUrl(frame.r2Key);
    return url ? [{ url, ...videoRefStillMetadata(frame, index) }] : [];
  }),
  isLiked: row.isLiked,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const findVideoRef = async (ctx: QueryCtx, ownerUserId: string, externalId: string) => {
  for (const ownerCandidate of resolveUserIdCandidates(ownerUserId)) {
    const row = await ctx.db
      .query("videoRefs")
      .withIndex("by_owner_platform_externalId", (q) =>
        q.eq("ownerUserId", ownerCandidate).eq("platform", "youtube").eq("externalId", externalId),
      )
      .unique();
    if (row) return row;
  }
  return null;
};

const collectOwnerRows = async (ctx: QueryCtx, ownerUserId: string) => {
  const rows: Doc<"videoRefs">[] = [];
  for (const ownerCandidate of resolveUserIdCandidates(ownerUserId)) {
    const forOwner = await ctx.db
      .query("videoRefs")
      .withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", ownerCandidate))
      .collect();
    rows.push(...forOwner);
  }
  return rows;
};

export const getVideoRefForSave = internalQuery({
  args: { ownerUserId: v.string(), externalId: v.string() },
  returns: v.union(v.null(), v.object({ hasThumb: v.boolean(), frameCount: v.number() })),
  handler: async (ctx, args) => {
    const row = await findVideoRef(ctx, args.ownerUserId, args.externalId);
    return row ? { hasThumb: Boolean(row.thumbR2Key), frameCount: row.frames.length } : null;
  },
});

// Idempotent per (owner, video id). A re-save refreshes numbers and
// descriptions, merges collections and tags, and never blanks a field the new
// save left out, the owner's note and like included.
export const upsertVideoRef = internalMutation({
  args: {
    ownerUserId: v.string(),
    externalId: v.string(),
    title: v.string(),
    ...describedFields,
    collections: v.array(v.string()),
    tagNames: v.array(v.string()),
    thumbR2Key: v.optional(v.string()),
    frames: v.optional(v.array(frameValidator)),
  },
  returns: v.object({ id: v.id("videoRefs"), created: v.boolean() }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) throw new ConvexError("ownerUserId is required.");
    const now = Date.now();
    const existing = await findVideoRef(ctx, ownerUserId, args.externalId);
    const described = {
      channelName: clip(args.channelName) ?? existing?.channelName,
      channelHandle: clip(args.channelHandle) ?? existing?.channelHandle,
      channelUrl: clip(args.channelUrl) ?? existing?.channelUrl,
      subscribers: args.subscribers ?? existing?.subscribers,
      medianViews: args.medianViews ?? existing?.medianViews,
      views: args.views ?? existing?.views,
      publishedAt: args.publishedAt ?? existing?.publishedAt,
      durationSeconds: args.durationSeconds ?? existing?.durationSeconds,
      isChannelBest: args.isChannelBest ?? existing?.isChannelBest,
      channelLastUploadAt: args.channelLastUploadAt ?? existing?.channelLastUploadAt,
      checkedAt: args.checkedAt ?? existing?.checkedAt,
      topic: clip(args.topic) ?? existing?.topic,
      styleFamily: clip(args.styleFamily) ?? existing?.styleFamily,
      productionStyle: clip(args.productionStyle) ?? existing?.productionStyle,
      // Stored lowercase, so "EN" and "en" are one language.
      language: clip(args.language)?.toLowerCase() ?? existing?.language,
      styleDescription: clip(args.styleDescription) ?? existing?.styleDescription,
      format: clip(args.format) ?? existing?.format,
      whyItWorks: clip(args.whyItWorks) ?? existing?.whyItWorks,
      hook: clip(args.hook) ?? existing?.hook,
      titlePattern: clip(args.titlePattern) ?? existing?.titlePattern,
      thumbnailPattern: clip(args.thumbnailPattern) ?? existing?.thumbnailPattern,
      audience: clip(args.audience) ?? existing?.audience,
      bendIdea: clip(args.bendIdea) ?? existing?.bendIdea,
      agentDescription: clip(args.agentDescription) ?? existing?.agentDescription,
      userNote: clip(args.userNote) ?? existing?.userNote,
    };
    const title = args.title.trim().slice(0, 500) || existing?.title || args.externalId;
    const collections = [...new Set([...(existing?.collections ?? []), ...args.collections])];
    const tagNames = [...new Set([...(existing?.tagNames ?? []), ...args.tagNames])];
    const thumbR2Key = args.thumbR2Key ?? existing?.thumbR2Key;
    const frames = args.frames && args.frames.length > 0 ? args.frames : existing?.frames ?? [];
    const searchText = searchTextFor({ title, ...described, collections, tagNames });

    if (existing) {
      await ctx.db.patch(existing._id, {
        title,
        ...described,
        collections,
        tagNames,
        thumbR2Key,
        frames,
        searchText,
        updatedAt: now,
      });
      return { id: existing._id, created: false };
    }
    const id = await ctx.db.insert("videoRefs", {
      ownerUserId,
      platform: "youtube",
      externalId: args.externalId,
      url: youTubeWatchUrl(args.externalId),
      title,
      ...described,
      collections,
      tagNames,
      thumbR2Key,
      frames,
      searchText,
      createdAt: now,
      updatedAt: now,
    });
    return { id, created: true };
  },
});

const fetchFirstImage = async (candidates: string[]) => {
  for (const candidate of candidates) {
    if (!candidate.startsWith("https://")) continue;
    try {
      const response = await fetch(candidate);
      if (!response.ok) continue;
      const type = response.headers.get("content-type") ?? "";
      if (!type.startsWith("image/")) continue;
      const blob = await response.blob();
      if (blob.size < MIN_IMAGE_BYTES || blob.size > MAX_IMAGE_BYTES) continue;
      return { blob, type, sourceUrl: candidate };
    } catch {
      continue;
    }
  }
  return null;
};

type SaveResult = {
  url: string;
  id?: Id<"videoRefs">;
  created?: boolean;
  frameCount?: number;
  error?: string;
};

// Saves up to 12 videos per call. For each new video the action copies the
// thumbnail and the in-video frames into R2; a video that already has its
// stills keeps them unless `refreshMedia` is set.
export const saveVideoRefs = ownerAction({
  args: {
    ownerUserId: v.string(),
    items: v.array(videoRefInputValidator),
    refreshMedia: v.optional(v.boolean()),
  },
  returns: v.array(
    v.object({
      url: v.string(),
      id: v.optional(v.id("videoRefs")),
      created: v.optional(v.boolean()),
      frameCount: v.optional(v.number()),
      error: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args): Promise<SaveResult[]> => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) throw new ConvexError("ownerUserId is required.");
    if (args.items.length > MAX_ITEMS_PER_SAVE) {
      throw new ConvexError(`Save at most ${MAX_ITEMS_PER_SAVE} videos per call.`);
    }

    const results: SaveResult[] = [];
    for (const item of args.items) {
      const externalId = parseYouTubeId(item.url);
      if (!externalId) {
        results.push({ url: item.url, error: "Not a YouTube video link or id." });
        continue;
      }
      try {
        const existing: { hasThumb: boolean; frameCount: number } | null = await ctx.runQuery(
          internal.videoRefs.getVideoRefForSave,
          { ownerUserId, externalId },
        );
        let thumbR2Key: string | undefined;
        let frames: Doc<"videoRefs">["frames"] | undefined;

        if (!existing?.hasThumb || args.refreshMedia) {
          const thumb = await fetchFirstImage(
            item.thumbnailUrl ? [item.thumbnailUrl] : youTubeThumbnailCandidates(externalId),
          );
          if (thumb) thumbR2Key = await storeBlobToR2(ctx, thumb.blob, { type: thumb.type });
        }
        if (!existing || existing.frameCount === 0 || args.refreshMedia) {
          const sources: string[][] = item.frameUrls?.length
            ? item.frameUrls.slice(0, MAX_FRAMES).map((frameUrl) => [frameUrl])
            : ([1, 2, 3] as const).map((index) => youTubeFrameCandidates(externalId, index));
          const stored: Doc<"videoRefs">["frames"] = [];
          for (const [index, candidates] of sources.entries()) {
            const frame = await fetchFirstImage(candidates);
            if (!frame) continue;
            stored.push({
              r2Key: await storeBlobToR2(ctx, frame.blob, { type: frame.type }),
              label: item.frameUrls?.length ? undefined : `YouTube still ${index + 1}`,
              sourceKind: item.frameUrls?.length ? "supplied-still" : "youtube-auto-still",
              sourceUrl: frame.sourceUrl,
            });
          }
          frames = stored;
        }

        const { url: _url, thumbnailUrl: _thumb, frameUrls: _frames, collections, tagNames, ...rest } = item;
        void _url;
        void _thumb;
        void _frames;
        const saved: { id: Id<"videoRefs">; created: boolean } = await ctx.runMutation(
          internal.videoRefs.upsertVideoRef,
          {
            ownerUserId,
            externalId,
            ...rest,
            collections: cleanLabels(collections),
            tagNames: cleanLabels(tagNames),
            thumbR2Key,
            frames,
          },
        );
        results.push({
          url: youTubeWatchUrl(externalId),
          id: saved.id,
          created: saved.created,
          frameCount: frames?.length ?? existing?.frameCount ?? 0,
        });
      } catch (error) {
        results.push({
          url: item.url,
          error: error instanceof Error ? error.message : "Save failed.",
        });
      }
    }
    return results;
  },
});

// The Videos tab and the agent listing. Filters are all optional; `sort`
// defaults to most views. `search` matches every word against the title,
// channel, style and notes. `tagNames` keeps rows that carry every tag given.
export const listVideoRefs = ownerQuery({
  args: {
    ownerUserId: v.string(),
    collection: v.optional(v.string()),
    topic: v.optional(v.string()),
    styleFamily: v.optional(v.string()),
    productionStyle: v.optional(v.string()),
    language: v.optional(v.string()),
    tagNames: v.optional(v.array(v.string())),
    channelHandle: v.optional(v.string()),
    search: v.optional(v.string()),
    onlyLiked: v.optional(v.boolean()),
    onlyChannelBest: v.optional(v.boolean()),
    minViews: v.optional(v.number()),
    publishedAfter: v.optional(v.number()),
    sort: v.optional(v.union(v.literal("views"), v.literal("recent"), v.literal("saved"))),
    limit: v.optional(v.number()),
  },
  returns: v.array(videoRefResultValidator),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) throw new ConvexError("ownerUserId is required.");
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? DEFAULT_LIST_LIMIT), MAX_LIST_LIMIT));
    const rows = (await collectOwnerRows(ctx, ownerUserId))
      .filter((row) => matchesVideoRef(row, args))
      .sort(compareVideoRefs(args.sort ?? "views"));
    return rows.slice(0, limit).map(toResult);
  },
});

// Complete inventory traversal follows native Convex cursors. Unlike the
// ranked convenience listing, each page scans a bounded owner index range.
export const listVideoRefsPage = signedOwnerQuery({
  args: {
    ownerUserId: v.string(), cursor: v.optional(v.union(v.string(), v.null())), pageSize: v.optional(v.number()),
    collection: v.optional(v.string()), topic: v.optional(v.string()), styleFamily: v.optional(v.string()),
    productionStyle: v.optional(v.string()), language: v.optional(v.string()), tagNames: v.optional(v.array(v.string())),
    channelHandle: v.optional(v.string()), search: v.optional(v.string()), onlyLiked: v.optional(v.boolean()),
    onlyChannelBest: v.optional(v.boolean()), minViews: v.optional(v.number()), publishedAfter: v.optional(v.number()),
  },
  returns: v.object({ videos: v.array(videoRefResultValidator), cursor: v.union(v.string(), v.null()), isDone: v.boolean(), scannedCount: v.number(), order: v.literal("owner-candidate-createdAt-desc") }),
  handler: async (ctx, args) => {
    const { cursor, pageSize = 100, ...filters } = args;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) throw new ConvexError("pageSize must be an integer from 1 to 200.");
    const key = JSON.stringify(filters);
    const owners = resolveUserIdCandidates(args.ownerUserId);
    type Cursor = { v: 1; key: string; owner: number; cursor: string | null };
    let state: Cursor = { v: 1, key, owner: 0, cursor: null };
    if (cursor) {
      try {
        const parsed = JSON.parse(cursor) as Cursor;
        if (parsed.v !== 1 || parsed.key !== key || !Number.isInteger(parsed.owner) || parsed.owner < 0 || parsed.owner >= owners.length || !(parsed.cursor === null || typeof parsed.cursor === "string")) throw new Error("Invalid cursor");
        state = parsed;
      } catch { throw new ConvexError("Invalid cursor or listing filters changed. Restart the listing."); }
    }
    const batch = await ctx.db.query("videoRefs").withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", owners[state.owner])).order("desc").paginate({ cursor: state.cursor, numItems: pageSize });
    const videos = batch.page.filter((row) => matchesVideoRef(row, filters)).map(toResult);
    const isDone = batch.isDone && state.owner === owners.length - 1;
    const next: Cursor = batch.isDone ? { v: 1, key, owner: state.owner + 1, cursor: null } : { ...state, cursor: batch.continueCursor };
    return { videos, cursor: isDone ? null : JSON.stringify(next), isDone, scannedCount: batch.page.length, order: "owner-candidate-createdAt-desc" as const };
  },
});

export const getVideoRef = ownerQuery({
  args: { ownerUserId: v.string(), id: v.id("videoRefs") },
  returns: v.union(v.null(), videoRefResultValidator),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || !canActorAccessOwnerUserId(args.ownerUserId.trim(), row.ownerUserId)) return null;
    return toResult(row);
  },
});

// The owner's own edits: note, like, and which collections it sits in.
export const updateVideoRef = ownerMutation({
  args: {
    ownerUserId: v.string(),
    id: v.id("videoRefs"),
    userNote: v.optional(v.string()),
    isLiked: v.optional(v.boolean()),
    collections: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || !canActorAccessOwnerUserId(args.ownerUserId.trim(), row.ownerUserId)) {
      throw new ConvexError("Video reference not found.");
    }
    const userNote = args.userNote === undefined ? row.userNote : clip(args.userNote);
    const collections = args.collections ? cleanLabels(args.collections) : row.collections;
    await ctx.db.patch(row._id, {
      userNote,
      isLiked: args.isLiked ?? row.isLiked,
      collections,
      searchText: searchTextFor({ ...row, userNote, collections }),
      updatedAt: Date.now(),
    });
    return null;
  },
});

// Removes the row. The R2 stills stay (objects are immutable and unshared
// keys cost nothing to leave); the row is what the gallery shows.
export const deleteVideoRef = ownerMutation({
  args: { ownerUserId: v.string(), id: v.id("videoRefs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || !canActorAccessOwnerUserId(args.ownerUserId.trim(), row.ownerUserId)) {
      throw new ConvexError("Video reference not found.");
    }
    await ctx.db.delete(row._id);
    return null;
  },
});
