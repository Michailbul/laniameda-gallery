import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { signedOwnerMutation as ownerMutation, signedOwnerQuery as ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { worldsOfAsset } from "./worldCore";
import { upsertTask } from "./tasks";
import { titleFromText } from "../lib/tasks";

// Comments on an asset: Michael's notes from the detail panel and agents'
// replies, oldest first, so a thread reads top to bottom.

export const ASSET_COMMENT_MAX_LENGTH = 4000;
const LIST_LIMIT = 200;

const authorValidator = v.union(v.literal("owner"), v.literal("agent"));

export const assetCommentValidator = v.object({
  _id: v.id("assetComments"),
  assetId: v.id("assets"),
  body: v.string(),
  author: authorValidator,
  // A voice note: a playable URL, its length and type.
  audioUrl: v.optional(v.string()),
  audioDurationMs: v.optional(v.number()),
  audioContentType: v.optional(v.string()),
  source: v.optional(v.literal("inbox")),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const AUDIO_MAX_BYTES = 15 * 1024 * 1024;
const AUDIO_MAX_MS = 10 * 60 * 1000;
const AUDIO_TYPE = /^(audio\/[\w.+-]+|video\/webm|video\/mp4)(;.*)?$/i;

const audioArg = v.object({
  storageId: v.id("_storage"),
  durationMs: v.number(),
  contentType: v.optional(v.string()),
});

// Checks an uploaded voice note before a comment points at it.
const checkAudio = async (ctx: QueryCtx, audio: { storageId: Id<"_storage">; durationMs: number; contentType?: string }) => {
  const durationMs = Math.round(audio.durationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > AUDIO_MAX_MS) {
    throw new ConvexError(`A voice note runs at most ${AUDIO_MAX_MS / 60000} minutes.`);
  }
  const meta = await ctx.db.system.get(audio.storageId);
  if (!meta) throw new ConvexError("The recording upload was not found.");
  if (meta.size > AUDIO_MAX_BYTES) throw new ConvexError("The recording is too large.");
  const contentType = audio.contentType ?? meta.contentType ?? undefined;
  if (contentType && !AUDIO_TYPE.test(contentType)) throw new ConvexError("A voice note must be audio.");
  return { audioStorageId: audio.storageId, audioDurationMs: durationMs, audioContentType: contentType };
};

const cleanBody = (value: string) => {
  const body = value.trim();
  if (!body) throw new ConvexError("A comment needs text.");
  if (body.length > ASSET_COMMENT_MAX_LENGTH) {
    throw new ConvexError(`A comment is limited to ${ASSET_COMMENT_MAX_LENGTH} characters.`);
  }
  return body;
};

const ownedAsset = async (ctx: QueryCtx, owner: string, assetId: Id<"assets">) => {
  const asset = await ctx.db.get(assetId);
  if (!asset || !canActorAccessOwnerUserId(owner, asset.ownerUserId)) {
    throw new ConvexError("Asset not found.");
  }
  return asset;
};

const ownedComment = async (ctx: QueryCtx, owner: string, commentId: Id<"assetComments">) => {
  const comment = await ctx.db.get(commentId);
  if (!comment || !canActorAccessOwnerUserId(owner, comment.ownerUserId)) {
    throw new ConvexError("Comment not found.");
  }
  return comment;
};

type CommentRow = {
  _id: Id<"assetComments">; assetId: Id<"assets">; body: string;
  author: "owner" | "agent"; createdAt: number; updatedAt: number;
  audioStorageId?: Id<"_storage">; audioDurationMs?: number; audioContentType?: string; source?: "inbox";
};

const toResult = async (ctx: QueryCtx, comment: CommentRow) => ({
  _id: comment._id,
  assetId: comment.assetId,
  body: comment.body,
  author: comment.author,
  ...(comment.audioStorageId ? {
    audioUrl: (await ctx.storage.getUrl(comment.audioStorageId)) ?? undefined,
    audioDurationMs: comment.audioDurationMs,
    audioContentType: comment.audioContentType,
  } : {}),
  ...(comment.source ? { source: comment.source } : {}),
  createdAt: comment.createdAt,
  updatedAt: comment.updatedAt,
});

/** One asset's thread, oldest first. */
export const listAssetComments = ownerQuery({
  args: { ownerUserId: v.string(), assetId: v.id("assets") },
  returns: v.array(assetCommentValidator),
  handler: async (ctx, args) => {
    await ownedAsset(ctx, args.ownerUserId, args.assetId);
    const rows = await ctx.db
      .query("assetComments")
      .withIndex("by_asset_createdAt", (q) => q.eq("assetId", args.assetId))
      .order("asc")
      .take(LIST_LIMIT);
    return await Promise.all(rows
      .filter((row) => canActorAccessOwnerUserId(args.ownerUserId, row.ownerUserId))
      .map((row) => toResult(ctx, row)));
  },
});

/** The newest comments across the vault, newest first; `since` in ms. */
export const listRecentAssetComments = ownerQuery({
  args: {
    ownerUserId: v.string(),
    since: v.optional(v.number()),
    author: v.optional(authorValidator),
    limit: v.optional(v.number()),
  },
  returns: v.array(assetCommentValidator),
  handler: async (ctx, args) => {
    const limit = Math.min(LIST_LIMIT, Math.max(1, Math.floor(args.limit ?? 50)));
    const rows = [];
    for (const owner of resolveUserIdCandidates(args.ownerUserId)) {
      const page = await ctx.db
        .query("assetComments")
        .withIndex("by_owner_createdAt", (q) =>
          q.eq("ownerUserId", owner).gte("createdAt", args.since ?? 0),
        )
        .order("desc")
        .take(limit * 2);
      rows.push(...page);
    }
    return await Promise.all(rows
      .filter((row) => !args.author || row.author === args.author)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, limit)
      .map((row) => toResult(ctx, row)));
  },
});

export const addAssetComment = ownerMutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    body: v.string(),
    author: v.optional(authorValidator),
    // A voice note uploaded with generateCommentAudioUploadUrl. With one, the
    // text may be empty.
    audio: v.optional(audioArg),
    source: v.optional(v.literal("inbox")),
  },
  returns: assetCommentValidator,
  handler: async (ctx, args) => {
    const asset = await ownedAsset(ctx, args.ownerUserId, args.assetId);
    const now = Date.now();
    const audio = args.audio ? await checkAudio(ctx, args.audio) : undefined;
    const doc = {
      ownerUserId: asset.ownerUserId ?? args.ownerUserId,
      assetId: args.assetId,
      body: audio && !args.body.trim() ? "" : cleanBody(args.body),
      author: args.author ?? ("owner" as const),
      ...(audio ?? {}),
      ...(args.source ? { source: args.source } : {}),
      createdAt: now,
      updatedAt: now,
    };
    const _id = await ctx.db.insert("assetComments", doc);
    // Michael's comment is work: it becomes a task an agent picks up, so
    // nothing he writes is missed. Notes left in the Inbox travel with the
    // stack's own task instead.
    if (doc.author === "owner" && doc.source !== "inbox") {
      await taskFromOwnerComment(ctx, args.ownerUserId, asset, { _id, body: doc.body, hasAudio: Boolean(audio) });
    }
    return await toResult(ctx, { _id, ...doc });
  },
});

const taskFromOwnerComment = async (
  ctx: MutationCtx, owner: string, asset: Doc<"assets">,
  comment: { _id: Id<"assetComments">; body: string; hasAudio: boolean },
) => {
  const worldFolderId = [...await worldsOfAsset(ctx, asset)][0];
  const what = comment.body ? titleFromText(comment.body, 100) : "Voice note";
  await upsertTask(ctx, owner, {
    worldFolderId,
    title: `Comment on asset:${asset._id}: ${what}`,
    brief: [
      comment.body || "_A voice note: read the thread with list_asset_comments and transcribe it._",
      "",
      `Michael's comment on asset:${asset._id}. Act on it, then reply on the asset with add_asset_comment and complete this task naming what changed.`,
    ].join("\n"),
    priority: 2,
    createdBy: "owner",
    links: [{ kind: "asset", id: asset._id }],
    source: "comment",
    sourceRef: comment._id,
    ingestKey: `comment:${comment._id}`,
  });
};

export const updateAssetComment = ownerMutation({
  args: { ownerUserId: v.string(), commentId: v.id("assetComments"), body: v.string() },
  returns: assetCommentValidator,
  handler: async (ctx, args) => {
    const comment = await ownedComment(ctx, args.ownerUserId, args.commentId);
    const patch = { body: comment.audioStorageId && !args.body.trim() ? "" : cleanBody(args.body), updatedAt: Date.now() };
    await ctx.db.patch(comment._id, patch);
    return await toResult(ctx, { ...comment, ...patch });
  },
});

export const deleteAssetComment = ownerMutation({
  args: { ownerUserId: v.string(), commentId: v.id("assetComments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const comment = await ownedComment(ctx, args.ownerUserId, args.commentId);
    if (comment.audioStorageId) await ctx.storage.delete(comment.audioStorageId);
    await ctx.db.delete(comment._id);
    return null;
  },
});

/** An upload URL for a voice note; pass the returned storageId as `audio`. */
export const generateCommentAudioUploadUrl = ownerMutation({
  args: { ownerUserId: v.string() },
  returns: v.string(),
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

/** Part of the asset delete cascade: a thread goes with its asset. */
export const deleteCommentsForAsset = async (ctx: MutationCtx, assetId: Id<"assets">) => {
  const rows = await ctx.db
    .query("assetComments")
    .withIndex("by_asset_createdAt", (q) => q.eq("assetId", assetId))
    .collect();
  for (const row of rows) {
    if (row.audioStorageId) await ctx.storage.delete(row.audioStorageId);
    await ctx.db.delete(row._id);
  }
};
