import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";

const getBackfill = async (ctx: QueryCtx | MutationCtx) =>
  await ctx.db.query("publicCollectionCountBackfill")
    .withIndex("by_key", (q) => q.eq("key", "v1"))
    .unique();

export const publicCollectionCountsReady = async (ctx: QueryCtx | MutationCtx) =>
  (await getBackfill(ctx))?.complete === true;

/**
 * Call after a public flag, primary folder, or assetFolders mutation, and
 * after deleting an asset. The snapshot represents what was actually added
 * to counters, not a guessed previous source state. It makes partial rollout,
 * retries, legacy primary-only membership and duplicate joins safe.
 */
export const syncPublicCollectionMembership = async (
  ctx: MutationCtx,
  assetId: Id<"assets">,
) => {
  const previous = await ctx.db.query("publicCollectionMemberships")
    .withIndex("by_asset", (q) => q.eq("assetId", assetId))
    .unique();
  const asset = await ctx.db.get(assetId);
  const next = new Set<Id<"folders">>();
  // Match listPublicCollections' existing public index range exactly.
  if (asset?.isPublic === true && asset.createdAt >= 0) {
    const links = await ctx.db.query("assetFolders")
      .withIndex("by_asset", (q) => q.eq("assetId", assetId))
      .collect();
    for (const link of links) next.add(link.folderId);
    if (asset.folderId) next.add(asset.folderId);
  }

  const before = new Set(previous?.folderIds ?? []);
  for (const folderId of new Set([...before, ...next])) {
    const delta = Number(next.has(folderId)) - Number(before.has(folderId));
    if (delta === 0) continue;
    const folder = await ctx.db.get(folderId);
    if (!folder) continue;
    const count = (folder.publicMemberCount ?? 0) + delta;
    if (count < 0) {
      // Never silently clamp drift into an apparently authoritative count.
      throw new ConvexError("Public collection counts need repair.");
    }
    await ctx.db.patch(folderId, { publicMemberCount: count });
  }

  if (next.size === 0) {
    if (previous) await ctx.db.delete(previous._id);
  } else if (!previous) {
    await ctx.db.insert("publicCollectionMemberships", { assetId, folderIds: [...next] });
  } else if (next.size !== before.size || [...next].some((id) => !before.has(id))) {
    await ctx.db.patch(previous._id, { folderIds: [...next] });
  }
};

const progressValidator = v.object({
  complete: v.boolean(),
  cursor: v.union(v.string(), v.null()),
  scanned: v.number(),
});

// Read-only operational check; never accessible to an anonymous browser.
export const status = internalQuery({
  args: {},
  returns: progressValidator,
  handler: async (ctx) => {
    const state = await getBackfill(ctx);
    return { complete: state?.complete ?? false, cursor: state?.cursor ?? null, scanned: state?.scanned ?? 0 };
  },
});

// Explicitly invoked by an authorized operator, never scheduled on reads.
// The stored cursor and per-asset snapshots make retries/resume idempotent.
// Pagination uses immutable _creationTime, so edits cannot move unseen rows
// behind the cursor. Live mutation hooks cover inserts/updates/deletes while
// these small transactions progress; completion is atomic with the last page.
export const backfill = internalMutation({
  args: { batchSize: v.optional(v.number()) },
  returns: progressValidator,
  handler: async (ctx, args) => {
    const state = await getBackfill(ctx);
    if (state?.complete) return { complete: true, cursor: state.cursor, scanned: state.scanned };
    const requested = args.batchSize ?? 25;
    if (!Number.isInteger(requested) || requested < 1 || requested > 100) {
      throw new ConvexError("batchSize must be an integer between 1 and 100.");
    }
    const page = await ctx.db.query("assets").order("asc").paginate({
      cursor: state?.cursor ?? null,
      numItems: requested,
      maximumRowsRead: requested,
      maximumBytesRead: 512_000,
    });
    for (const asset of page.page) await syncPublicCollectionMembership(ctx, asset._id);
    const progress = {
      complete: page.isDone,
      cursor: page.continueCursor,
      scanned: (state?.scanned ?? 0) + page.page.length,
    };
    if (state) await ctx.db.patch(state._id, progress);
    else await ctx.db.insert("publicCollectionCountBackfill", { key: "v1", ...progress });
    return progress;
  },
});
