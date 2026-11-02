"use node";

import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import { JEV_FACETS_VERSION, JEV_MODEL, buildJevRequest, compactAnswers } from "../lib/jev-facets";

// Auto-classification of every new picture with Jev (TypeSafe System One).
// createAsset schedules classifyAsset before the asset's first index, so the
// tags it adds are in the search text; whatever happens here, the describe or
// index step it was handed runs afterwards. Off unless the deployment sets
// JEV_CLASSIFY_ENABLED=true and TYPESAFE_API_KEY.

const API_URL = "https://api.typesafe.ai/v1/systemone";
const MAX_BYTES = 40 * 1024 * 1024;
const LONG_SIDE = 1024;
const MIN_SIDE = 280;
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000] as const;
const RETRYABLE = new Set([429, 500, 502, 503, 504, 529]);

const getClassifySourceRef = makeFunctionReference<"query">("assetClassifications:getClassifySource");
const saveClassificationRef = makeFunctionReference<"mutation">("assetClassifications:saveClassification");
const listAssetsUnclassifiedRef = makeFunctionReference<"query">("assetClassifications:listAssetsUnclassified");
const classifyAssetRef = makeFunctionReference<"action">("jevClassify:classifyAsset");
const backfillRef = makeFunctionReference<"action">("jevClassify:backfillJevClassify");
const describeAssetRef = makeFunctionReference<"action">("agentDescriptions:describeAsset");
const reindexAssetRef = makeFunctionReference<"action">("semanticIndex:reindexAsset");

export const jevEnabled = () =>
  process.env.JEV_CLASSIFY_ENABLED?.trim().toLowerCase() === "true" && Boolean(process.env.TYPESAFE_API_KEY?.trim());

type Sharp = (typeof import("sharp"))["default"];
let sharpLoader: Promise<Sharp> | undefined;
const loadSharp = () => {
  sharpLoader ??= import("sharp").then((mod) => {
    mod.default.cache(false);
    return mod.default;
  });
  return sharpLoader;
};

/** Jev takes JPEG or PNG, 280–1568 px a side: the thumbnail (WebP) re-encoded at 1024 px. */
const jpegOf = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`image HTTP ${response.status}`);
  if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("image too large");
  const sharp = await loadSharp();
  const source = sharp(Buffer.from(await response.arrayBuffer()), { failOn: "none" }).rotate();
  const meta = await source.metadata();
  const width = meta.width ?? LONG_SIDE;
  const height = meta.height ?? LONG_SIDE;
  const scale = Math.max(MIN_SIDE / Math.min(width, height), Math.min(1, LONG_SIDE / Math.max(width, height)));
  const out = await source
    .resize(Math.max(MIN_SIDE, Math.round(width * scale)), Math.max(MIN_SIDE, Math.round(height * scale)), { fit: "fill" })
    .flatten({ background: "#808080" })
    .jpeg({ quality: 85 })
    .toBuffer();
  return out.toString("base64");
};

class JevError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

const askJev = async (jpegBase64: string, assetId: string) => {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.TYPESAFE_API_KEY?.trim()}`,
      "Content-Type": "application/json",
      "TypeSafe-Danger-Zone-Images": "true",
    },
    body: JSON.stringify(buildJevRequest(jpegBase64, `img${assetId.slice(-12)}`)),
  });
  if (!response.ok) {
    throw new JevError(`TypeSafe HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`, RETRYABLE.has(response.status));
  }
  const body = await response.json() as { answers: Record<string, { type: string; choice?: string; confidence?: number; noul?: number }> };
  return compactAnswers(body.answers);
};

type Then = "describe" | "reindex" | undefined;
const continueWith = async (ctx: ActionCtx, assetId: Id<"assets">, then: Then) => {
  if (then === "describe") await ctx.scheduler.runAfter(0, describeAssetRef, { assetId, reindexAfter: true });
  else if (then === "reindex") await ctx.scheduler.runAfter(0, reindexAssetRef, { assetId });
};

type Outcome = "classified" | "skipped" | "disabled" | "no_image" | "error";

const classifyOne = async (ctx: ActionCtx, assetId: Id<"assets">, opts: { force?: boolean; apply?: boolean }): Promise<{ outcome: Outcome; retryable?: boolean; tags?: string[] }> => {
  if (!jevEnabled()) return { outcome: "disabled" };
  const source = await ctx.runQuery(getClassifySourceRef, { assetId }) as { imageUrl?: string; kind: string; classified: boolean } | null;
  if (!source || (source.classified && !opts.force)) return { outcome: "skipped" };
  if (!source.imageUrl) return { outcome: "no_image", retryable: source.kind === "video" };
  try {
    const answers = await askJev(await jpegOf(source.imageUrl), assetId);
    const tags = await ctx.runMutation(saveClassificationRef, {
      assetId, model: JEV_MODEL, version: JEV_FACETS_VERSION, status: "done", answers, apply: opts.apply,
    }) as string[];
    return { outcome: "classified", tags };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Jev classify failed for asset:${assetId}: ${message}`);
    await ctx.runMutation(saveClassificationRef, { assetId, model: JEV_MODEL, version: JEV_FACETS_VERSION, status: "error", error: message.slice(0, 300) });
    return { outcome: "error", retryable: !(error instanceof JevError) || error.retryable };
  }
};

export const classifyAsset = internalAction({
  args: {
    assetId: v.id("assets"),
    force: v.optional(v.boolean()),
    // Store the answers without adding tags (a dry run).
    apply: v.optional(v.boolean()),
    // What createAsset deferred to after the classification: the first describe or index.
    then: v.optional(v.union(v.literal("describe"), v.literal("reindex"))),
    attempt: v.optional(v.number()),
  },
  returns: v.object({ outcome: v.string(), tags: v.optional(v.array(v.string())), retryScheduled: v.optional(v.boolean()) }),
  handler: async (ctx, args) => {
    const result = await classifyOne(ctx, args.assetId, { force: args.force, apply: args.apply });
    const attempt = args.attempt ?? 0;
    // A video's poster or a busy API can be late: index now without the tags,
    // try again later, and index once more when that later pass ends.
    if (result.retryable && attempt < RETRY_DELAYS_MS.length) {
      await ctx.scheduler.runAfter(RETRY_DELAYS_MS[attempt]!, classifyAssetRef, {
        ...args, attempt: attempt + 1, then: args.then ? "reindex" : undefined,
      });
      await continueWith(ctx, args.assetId, args.then);
      return { outcome: result.outcome, retryScheduled: true };
    }
    await continueWith(ctx, args.assetId, args.then);
    return { outcome: result.outcome, tags: result.tags };
  },
});

// Walks one owner's assets newest first, one page per action, five pictures at
// a time, classifying those without a finished classification. Run:
//   convex run jevClassify:backfillJevClassify '{"ownerUserId":"…","batchSize":20}'
export const backfillJevClassify = internalAction({
  args: {
    ownerUserId: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    apply: v.optional(v.boolean()),
  },
  returns: v.object({ classified: v.number(), failed: v.number(), done: v.boolean() }),
  handler: async (ctx, args): Promise<{ classified: number; failed: number; done: boolean }> => {
    if (!jevEnabled()) return { classified: 0, failed: 0, done: true };
    const page = await ctx.runQuery(listAssetsUnclassifiedRef, {
      ownerUserId: args.ownerUserId, cursor: args.cursor, batchSize: args.batchSize ?? 20,
    }) as { assetIds: Id<"assets">[]; nextCursor: string | null; isDone: boolean };
    let classified = 0;
    let failed = 0;
    for (let index = 0; index < page.assetIds.length; index += 5) {
      const results = await Promise.all(page.assetIds.slice(index, index + 5).map((assetId) => classifyOne(ctx, assetId, { apply: args.apply })));
      for (const result of results) {
        if (result.outcome === "classified") classified += 1;
        else if (result.outcome === "error") failed += 1;
      }
    }
    const batchesLeft = (args.maxBatches ?? Infinity) - 1;
    const done = page.isDone || batchesLeft <= 0;
    if (!done) {
      await ctx.scheduler.runAfter(0, backfillRef, {
        ownerUserId: args.ownerUserId, cursor: page.nextCursor, batchSize: args.batchSize, apply: args.apply,
        maxBatches: args.maxBatches === undefined ? undefined : batchesLeft,
      });
    }
    console.log(`Jev backfill page: ${classified} classified, ${failed} failed${done ? "; done" : ""}.`);
    return { classified, failed, done };
  },
});
