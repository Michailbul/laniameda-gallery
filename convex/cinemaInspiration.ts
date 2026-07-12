"use node";

import { Jimp, JimpMime } from "jimp";
import { ConvexError, v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { storeBlobToR2 } from "./r2_store";

const CINEMA_PILLAR_KEY = "cinema-inspiration";
const THUMB_WIDTH_TARGET = 1024;

const cinemaMetadataInputValidator = v.object({
  movieTitle: v.string(),
  director: v.optional(v.string()),
  year: v.optional(v.number()),
  scene: v.optional(v.string()),
  timecode: v.optional(v.string()),
  cinematographer: v.optional(v.string()),
  lens: v.optional(v.string()),
  aperture: v.optional(v.string()),
  composition: v.optional(v.string()),
  lighting: v.optional(v.string()),
  cameraMovement: v.optional(v.string()),
  colorPalette: v.optional(v.string()),
  mood: v.optional(v.string()),
  agentDescription: v.optional(v.string()),
});

const trimOptional = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

const sanitizeCinemaMetadata = (input: {
  movieTitle: string;
  director?: string;
  year?: number;
  scene?: string;
  timecode?: string;
  cinematographer?: string;
  lens?: string;
  aperture?: string;
  composition?: string;
  lighting?: string;
  cameraMovement?: string;
  colorPalette?: string;
  mood?: string;
  agentDescription?: string;
}) => {
  const movieTitle = input.movieTitle.trim();
  if (!movieTitle) {
    throw new ConvexError("movieTitle is required for cinema frames.");
  }
  const year = typeof input.year === "number" && Number.isFinite(input.year)
    ? Math.trunc(input.year)
    : undefined;
  return {
    movieTitle,
    director: trimOptional(input.director),
    year,
    scene: trimOptional(input.scene),
    timecode: trimOptional(input.timecode),
    cinematographer: trimOptional(input.cinematographer),
    lens: trimOptional(input.lens),
    aperture: trimOptional(input.aperture),
    composition: trimOptional(input.composition),
    lighting: trimOptional(input.lighting),
    cameraMovement: trimOptional(input.cameraMovement),
    colorPalette: trimOptional(input.colorPalette),
    mood: trimOptional(input.mood),
    agentDescription: trimOptional(input.agentDescription),
  };
};

const decodeBase64Buffer = (base64: string) => {
  const buffer = Buffer.from(base64, "base64");
  if (buffer.byteLength === 0) {
    throw new ConvexError("Empty image payload.");
  }
  return buffer;
};

const toBlob = (buffer: Buffer, mimeType?: string) =>
  new Blob([new Uint8Array(buffer)], {
    type: mimeType || "application/octet-stream",
  });

type ThumbnailResult = {
  width: number | undefined;
  height: number | undefined;
  thumbBlob: Blob | undefined;
  thumbSize: number | undefined;
  thumbWidth: number | undefined;
  thumbHeight: number | undefined;
  thumbMime: string | undefined;
};

const EMPTY_THUMBNAIL: ThumbnailResult = {
  width: undefined,
  height: undefined,
  thumbBlob: undefined,
  thumbSize: undefined,
  thumbWidth: undefined,
  thumbHeight: undefined,
  thumbMime: undefined,
};

const generateThumbnail = async (
  buffer: Buffer,
  mimeType?: string,
): Promise<ThumbnailResult> => {
  const contentType = mimeType || "image/jpeg";
  if (!contentType.startsWith("image/")) {
    throw new ConvexError("Cinema frames must be images.");
  }
  // Jimp doesn't decode every image type (webp, avif). When that happens we
  // still want to store the full-size original; the gallery falls back to
  // the full URL when no thumbnail exists. Don't fail the whole ingest.
  try {
    const original = await Jimp.read(buffer);
    const originalWidth = original.bitmap.width;
    const originalHeight = original.bitmap.height;
    const thumbHeight = originalWidth && originalHeight
      ? Math.max(1, Math.round((THUMB_WIDTH_TARGET * originalHeight) / originalWidth))
      : THUMB_WIDTH_TARGET;
    const thumb = original.clone().resize({ w: THUMB_WIDTH_TARGET, h: thumbHeight });
    const thumbMime =
      contentType.includes("png") && contentType !== "image/jpeg"
        ? JimpMime.png
        : JimpMime.jpeg;
    const thumbBuffer = await thumb.getBuffer(thumbMime);
    const thumbArrayBuffer = thumbBuffer.buffer.slice(
      thumbBuffer.byteOffset,
      thumbBuffer.byteOffset + thumbBuffer.byteLength,
    ) as ArrayBuffer;
    const thumbBlob = new Blob([thumbArrayBuffer], { type: thumbMime });
    return {
      width: originalWidth ?? undefined,
      height: originalHeight ?? undefined,
      thumbBlob,
      thumbSize: thumbBuffer.byteLength,
      thumbWidth: thumb.bitmap.width ?? undefined,
      thumbHeight: thumb.bitmap.height ?? undefined,
      thumbMime,
    };
  } catch (error) {
    console.warn(
      `Cinema thumbnail generation skipped — Jimp couldn't decode ${contentType}:`,
      error instanceof Error ? error.message : error,
    );
    return EMPTY_THUMBNAIL;
  }
};

const storeFrameToR2 = async (
  ctx: ActionCtx,
  buffer: Buffer,
  mimeType: string | undefined,
) => {
  const blob = toBlob(buffer, mimeType);
  const r2Key = await storeBlobToR2(ctx, blob, {
    type: mimeType || blob.type || undefined,
  });
  return { r2Key, size: blob.size };
};

export const ingestCinemaFrame = action({
  args: {
    ownerUserId: v.string(),
    base64: v.string(),
    mimeType: v.optional(v.string()),
    fileName: v.optional(v.string()),
    cinemaMetadata: cinemaMetadataInputValidator,
    ingestKey: v.optional(v.string()),
    ingestSource: v.optional(
      v.union(
        v.literal("api"),
        v.literal("agent"),
        v.literal("manual"),
        v.literal("import"),
      ),
    ),
  },
  returns: v.object({
    assetId: v.id("assets"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const buffer = decodeBase64Buffer(args.base64);
    const mimeType = args.mimeType || "image/jpeg";
    const cinemaMetadata = sanitizeCinemaMetadata(args.cinemaMetadata);

    const full = await storeFrameToR2(ctx, buffer, mimeType);
    const thumb = await generateThumbnail(buffer, mimeType);
    const thumbR2Key = thumb.thumbBlob
      ? await storeBlobToR2(ctx, thumb.thumbBlob, { type: thumb.thumbMime })
      : undefined;

    const assetRecord: { assetId: Id<"assets">; created: boolean } =
      await ctx.runMutation(api.assets.createAsset, {
      ownerUserId,
      kind: "image",
      r2Key: full.r2Key,
      thumbR2Key,
      fileName: args.fileName,
      contentType: mimeType,
      size: full.size,
      width: thumb.width,
      height: thumb.height,
      thumbSize: thumb.thumbSize,
      thumbWidth: thumb.thumbWidth,
      thumbHeight: thumb.thumbHeight,
      tagIds: [],
      ingestKey: args.ingestKey,
      pillar: CINEMA_PILLAR_KEY,
      generationType: "other",
      assetRole: "cinema_frame",
      ingestSource: args.ingestSource ?? "manual",
      cinemaMetadata,
    });

    return assetRecord;
  },
});

