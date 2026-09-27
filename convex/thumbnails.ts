"use node";

import { Jimp, JimpMime } from "jimp";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { Id } from "./_generated/dataModel";
import { storeBlobToR2 } from "./r2_store";
import {
  CARD_THUMB_MAX_HEIGHT,
  CARD_THUMB_MAX_WIDTH,
  CARD_THUMB_WEBP_QUALITY,
} from "../lib/card-thumbnail";

// ── Card thumbnail encoder ──────────────────────────────────────────────────
// One encoder for every ingest path, so a tile costs the same bytes whichever
// door the piece came in through. sharp does the work (WebP, EXIF-aware, reads
// WebP/AVIF sources that Jimp cannot); Jimp stays as a JPEG fallback in case
// the native sharp binary ever fails to load on the Convex runtime.

export type CardThumbnail = {
  blob: Blob;
  contentType: string;
  width: number;
  height: number;
  size: number;
  /** The source image's own dimensions, EXIF orientation applied. */
  sourceWidth?: number;
  sourceHeight?: number;
};

type Sharp = (typeof import("sharp"))["default"];

let sharpLoader: Promise<Sharp | null> | undefined;
const loadSharp = () => {
  sharpLoader ??= import("sharp")
    .then((mod) => {
      const sharp = mod.default;
      // Action runtimes are reused across calls; libvips' operation cache
      // would only grow the heap between them.
      sharp.cache(false);
      return sharp;
    })
    .catch((error) => {
      console.warn("sharp unavailable, card thumbnails fall back to Jimp:", error);
      return null;
    });
  return sharpLoader;
};

const toBlob = (buffer: Buffer, type: string) =>
  new Blob(
    [
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer,
    ],
    { type },
  );

const fitInsideCardBox = (width: number, height: number) => {
  const scale = Math.min(
    1,
    CARD_THUMB_MAX_WIDTH / width,
    CARD_THUMB_MAX_HEIGHT / height,
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

const encodeWithSharp = async (
  sharp: Sharp,
  buffer: Buffer,
): Promise<CardThumbnail> => {
  const image = sharp(buffer, { failOn: "none" }).autoOrient();
  const metadata = await image.metadata();
  const { data, info } = await image
    .resize({
      width: CARD_THUMB_MAX_WIDTH,
      height: CARD_THUMB_MAX_HEIGHT,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: CARD_THUMB_WEBP_QUALITY })
    .toBuffer({ resolveWithObject: true });
  return {
    blob: toBlob(data, "image/webp"),
    contentType: "image/webp",
    width: info.width,
    height: info.height,
    size: data.byteLength,
    sourceWidth: metadata.autoOrient?.width ?? metadata.width,
    sourceHeight: metadata.autoOrient?.height ?? metadata.height,
  };
};

const encodeWithJimp = async (buffer: Buffer): Promise<CardThumbnail> => {
  const original = await Jimp.read(buffer);
  const sourceWidth = original.bitmap.width;
  const sourceHeight = original.bitmap.height;
  const box = fitInsideCardBox(sourceWidth, sourceHeight);
  const thumb = original.clone().resize({ w: box.width, h: box.height });
  const data = await thumb.getBuffer(JimpMime.jpeg, { quality: 80 });
  return {
    blob: toBlob(data, JimpMime.jpeg),
    contentType: JimpMime.jpeg,
    width: thumb.bitmap.width,
    height: thumb.bitmap.height,
    size: data.byteLength,
    sourceWidth,
    sourceHeight,
  };
};

/** Encode a gallery card thumbnail. Returns null when the bytes can't be
 *  decoded; callers store the original without a thumb in that case. */
export const encodeCardThumbnail = async (
  buffer: Buffer,
): Promise<CardThumbnail | null> => {
  const sharp = await loadSharp();
  if (sharp) {
    try {
      return await encodeWithSharp(sharp, buffer);
    } catch (error) {
      console.warn("sharp could not encode a card thumbnail:", error);
    }
  }
  try {
    return await encodeWithJimp(buffer);
  } catch (error) {
    console.warn("Jimp could not encode a card thumbnail:", error);
    return null;
  }
};

/** Encode and store a card thumbnail on R2. */
export const storeCardThumbnail = async (
  ctx: ActionCtx,
  buffer: Buffer,
): Promise<(CardThumbnail & { r2Key: string }) | null> => {
  const thumb = await encodeCardThumbnail(buffer);
  if (!thumb) return null;
  const r2Key = await storeBlobToR2(ctx, thumb.blob, { type: thumb.contentType });
  return { ...thumb, r2Key };
};

// ── Owner-driven thumbnail replacement ──────────────────────────────────────

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

    const thumb = await storeCardThumbnail(
      ctx,
      Buffer.from(await blob.arrayBuffer()),
    );
    if (!thumb) {
      // Clean up the raw upload on failure
      await ctx.storage.delete(args.storageId);
      throw new ConvexError("Thumbnail generation failed: the image could not be decoded.");
    }

    const assetId = (await ctx.runMutation(replaceAssetThumbnailRef, {
      ownerUserId: args.ownerUserId,
      assetId: args.assetId,
      newThumbR2Key: thumb.r2Key,
      thumbWidth: thumb.width,
      thumbHeight: thumb.height,
      thumbSize: thumb.size,
    })) as Id<"assets">;

    // Delete the raw upload (it was just a temp intermediary)
    await ctx.storage.delete(args.storageId);

    return assetId;
  },
});

// ── Backfill ────────────────────────────────────────────────────────────────
// Rebuilds every image thumb that is missing, soft, or heavy (see
// needsCardThumb). Walks the assets table one page per action run and
// schedules the next page, so it survives the action time limit. Old thumb
// objects stay on R2: a copied asset row may still point at one.
//
//   bunx convex run thumbnails:backfillCardThumbnails '{"dryRun": true}'
//   bunx convex run thumbnails:backfillCardThumbnails '{"maxPages": 2}'
//   bunx convex run thumbnails:backfillCardThumbnails '{}'

const listThumbBackfillPageRef = makeFunctionReference<"query">(
  "thumbnailBackfill:listThumbBackfillPage",
);
const applyCardThumbnailRef = makeFunctionReference<"mutation">(
  "thumbnailBackfill:applyCardThumbnail",
);
const backfillCardThumbnailsRef = makeFunctionReference<"action">(
  "thumbnails:backfillCardThumbnails",
);

type BackfillCandidate = {
  assetId: Id<"assets">;
  url: string | null;
};

const BACKFILL_PAGE_SIZE = 16;
const BACKFILL_PARALLELISM = 4;

const rebuildThumb = async (ctx: ActionCtx, candidate: BackfillCandidate) => {
  if (!candidate.url) return "skipped" as const;
  const response = await fetch(candidate.url);
  if (!response.ok) {
    console.warn(
      `Thumb backfill: ${candidate.assetId} original answered HTTP ${response.status}.`,
    );
    return "failed" as const;
  }
  const thumb = await storeCardThumbnail(
    ctx,
    Buffer.from(await response.arrayBuffer()),
  );
  if (!thumb) return "failed" as const;
  await ctx.runMutation(applyCardThumbnailRef, {
    assetId: candidate.assetId,
    thumbR2Key: thumb.r2Key,
    thumbWidth: thumb.width,
    thumbHeight: thumb.height,
    thumbSize: thumb.size,
    width: thumb.sourceWidth,
    height: thumb.sourceHeight,
  });
  return "rebuilt" as const;
};

const backfillTotalsValidator = v.object({
  scanned: v.number(),
  rebuilt: v.number(),
  failed: v.number(),
  skipped: v.number(),
});

export const backfillCardThumbnails = internalAction({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    /** Stop after this many pages: a canary run before the full pass. */
    maxPages: v.optional(v.number()),
    totals: v.optional(backfillTotalsValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const totals = args.totals ?? { scanned: 0, rebuilt: 0, failed: 0, skipped: 0 };
    const page = (await ctx.runQuery(listThumbBackfillPageRef, {
      cursor: args.cursor ?? null,
      numItems: BACKFILL_PAGE_SIZE,
    })) as {
      candidates: BackfillCandidate[];
      scanned: number;
      continueCursor: string;
      isDone: boolean;
    };
    totals.scanned += page.scanned;

    if (args.dryRun) {
      totals.rebuilt += page.candidates.length;
    } else {
      const queue = [...page.candidates];
      const worker = async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const outcome = await rebuildThumb(ctx, next).catch((error) => {
            console.warn(`Thumb backfill: ${next.assetId} failed:`, error);
            return "failed" as const;
          });
          totals[outcome] += 1;
        }
      };
      await Promise.all(
        Array.from({ length: BACKFILL_PARALLELISM }, () => worker()),
      );
    }

    const pagesLeft =
      args.maxPages === undefined ? undefined : args.maxPages - 1;
    if (page.isDone || pagesLeft === 0) {
      console.log(
        `Thumb backfill ${args.dryRun ? "(dry run) " : ""}done: scanned ${totals.scanned}, ` +
          `${args.dryRun ? "would rebuild" : "rebuilt"} ${totals.rebuilt}, ` +
          `failed ${totals.failed}, skipped ${totals.skipped}.` +
          (page.isDone ? "" : ` Stopped early; resume with cursor ${page.continueCursor}`),
      );
      return null;
    }
    await ctx.scheduler.runAfter(0, backfillCardThumbnailsRef, {
      cursor: page.continueCursor,
      dryRun: args.dryRun,
      maxPages: pagesLeft,
      totals,
    });
    return null;
  },
});

// Video posters need a frame decoder the Convex runtime doesn't have, so a
// local script (scripts/backfill-video-posters.ts) grabs the frame with
// ffmpeg and hands it here to be encoded and filed like any other thumb.
export const attachVideoPoster = internalAction({
  args: {
    assetId: v.id("assets"),
    frameBase64: v.string(),
    videoWidth: v.optional(v.number()),
    videoHeight: v.optional(v.number()),
  },
  returns: v.object({ thumbWidth: v.number(), thumbHeight: v.number(), thumbSize: v.number() }),
  handler: async (ctx, args) => {
    const thumb = await storeCardThumbnail(
      ctx,
      Buffer.from(args.frameBase64, "base64"),
    );
    if (!thumb) {
      throw new ConvexError("The poster frame could not be decoded.");
    }
    await ctx.runMutation(applyCardThumbnailRef, {
      assetId: args.assetId,
      thumbR2Key: thumb.r2Key,
      thumbWidth: thumb.width,
      thumbHeight: thumb.height,
      thumbSize: thumb.size,
      width: args.videoWidth,
      height: args.videoHeight,
    });
    return { thumbWidth: thumb.width, thumbHeight: thumb.height, thumbSize: thumb.size };
  },
});
