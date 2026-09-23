import { internalMutation } from "./_generated/server";
import { recountFolderMembers } from "./folderHelpers";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

// ---------------------------------------------------------------------------
// Membership invariant audit.
//
// The membership model has one source of truth — `assetFolders` rows — plus a
// legacy denormalized alias, `assets.folderId`. Historic write paths let the
// two drift. This audit checks and (without dryRun) repairs every known
// invariant:
//
//   1. assets.folderId points at a folder that no longer exists → clear it.
//   2. assets.folderId has no matching assetFolders row → insert the link
//      (the alias must never be the only record of a membership).
//
// Run:  bunx convex run membershipAudit:run '{"dryRun":true}'
// ---------------------------------------------------------------------------

export const run = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  returns: v.object({
    assetsScanned: v.number(),
    danglingPrimaryCleared: v.number(),
    missingLinksInserted: v.number(),
    dryRun: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun === true;
    const now = Date.now();
    const touchedFolderIds = new Set<Id<"folders">>();

    // --- Invariants 1 + 2: the folderId alias. ---
    const assets = await ctx.db.query("assets").collect();
    let danglingPrimaryCleared = 0;
    let missingLinksInserted = 0;
    for (const asset of assets) {
      if (!asset.folderId) continue;
      const folder = await ctx.db.get(asset.folderId);
      if (!folder) {
        danglingPrimaryCleared += 1;
        if (!dryRun) await ctx.db.patch(asset._id, { folderId: undefined });
        continue;
      }
      const link = await ctx.db
        .query("assetFolders")
        .withIndex("by_asset_folder", (q) =>
          q.eq("assetId", asset._id).eq("folderId", asset.folderId!),
        )
        .unique();
      if (!link) {
        missingLinksInserted += 1;
        if (!dryRun) {
          await ctx.db.insert("assetFolders", {
            ownerUserId: asset.ownerUserId ?? "",
            assetId: asset._id,
            folderId: asset.folderId,
            createdAt: now,
          });
          touchedFolderIds.add(asset.folderId);
        }
      }
    }

    await recountFolderMembers(ctx, touchedFolderIds);
    return {
      assetsScanned: assets.length,
      danglingPrimaryCleared,
      missingLinksInserted,
      dryRun,
    };
  },
});
