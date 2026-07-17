import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

// ---------------------------------------------------------------------------
// Membership invariant audit.
//
// The membership model has one source of truth — `assetFolders` rows — plus a
// legacy denormalized alias, `assets.folderId`. Historic write paths let the
// two drift and let a project's staging pool (unsectioned member collections,
// the "— Inbox") retain assets after they were filed into a beat. This audit
// checks and (without dryRun) repairs every known invariant:
//
//   1. assets.folderId points at a folder that no longer exists → clear it.
//   2. assets.folderId has no matching assetFolders row → insert the link
//      (the alias must never be the only record of a membership).
//   3. An asset sits in a project's unsectioned member collection AND in a
//      sectioned one → drop the unsectioned link (staging drains on filing).
//
// Run:  bunx convex run membershipAudit:run '{"dryRun":true}'
// ---------------------------------------------------------------------------

export const run = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  returns: v.object({
    assetsScanned: v.number(),
    danglingPrimaryCleared: v.number(),
    missingLinksInserted: v.number(),
    projectsScanned: v.number(),
    stagingDuplicatesDropped: v.number(),
    dryRun: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun === true;
    const now = Date.now();

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
        }
      }
    }

    // --- Invariant 3: project staging pools hold only unfiled assets. ---
    const folders = await ctx.db.query("folders").collect();
    const projects = folders.filter((folder) => folder.kind === "project");
    let stagingDuplicatesDropped = 0;
    for (const project of projects) {
      const memberLinks = await ctx.db
        .query("projectCollections")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect();
      const sectioned = new Set<Id<"folders">>();
      const unsectioned: Id<"folders">[] = [];
      for (const link of memberLinks) {
        if (link.section === undefined) unsectioned.push(link.folderId);
        else sectioned.add(link.folderId);
      }
      if (unsectioned.length === 0 || sectioned.size === 0) continue;

      // Assets filed anywhere sectioned in this project.
      const filed = new Set<string>();
      for (const folderId of sectioned) {
        const links = await ctx.db
          .query("assetFolders")
          .withIndex("by_folder_createdAt", (q) => q.eq("folderId", folderId))
          .collect();
        for (const link of links) filed.add(link.assetId);
      }
      for (const asset of assets) {
        if (asset.folderId && sectioned.has(asset.folderId)) {
          filed.add(asset._id);
        }
      }

      for (const stagingFolderId of unsectioned) {
        const stagingLinks = await ctx.db
          .query("assetFolders")
          .withIndex("by_folder_createdAt", (q) =>
            q.eq("folderId", stagingFolderId),
          )
          .collect();
        for (const link of stagingLinks) {
          if (!filed.has(link.assetId)) continue;
          stagingDuplicatesDropped += 1;
          if (!dryRun) {
            await ctx.db.delete(link._id);
            const asset = await ctx.db.get(link.assetId);
            if (asset?.folderId === stagingFolderId) {
              await ctx.db.patch(link.assetId, { folderId: undefined });
            }
          }
        }
      }
    }

    return {
      assetsScanned: assets.length,
      danglingPrimaryCleared,
      missingLinksInserted,
      projectsScanned: projects.length,
      stagingDuplicatesDropped,
      dryRun,
    };
  },
});
