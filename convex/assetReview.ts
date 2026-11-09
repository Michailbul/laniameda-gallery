import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { signedOwnerMutation, signedOwnerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { resolveAssetThumbUrl, resolveAssetUrl } from "./r2_url";
import { deleteAssetCascade } from "./assets";
import { archiveAsset, archiveEntryOf, restoreAsset } from "./assetArchiveCore";

/**
 * Archive (D on a board) is soft: the frame grays out, sits in the Archive
 * tray and comes back with D or Restore, for as long as Michael wants.
 * Nothing is deleted until he asks for it with "Delete for good" in the tray
 * (purge), and that delete is journaled.
 *
 * Until 7 Nov 2026 archive scheduled a hard delete ten minutes later, with no
 * journal entry: 36 DEAR ANNETE frames archived at 16:29 were gone at 16:39.
 */

export { ARCHIVE_HIDE_REASON } from "./assetArchiveCore";

/** Most frames one "Delete for good" removes in one transaction. */
export const PURGE_BATCH = 25;

const archivedAtOf = (entry: Doc<"assetArchive">) =>
  entry.archivedAt ?? entry._creationTime;

export const archive = signedOwnerMutation({
  args: { ownerUserId: v.string(), assetId: v.id("assets") },
  returns: v.number(),
  handler: async (ctx, { ownerUserId, assetId }) => {
    const asset = await ctx.db.get(assetId);
    if (!asset || !canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId))
      throw new ConvexError("Asset not found.");
    return await archiveAsset(ctx, ownerUserId, asset);
  },
});

export const restore = signedOwnerMutation({
  args: { ownerUserId: v.string(), assetId: v.id("assets") },
  returns: v.null(),
  handler: async (ctx, { ownerUserId, assetId }) => {
    const entry = await archiveEntryOf(ctx, assetId);
    if (!entry) return null;
    if (!canActorAccessOwnerUserId(ownerUserId, entry.ownerUserId))
      throw new ConvexError("Asset not found.");
    await restoreAsset(ctx, entry);
    return null;
  },
});

export const list = signedOwnerQuery({
  args: { ownerUserId: v.string() },
  returns: v.array(
    v.object({
      assetId: v.id("assets"),
      archivedAt: v.number(),
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
          archivedAt: archivedAtOf(entry),
          name: asset.name || "Archived asset",
          thumb,
        });
      }
    }
    return result.sort((a, b) => b.archivedAt - a.archivedAt);
  },
});

/**
 * "Delete for good" in the Archive tray: Michael's explicit cleanup. Deletes
 * only frames that are archived right now, each journaled (via archive.purge).
 */
export const purge = signedOwnerMutation({
  args: {
    ownerUserId: v.string(),
    assetIds: v.array(v.id("assets")),
    session: v.optional(v.string()),
  },
  returns: v.object({ deleted: v.number(), skipped: v.number() }),
  handler: async (ctx, { ownerUserId, assetIds, session }) => {
    const ids = [...new Set(assetIds)];
    if (ids.length > PURGE_BATCH)
      throw new ConvexError(`Delete at most ${PURGE_BATCH} frames at a time.`);
    let deleted = 0;
    let skipped = 0;
    for (const assetId of ids) {
      const entry = await ctx.db
        .query("assetArchive")
        .withIndex("by_asset", (q) => q.eq("assetId", assetId))
        .unique();
      const asset = await ctx.db.get(assetId);
      if (
        !entry ||
        !asset ||
        !canActorAccessOwnerUserId(ownerUserId, entry.ownerUserId) ||
        !canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)
      ) {
        skipped += 1;
        continue;
      }
      await deleteAssetCascade(ctx, asset, {
        via: "archive.purge",
        actor: "owner",
        session: session ?? "archive-tray",
      });
      await ctx.db.delete(entry._id);
      deleted += 1;
    }
    return { deleted, skipped };
  },
});

/**
 * Retired: the old ten-minute auto-delete. Jobs scheduled before 7 Nov 2026
 * still call it; it no longer deletes anything. The frame stays archived.
 */
export const finishDeletion = internalMutation({
  args: { archiveId: v.id("assetArchive") },
  returns: v.null(),
  handler: async (ctx, { archiveId }) => {
    const entry = await ctx.db.get(archiveId);
    if (entry && entry.deleteAt !== undefined) {
      await ctx.db.patch(archiveId, {
        archivedAt: archivedAtOf(entry),
        deleteAt: undefined,
      });
    }
    return null;
  },
});
