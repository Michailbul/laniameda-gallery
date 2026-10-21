"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import { DHASH_HEIGHT, DHASH_WIDTH, dHashFromGray } from "../lib/perceptual-hash";

// Computes an image's dHash with sharp: the card thumbnail (a video's poster)
// shrunk to 9×8 grey pixels. Runs once per asset, at ingest and in the
// backfill below; the hash lands in assetHashes.

const MAX_BYTES = 40 * 1024 * 1024;

type Sharp = (typeof import("sharp"))["default"];
let sharpLoader: Promise<Sharp> | undefined;
const loadSharp = () => {
  sharpLoader ??= import("sharp").then((mod) => {
    mod.default.cache(false);
    return mod.default;
  });
  return sharpLoader;
};

const hashUrl = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const size = Number(response.headers.get("content-length") ?? 0);
  if (size > MAX_BYTES) throw new Error("image too large to hash");
  const buffer = Buffer.from(await response.arrayBuffer());
  const sharp = await loadSharp();
  const gray = await sharp(buffer, { failOn: "none" })
    .rotate()
    .flatten({ background: "#808080" })
    .greyscale()
    .resize(DHASH_WIDTH, DHASH_HEIGHT, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer();
  return dHashFromGray(gray);
};

const hashOne = async (ctx: ActionCtx, assetId: Id<"assets">, force?: boolean): Promise<"hashed" | "skipped" | "failed"> => {
  const target = await ctx.runQuery(internal.assetHashes.getAssetForHash, { assetId });
  if (!target?.url || (target.hashed && !force)) return "skipped";
  try {
    await ctx.runMutation(internal.assetHashes.setAssetHash, { assetId, dHash: await hashUrl(target.url) });
    return "hashed";
  } catch (error) {
    console.warn(`dHash failed for asset:${assetId}:`, error instanceof Error ? error.message : error);
    return "failed";
  }
};

export const hashAsset = internalAction({
  args: { assetId: v.id("assets"), force: v.optional(v.boolean()) },
  returns: v.union(v.literal("hashed"), v.literal("skipped"), v.literal("failed")),
  handler: async (ctx, args) => await hashOne(ctx, args.assetId, args.force),
});

// Walks one owner's assets newest first, a page at a time, hashing those
// without a hash, one small page per action. Run:
//   convex run perceptualHash:backfillPerceptualHashes '{"ownerUserId":"…","batchSize":25}'
export const backfillPerceptualHashes = internalAction({
  args: {
    ownerUserId: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  returns: v.object({ hashed: v.number(), failed: v.number(), done: v.boolean() }),
  handler: async (ctx, args): Promise<{ hashed: number; failed: number; done: boolean }> => {
    const page: { assetIds: string[]; nextCursor: string | null; isDone: boolean } = await ctx.runQuery(
      internal.assetHashes.listAssetsMissingHash, { ownerUserId: args.ownerUserId, cursor: args.cursor, batchSize: args.batchSize ?? 25 },
    );
    const batchesLeft = (args.maxBatches ?? Infinity) - 1;
    const done = page.isDone || batchesLeft <= 0;
    let hashed = 0;
    let failed = 0;
    for (const assetId of page.assetIds) {
      const result = await hashOne(ctx, assetId as Id<"assets">);
      if (result === "hashed") hashed += 1;
      else if (result === "failed") failed += 1;
    }
    // One page at a time: the next starts when this one is done, so the walk
    // never fans out into hundreds of parallel image fetches. A bad file is
    // caught in hashOne and cannot stop the chain.
    if (!done) {
      await ctx.scheduler.runAfter(0, internal.perceptualHash.backfillPerceptualHashes, {
        ownerUserId: args.ownerUserId, cursor: page.nextCursor, batchSize: args.batchSize,
        maxBatches: args.maxBatches === undefined ? undefined : batchesLeft,
      });
    }
    console.log(`dHash backfill page: ${hashed} hashed, ${failed} failed${done ? "; done" : ""}.`);
    return { hashed, failed, done };
  },
});
