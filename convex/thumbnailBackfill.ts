import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { needsCardThumb, needsGridVariants, isCardThumbSharp } from "../lib/card-thumbnail";
import { thumbVariantValidator } from "./validators";
import { resolveAssetUrl } from "./r2_url";
import { r2 } from "./r2";

// Database half of the card-thumbnail backfill. The encoding half lives in
// convex/thumbnails.ts, which needs the Node runtime for sharp.

/** One page of the assets table, reduced to the images whose card thumb is
 *  missing, soft, or not yet a card-encoder WebP, or that lack their grid
 *  renditions, each with the URL of its original. */
export const listThumbBackfillPage = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
  },
  returns: v.object({
    candidates: v.array(
      v.object({
        assetId: v.id("assets"),
        url: v.union(v.string(), v.null()),
        /** The card thumb itself is fine: only the grid renditions are missing. */
        variantsOnly: v.boolean(),
      }),
    ),
    scanned: v.number(),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("assets")
      .paginate({ cursor: args.cursor, numItems: args.numItems });
    const candidates = [];
    for (const asset of page.page) {
      if (asset.kind !== "image") continue;
      const thumbMetadata = asset.thumbR2Key
        ? await r2.getMetadata(ctx, asset.thumbR2Key)
        : null;
      const rebuildThumb = needsCardThumb(asset, thumbMetadata?.contentType);
      if (!rebuildThumb && !needsGridVariants(asset)) continue;
      candidates.push({
        assetId: asset._id,
        url: (await resolveAssetUrl(ctx, asset)) ?? null,
        variantsOnly: !rebuildThumb,
      });
    }
    return {
      candidates,
      scanned: page.page.length,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

/** Videos whose tile would mount the full video for want of a sharp poster.
 *  scripts/backfill-video-posters.ts pulls a frame for each with ffmpeg. */
export const listVideosNeedingPoster = internalQuery({
  args: {},
  returns: v.array(
    v.object({ assetId: v.id("assets"), url: v.union(v.string(), v.null()) }),
  ),
  handler: async (ctx) => {
    const videos = await ctx.db
      .query("assets")
      .filter((q) => q.eq(q.field("kind"), "video"))
      .collect();
    const result = [];
    for (const video of videos) {
      const hasPoster = Boolean(video.thumbR2Key || video.thumbStorageId);
      if (hasPoster && isCardThumbSharp(video)) continue;
      result.push({
        assetId: video._id,
        url: (await resolveAssetUrl(ctx, video)) ?? null,
      });
    }
    return result;
  },
});

/** Add grid renditions to an asset whose card thumb is kept as it is. */
export const applyThumbVariants = internalMutation({
  args: { assetId: v.id("assets"), thumbVariants: v.array(thumbVariantValidator) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) return null;
    await ctx.db.patch(args.assetId, { thumbVariants: args.thumbVariants });
    return null;
  },
});

/** Point an asset at a freshly encoded card thumb. Fills the asset's own
 *  width/height only when the row never had them. */
export const applyCardThumbnail = internalMutation({
  args: {
    assetId: v.id("assets"),
    thumbR2Key: v.string(),
    thumbWidth: v.number(),
    thumbHeight: v.number(),
    thumbSize: v.number(),
    thumbVariants: v.optional(v.array(thumbVariantValidator)),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) return null;
    const fillDimensions =
      !(asset.width && asset.height) && args.width && args.height;
    await ctx.db.patch(args.assetId, {
      thumbR2Key: args.thumbR2Key,
      thumbWidth: args.thumbWidth,
      thumbHeight: args.thumbHeight,
      thumbSize: args.thumbSize,
      ...(args.thumbVariants ? { thumbVariants: args.thumbVariants } : {}),
      ...(fillDimensions ? { width: args.width, height: args.height } : {}),
    });
    return null;
  },
});
