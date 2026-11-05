import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { internalMutation } from "./_generated/server";
import { signedOwnerMutation, signedOwnerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { resolveAssetThumbUrl, resolveAssetUrl } from "./r2_url";

export const ARCHIVE_DELAY_MS = 10 * 60 * 1000;
const finishRef = makeFunctionReference<"mutation">(
  "assetReview:finishDeletion",
);
const deleteRef = makeFunctionReference<"mutation">(
  "assets:internalDeleteAsset",
);

export const archive = signedOwnerMutation({
  args: { ownerUserId: v.string(), assetId: v.id("assets") },
  returns: v.number(),
  handler: async (ctx, { ownerUserId, assetId }) => {
    const asset = await ctx.db.get(assetId);
    if (!asset || !canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId))
      throw new ConvexError("Asset not found.");
    const existing = await ctx.db
      .query("assetArchive")
      .withIndex("by_asset", (q) => q.eq("assetId", assetId))
      .unique();
    if (existing) return existing.deleteAt;
    const deleteAt = Date.now() + ARCHIVE_DELAY_MS;
    const archiveId = await ctx.db.insert("assetArchive", {
      ownerUserId,
      assetId,
      deleteAt,
    });
    await ctx.scheduler.runAfter(ARCHIVE_DELAY_MS, finishRef, { archiveId });
    return deleteAt;
  },
});

export const restore = signedOwnerMutation({
  args: { ownerUserId: v.string(), assetId: v.id("assets") },
  returns: v.null(),
  handler: async (ctx, { ownerUserId, assetId }) => {
    const entry = await ctx.db
      .query("assetArchive")
      .withIndex("by_asset", (q) => q.eq("assetId", assetId))
      .unique();
    if (!entry) return null;
    if (!canActorAccessOwnerUserId(ownerUserId, entry.ownerUserId))
      throw new ConvexError("Asset not found.");
    // Deleting the ticket makes any already scheduled callback harmless.
    await ctx.db.delete(entry._id);
    return null;
  },
});

export const list = signedOwnerQuery({
  args: { ownerUserId: v.string() },
  returns: v.array(
    v.object({
      assetId: v.id("assets"),
      deleteAt: v.number(),
      name: v.string(),
      thumb: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { ownerUserId }) => {
    const result = [];
    for (const owner of resolveUserIdCandidates(ownerUserId)) {
      const entries = await ctx.db
        .query("assetArchive")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", owner))
        .collect();
      for (const entry of entries) {
        const asset = await ctx.db.get(entry.assetId);
        if (
          !asset ||
          !canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)
        )
          continue;
        const thumb =
          asset.kind === "video" && !asset.thumbStorageId && !asset.thumbR2Key
            ? null
            : ((await resolveAssetThumbUrl(ctx, asset)) ??
              (await resolveAssetUrl(ctx, asset)) ??
              null);
        result.push({
          assetId: entry.assetId,
          deleteAt: entry.deleteAt,
          name: asset.name || "Archived asset",
          thumb,
        });
      }
    }
    return result;
  },
});

export const finishDeletion = internalMutation({
  args: { archiveId: v.id("assetArchive") },
  returns: v.null(),
  handler: async (ctx, { archiveId }) => {
    const entry = await ctx.db.get(archiveId);
    if (!entry || entry.deleteAt > Date.now()) return null;
    const asset = await ctx.db.get(entry.assetId);
    if (
      asset &&
      canActorAccessOwnerUserId(entry.ownerUserId, asset.ownerUserId)
    ) {
      await ctx.runMutation(deleteRef, { id: entry.assetId });
    }
    await ctx.db.delete(archiveId);
    return null;
  },
});
