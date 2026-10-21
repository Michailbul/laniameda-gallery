import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { signedOwnerQuery as ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { resolveAssetThumbUrl } from "./r2_url";
import { clusterByHash, isDHash } from "../lib/perceptual-hash";

// Perceptual hashes (dHash) per image. Computed once, by convex/perceptualHash.ts
// (Node, sharp) at ingest and by a batched backfill. Read in two ways:
// listAssetHashes gives the grid every hash at once for "Group similar";
// findSimilarGroups clusters one collection for agents (the duplicates routine).

const MAX_OWNER_HASHES = 20000;
const MAX_FOLDER_MEMBERS = 3000;

const hashOf = (ctx: QueryCtx, assetId: Id<"assets">) =>
  ctx.db.query("assetHashes").withIndex("by_asset", (q) => q.eq("assetId", assetId)).first();

/** For the hashing action: where to read the image, and whether it is done. */
export const getAssetForHash = internalQuery({
  args: { assetId: v.id("assets") },
  returns: v.union(v.null(), v.object({ url: v.optional(v.string()), ownerUserId: v.string(), hashed: v.boolean() })),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) return null;
    return {
      // The card thumbnail (a video's poster) is plenty for a 9×8 hash.
      url: await resolveAssetThumbUrl(ctx, asset),
      ownerUserId: asset.ownerUserId ?? "",
      hashed: Boolean(await hashOf(ctx, asset._id)),
    };
  },
});

export const setAssetHash = internalMutation({
  args: { assetId: v.id("assets"), dHash: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    if (!isDHash(args.dHash)) throw new ConvexError("A dHash is 16 hex characters.");
    const asset = await ctx.db.get(args.assetId);
    if (!asset) return false;
    const existing = await hashOf(ctx, asset._id);
    if (existing) {
      if (existing.dHash !== args.dHash) await ctx.db.patch(existing._id, { dHash: args.dHash });
      return true;
    }
    await ctx.db.insert("assetHashes", { ownerUserId: asset.ownerUserId ?? "", assetId: asset._id, dHash: args.dHash, createdAt: Date.now() });
    return true;
  },
});

/** Part of the asset delete cascade. */
export const deleteHashForAsset = async (ctx: MutationCtx, assetId: Id<"assets">) => {
  const row = await hashOf(ctx, assetId);
  if (row) await ctx.db.delete(row._id);
};

/** One page of an owner's assets that have no hash yet (backfill). */
export const listAssetsMissingHash = internalQuery({
  args: { ownerUserId: v.string(), cursor: v.optional(v.union(v.string(), v.null())), batchSize: v.optional(v.number()) },
  returns: v.object({ assetIds: v.array(v.id("assets")), nextCursor: v.union(v.string(), v.null()), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("assets")
      .withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", args.ownerUserId).gte("createdAt", 0))
      .paginate({ cursor: args.cursor ?? null, numItems: Math.min(100, Math.max(1, args.batchSize ?? 25)) });
    const assetIds: Id<"assets">[] = [];
    for (const asset of page.page) if (!await hashOf(ctx, asset._id)) assetIds.push(asset._id);
    return { assetIds, nextCursor: page.continueCursor, isDone: page.isDone };
  },
});

/** Every hash of the owner, compact: what "Group similar" clusters on. */
export const listAssetHashes = ownerQuery({
  args: { ownerUserId: v.string() },
  returns: v.array(v.object({ a: v.id("assets"), h: v.string() })),
  handler: async (ctx, args) => {
    const rows: Doc<"assetHashes">[] = [];
    for (const candidate of resolveUserIdCandidates(args.ownerUserId)) {
      rows.push(...await ctx.db.query("assetHashes").withIndex("by_owner", (q) => q.eq("ownerUserId", candidate)).take(MAX_OWNER_HASHES));
    }
    return rows.map((row) => ({ a: row.assetId, h: row.dHash }));
  },
});

const groupAssetValidator = v.object({
  assetId: v.id("assets"),
  thumbUrl: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  promptId: v.optional(v.id("prompts")),
  createdAt: v.number(),
});

/**
 * Groups of near-identical images in one collection (with its child
 * collections), largest first. maxDistance is the largest hash difference
 * inside a group, in bits of 64: 4 ≈ the takes of one job, 10 ≈ the same
 * shot reworked, 20 ≈ the same subject.
 */
export const findSimilarGroups = ownerQuery({
  args: {
    ownerUserId: v.string(),
    folderId: v.id("folders"),
    includeChildren: v.optional(v.boolean()),
    maxDistance: v.optional(v.number()),
    minSize: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    scanned: v.number(),
    hashed: v.number(),
    // The collection holds more pieces than one read covers; the newest were scanned.
    truncated: v.boolean(),
    groups: v.array(v.object({ maxDistance: v.number(), assets: v.array(groupAssetValidator) })),
  }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const folder = await ctx.db.get(args.folderId);
    if (!folder || !canActorAccessOwnerUserId(owner, folder.ownerUserId)) throw new ConvexError("Collection not found.");
    const folderIds = [folder._id];
    if (args.includeChildren) {
      const children = await ctx.db.query("folders").withIndex("by_parent", (q) => q.eq("parentFolderId", folder._id)).collect();
      folderIds.push(...children.filter((child) => canActorAccessOwnerUserId(owner, child.ownerUserId)).map((child) => child._id));
    }
    const memberIds: Id<"assets">[] = [];
    const seen = new Set<string>();
    let truncated = false;
    for (const folderId of folderIds) {
      const links = await ctx.db.query("assetFolders").withIndex("by_folder_createdAt", (q) => q.eq("folderId", folderId)).order("desc").take(MAX_FOLDER_MEMBERS + 1);
      if (links.length > MAX_FOLDER_MEMBERS) truncated = true;
      for (const link of links.slice(0, MAX_FOLDER_MEMBERS)) {
        if (seen.has(link.assetId) || memberIds.length >= MAX_FOLDER_MEMBERS) continue;
        seen.add(link.assetId);
        memberIds.push(link.assetId);
      }
    }
    // Older pieces may carry only the primary pointer (assets.folderId) and
    // no link row; the gallery counts those as members too.
    for (const folderId of folderIds) {
      if (memberIds.length >= MAX_FOLDER_MEMBERS) break;
      const primaries = await ctx.db.query("assets").withIndex("by_folder_createdAt", (q) => q.eq("folderId", folderId)).order("desc").take(MAX_FOLDER_MEMBERS - memberIds.length);
      for (const asset of primaries) {
        if (seen.has(asset._id) || !canActorAccessOwnerUserId(owner, asset.ownerUserId)) continue;
        seen.add(asset._id);
        memberIds.push(asset._id);
      }
    }
    if (memberIds.length >= MAX_FOLDER_MEMBERS) truncated = true;
    const items = [];
    for (const assetId of memberIds) {
      const row = await hashOf(ctx, assetId);
      if (row && canActorAccessOwnerUserId(owner, row.ownerUserId)) items.push({ id: assetId as string, hash: row.dHash });
    }
    const maxDistance = Math.min(24, Math.max(0, Math.round(args.maxDistance ?? 6)));
    const minSize = Math.max(2, Math.floor(args.minSize ?? 2));
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 30)));
    const clusters = clusterByHash(items, maxDistance).filter((cluster) => cluster.ids.length >= minSize).slice(0, limit);
    const groups = [];
    for (const cluster of clusters) {
      const assets = [];
      for (const id of cluster.ids) {
        const asset = await ctx.db.get(id as Id<"assets">);
        if (!asset) continue;
        assets.push({
          assetId: asset._id, thumbUrl: await resolveAssetThumbUrl(ctx, asset), width: asset.width, height: asset.height,
          promptId: asset.promptId, createdAt: asset.createdAt,
        });
      }
      if (assets.length >= minSize) groups.push({ maxDistance: cluster.maxDistance, assets });
    }
    return { scanned: memberIds.length, hashed: items.length, truncated, groups };
  },
});
