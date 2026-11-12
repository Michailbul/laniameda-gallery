import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { signedOwnerQuery } from "./actor";
import { canActorAccessOwnerUserId } from "./authz";
import { dedupeIds } from "./helpers";

// Collection memberships for a handful of assets, so the guest reader path
// (lib/guest-access.ts) can apply its deny-wins rule to ids it did not get
// from a hydrated listing: contact-sheet ids and media embedded in a Skill.
// Owner-signed like every private read; owner paths never call it.
export const assetMemberships = signedOwnerQuery({
  args: { ownerUserId: v.string(), assetIds: v.array(v.id("assets")) },
  returns: v.array(v.object({ assetId: v.id("assets"), folderIds: v.array(v.id("folders")) })),
  handler: async (ctx, args) => {
    const ids = dedupeIds(args.assetIds);
    if (ids.length > 200) throw new ConvexError("At most 200 assets per call.");
    const rows = await Promise.all(ids.map(async (assetId) => {
      const asset = await ctx.db.get(assetId);
      if (!asset || !canActorAccessOwnerUserId(args.ownerUserId, asset.ownerUserId)) return null;
      const links = await ctx.db.query("assetFolders").withIndex("by_asset", (q) => q.eq("assetId", assetId)).collect();
      const folderIds = dedupeIds([asset.folderId, ...links.map((link) => link.folderId)]
        .filter((id): id is Id<"folders"> => Boolean(id)));
      return { assetId, folderIds };
    }));
    return rows.filter((row): row is NonNullable<typeof row> => row !== null);
  },
});
