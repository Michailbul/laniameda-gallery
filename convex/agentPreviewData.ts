import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { canActorAccessOwnerUserId } from "./authz";
import { hydrateGalleryAssetResults } from "./galleryAssetResults";

// What the contact sheet composer (agentPreview.ts, a Node action) needs per
// asset: the pixels to draw and a short legend line. Kept out of the Node file
// because Node action modules cannot hold queries.

export const previewAssetValidator = v.object({
  assetId: v.id("assets"),
  kind: v.union(v.literal("image"), v.literal("video")),
  /** The smallest URL that still shows the piece: the card thumb (a video's
   *  poster), else the original image. Null for a video with no poster. */
  previewUrl: v.union(v.null(), v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  agentDescription: v.optional(v.string()),
  tagNames: v.array(v.string()),
  folderIds: v.array(v.id("folders")),
});

export const getPreviewAssets = internalQuery({
  args: {
    ownerUserId: v.string(),
    assetIds: v.array(v.string()),
  },
  returns: v.object({
    assets: v.array(previewAssetValidator),
    missingIds: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const found: Doc<"assets">[] = [];
    const missingIds: string[] = [];
    for (const rawId of args.assetIds) {
      const assetId = ctx.db.normalizeId("assets", rawId);
      const asset = assetId ? await ctx.db.get(assetId) : null;
      if (!asset || !canActorAccessOwnerUserId(args.ownerUserId, asset.ownerUserId)) {
        missingIds.push(rawId);
        continue;
      }
      found.push(asset);
    }

    const hydrated = await hydrateGalleryAssetResults(ctx, found);
    const assets = hydrated.map((asset) => {
      const hasThumb = Boolean(asset.thumbR2Key || asset.thumbStorageId);
      const previewUrl =
        (hasThumb ? asset.thumbUrl : undefined) ??
        (asset.kind === "image" ? asset.url ?? asset.sourceUrl : undefined) ??
        null;
      return {
        assetId: asset._id,
        kind: asset.kind,
        previewUrl,
        width: asset.width,
        height: asset.height,
        agentDescription: asset.agentDescription,
        tagNames: asset.tagNames,
        folderIds: asset.folderIds,
      };
    });

    return { assets, missingIds };
  },
});
