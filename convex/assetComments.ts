import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { signedOwnerMutation as ownerMutation, signedOwnerQuery as ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";

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
  createdAt: v.number(),
  updatedAt: v.number(),
});

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

const toResult = (comment: {
  _id: Id<"assetComments">; assetId: Id<"assets">; body: string;
  author: "owner" | "agent"; createdAt: number; updatedAt: number;
}) => ({
  _id: comment._id,
  assetId: comment.assetId,
  body: comment.body,
  author: comment.author,
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
    return rows
      .filter((row) => canActorAccessOwnerUserId(args.ownerUserId, row.ownerUserId))
      .map(toResult);
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
    return rows
      .filter((row) => !args.author || row.author === args.author)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, limit)
      .map(toResult);
  },
});

export const addAssetComment = ownerMutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    body: v.string(),
    author: v.optional(authorValidator),
  },
  returns: assetCommentValidator,
  handler: async (ctx, args) => {
    const asset = await ownedAsset(ctx, args.ownerUserId, args.assetId);
    const now = Date.now();
    const doc = {
      ownerUserId: asset.ownerUserId ?? args.ownerUserId,
      assetId: args.assetId,
      body: cleanBody(args.body),
      author: args.author ?? ("owner" as const),
      createdAt: now,
      updatedAt: now,
    };
    const _id = await ctx.db.insert("assetComments", doc);
    return toResult({ _id, ...doc });
  },
});

export const updateAssetComment = ownerMutation({
  args: { ownerUserId: v.string(), commentId: v.id("assetComments"), body: v.string() },
  returns: assetCommentValidator,
  handler: async (ctx, args) => {
    const comment = await ownedComment(ctx, args.ownerUserId, args.commentId);
    const patch = { body: cleanBody(args.body), updatedAt: Date.now() };
    await ctx.db.patch(comment._id, patch);
    return toResult({ ...comment, ...patch });
  },
});

export const deleteAssetComment = ownerMutation({
  args: { ownerUserId: v.string(), commentId: v.id("assetComments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const comment = await ownedComment(ctx, args.ownerUserId, args.commentId);
    await ctx.db.delete(comment._id);
    return null;
  },
});

/** Part of the asset delete cascade: a thread goes with its asset. */
export const deleteCommentsForAsset = async (ctx: MutationCtx, assetId: Id<"assets">) => {
  const rows = await ctx.db
    .query("assetComments")
    .withIndex("by_asset_createdAt", (q) => q.eq("assetId", assetId))
    .collect();
  for (const row of rows) await ctx.db.delete(row._id);
};
