"use node";

import { Jimp, JimpMime } from "jimp";
import { action } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { Id } from "./_generated/dataModel";
import { storeBlobToR2 } from "./r2_store";

const THUMB_WIDTH = 420;

const replaceAssetThumbnailRef = makeFunctionReference<"mutation">(
  "assets:replaceAssetThumbnail",
);

export const processAndReplaceThumbnail = action({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    storageId: v.id("_storage"),
  },
  returns: v.id("assets"),
  handler: async (ctx, args) => {
    const blob = await ctx.storage.get(args.storageId);
    if (!blob) {
      throw new ConvexError("Uploaded file not found in storage.");
    }

    const arrayBuffer = await blob.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    let thumbR2Key;
    let thumbWidth: number | undefined;
    let thumbHeight: number | undefined;
    let thumbSize: number | undefined;

    try {
      const originalImage = await Jimp.read(fileBuffer);
      const originalWidth = originalImage.bitmap.width;
      const originalHeight = originalImage.bitmap.height;

      const generatedThumbHeight =
        originalWidth && originalHeight
          ? Math.max(1, Math.round((THUMB_WIDTH * originalHeight) / originalWidth))
          : THUMB_WIDTH;

      const thumb = originalImage
        .clone()
        .resize({ w: THUMB_WIDTH, h: generatedThumbHeight });

      const contentType = blob.type ?? "image/jpeg";
      const thumbMime =
        contentType.includes("png") && contentType !== "image/jpeg"
          ? JimpMime.png
          : JimpMime.jpeg;

      const thumbBuffer = await thumb.getBuffer(thumbMime);
      thumbWidth = thumb.bitmap.width ?? undefined;
      thumbHeight = thumb.bitmap.height ?? undefined;
      thumbSize = thumbBuffer.byteLength;

      const thumbArrayBuffer = thumbBuffer.buffer.slice(
        thumbBuffer.byteOffset,
        thumbBuffer.byteOffset + thumbBuffer.byteLength,
      ) as ArrayBuffer;
      const thumbBlob = new Blob([thumbArrayBuffer], { type: thumbMime });
      thumbR2Key = await storeBlobToR2(ctx, thumbBlob, { type: thumbMime });
    } catch (error) {
      // Clean up the raw upload on failure
      await ctx.storage.delete(args.storageId);
      throw new ConvexError(
        `Thumbnail generation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Apply the new thumbnail via mutation
    const assetId = (await ctx.runMutation(replaceAssetThumbnailRef, {
      ownerUserId: args.ownerUserId,
      assetId: args.assetId,
      newThumbR2Key: thumbR2Key,
      thumbWidth,
      thumbHeight,
      thumbSize,
    })) as Id<"assets">;

    // Delete the raw upload (it was just a temp intermediary)
    await ctx.storage.delete(args.storageId);

    return assetId;
  },
});
