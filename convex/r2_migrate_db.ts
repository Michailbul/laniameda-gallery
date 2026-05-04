// DB-side helpers for the R2 migration. The action driver in
// convex/r2_migrate.ts ("use node") cannot run query/mutation logic
// directly, so we expose paginated reads + targeted patches here.

import { v } from "convex/values";
import { internalQuery, mutation } from "./_generated/server";

const PAGE_SIZE_DEFAULT = 25;

export const listMigrationCandidates = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(
      v.object({
        _id: v.id("assets"),
        ownerUserId: v.optional(v.string()),
        kind: v.union(v.literal("image"), v.literal("video")),
        storageId: v.optional(v.id("_storage")),
        r2Key: v.optional(v.string()),
        contentType: v.optional(v.string()),
        size: v.optional(v.number()),
        fileName: v.optional(v.string()),
      }),
    ),
    nextCursor: v.optional(v.string()),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const limit = args.batchSize ?? PAGE_SIZE_DEFAULT;
    const result = await ctx.db
      .query("assets")
      .withIndex("by_kind_createdAt", (q) => q.eq("kind", "video"))
      .order("asc")
      .paginate({
        numItems: limit,
        cursor: args.cursor ?? null,
      });

    const items = result.page
      .filter((asset) => Boolean(asset.storageId) && !asset.r2Key)
      .map((asset) => ({
        _id: asset._id,
        ownerUserId: asset.ownerUserId,
        kind: asset.kind,
        storageId: asset.storageId,
        r2Key: asset.r2Key,
        contentType: asset.contentType,
        size: asset.size,
        fileName: asset.fileName,
      }));

    return {
      items,
      nextCursor: result.isDone ? undefined : result.continueCursor,
      done: result.isDone,
    };
  },
});

export const listCleanupCandidates = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(
      v.object({
        _id: v.id("assets"),
        ownerUserId: v.optional(v.string()),
        kind: v.union(v.literal("image"), v.literal("video")),
        storageId: v.optional(v.id("_storage")),
        r2Key: v.optional(v.string()),
        contentType: v.optional(v.string()),
        size: v.optional(v.number()),
        fileName: v.optional(v.string()),
      }),
    ),
    nextCursor: v.optional(v.string()),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const limit = args.batchSize ?? PAGE_SIZE_DEFAULT;
    const result = await ctx.db
      .query("assets")
      .withIndex("by_kind_createdAt", (q) => q.eq("kind", "video"))
      .order("asc")
      .paginate({
        numItems: limit,
        cursor: args.cursor ?? null,
      });

    const items = result.page
      .filter((asset) => Boolean(asset.r2Key) && Boolean(asset.storageId))
      .map((asset) => ({
        _id: asset._id,
        ownerUserId: asset.ownerUserId,
        kind: asset.kind,
        storageId: asset.storageId,
        r2Key: asset.r2Key,
        contentType: asset.contentType,
        size: asset.size,
        fileName: asset.fileName,
      }));

    return {
      items,
      nextCursor: result.isDone ? undefined : result.continueCursor,
      done: result.isDone,
    };
  },
});

export const markAssetMigrated = mutation({
  args: {
    assetId: v.id("assets"),
    r2Key: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.assetId, {
      r2Key: args.r2Key,
    });
    return null;
  },
});

export const dropConvexBlob = mutation({
  args: {
    assetId: v.id("assets"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) return null;
    if (!asset.r2Key) {
      // Safety: never strip storageId from a row that isn't on R2 yet.
      return null;
    }
    if (asset.storageId) {
      await ctx.storage.delete(asset.storageId);
      await ctx.db.patch(args.assetId, { storageId: undefined });
    }
    return null;
  },
});
