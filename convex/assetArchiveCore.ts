import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// The one archive every surface shares: D on a gallery board (assetReview)
// and D on the director review page (review.setArchived). Soft: a row in
// assetArchive grays the frame out and lists it in the gallery's Archive
// tray; nothing is deleted until "Delete for good" there.

/** The world-page hide reason archive sets, so restore undoes only its own hide. */
export const ARCHIVE_HIDE_REASON = "Archived (D)";

export const archiveEntryOf = async (ctx: QueryCtx | MutationCtx, assetId: Id<"assets">) =>
  await ctx.db
    .query("assetArchive")
    .withIndex("by_asset", (q) => q.eq("assetId", assetId))
    .unique();

/** Archive one asset; returns when it was archived (the existing time if it already was). */
export const archiveAsset = async (ctx: MutationCtx, ownerUserId: string, asset: Doc<"assets">) => {
  const existing = await archiveEntryOf(ctx, asset._id);
  if (existing) return existing.archivedAt ?? existing._creationTime;
  const archivedAt = Date.now();
  await ctx.db.insert("assetArchive", { ownerUserId, assetId: asset._id, archivedAt });
  // Off the world page, as the old delete took it off; restore brings it back.
  if (!asset.worldPageHidden) {
    await ctx.db.patch(asset._id, { worldPageHidden: true, worldPageHiddenReason: ARCHIVE_HIDE_REASON });
  }
  return archivedAt;
};

/** Bring an archived asset back; false when it was not archived. */
export const restoreAsset = async (ctx: MutationCtx, entry: Doc<"assetArchive">) => {
  await ctx.db.delete(entry._id);
  const asset = await ctx.db.get(entry.assetId);
  if (asset?.worldPageHidden && asset.worldPageHiddenReason === ARCHIVE_HIDE_REASON) {
    await ctx.db.patch(entry.assetId, { worldPageHidden: undefined, worldPageHiddenReason: undefined });
  }
};
