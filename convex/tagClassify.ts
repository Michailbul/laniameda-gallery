"use node";

import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import { FACETS_VERSION, FACET_MODEL, buildFacetRequest, compactAnswers } from "../lib/facet-tags";

// Auto-tagging of every new picture with OpenAI's Decisions API (gpt-6-luna;
// Jev until 2 Nov 2026). createAsset schedules classifyAsset before the
// asset's first index, so the tags it adds are in the search text; whatever
// happens here, the describe or index step it was handed runs afterwards.
// Off unless the deployment sets TAG_CLASSIFY_ENABLED=true and OPENAI_API_KEY.

const API_URL = "https://api.openai.com/v1/decisions";
const MAX_BYTES = 40 * 1024 * 1024;
const LONG_SIDE = 1024;
const MIN_SIDE = 280;
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000] as const;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

const getClassifySourceRef = makeFunctionReference<"query">("assetClassifications:getClassifySource");
const saveClassificationRef = makeFunctionReference<"mutation">("assetClassifications:saveClassification");
const listAssetsUnclassifiedRef = makeFunctionReference<"query">("assetClassifications:listAssetsUnclassified");
const classifyAssetRef = makeFunctionReference<"action">("tagClassify:classifyAsset");
const backfillRef = makeFunctionReference<"action">("tagClassify:backfillTags");
const describeAssetRef = makeFunctionReference<"action">("agentDescriptions:describeAsset");
const reindexAssetRef = makeFunctionReference<"action">("semanticIndex:reindexAsset");
const fileOnShelvesRef = makeFunctionReference<"action">("shelfClassify:fileOnShelves");

export const tagsEnabled = () =>
  process.env.TAG_CLASSIFY_ENABLED?.trim().toLowerCase() === "true" && Boolean(process.env.OPENAI_API_KEY?.trim());

type Sharp = (typeof import("sharp"))["default"];
let sharpLoader: Promise<Sharp> | undefined;
const loadSharp = () => {
  sharpLoader ??= import("sharp").then((mod) => {
    mod.default.cache(false);
    return mod.default;
  });
  return sharpLoader;
};

/** Both classifiers take JPEG; Jev wants 280–1568 px a side: the thumbnail (WebP) re-encoded at 1024 px. */
export const jpegOf = async (url: string) => {
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

class DecisionError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

const askOpenAI = async (jpegBase64: string) => {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY?.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildFacetRequest(jpegBase64)),
  });
  if (!response.ok) {
    throw new DecisionError(`OpenAI HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`, RETRYABLE.has(response.status));
  }
  const body = await response.json() as { answers: Parameters<typeof compactAnswers>[0] };
  return compactAnswers(body.answers);
};

type Then = "describe" | "reindex" | undefined;
const continueWith = async (ctx: ActionCtx, assetId: Id<"assets">, then: Then) => {
  if (then === "describe") await ctx.scheduler.runAfter(0, describeAssetRef, { assetId, reindexAfter: true });
  else if (then === "reindex") await ctx.scheduler.runAfter(0, reindexAssetRef, { assetId });
};

type Outcome = "classified" | "skipped" | "disabled" | "no_image" | "error";

const classifyOne = async (ctx: ActionCtx, assetId: Id<"assets">, opts: { force?: boolean; apply?: boolean }): Promise<{ outcome: Outcome; retryable?: boolean; tags?: string[] }> => {
  if (!tagsEnabled()) return { outcome: "disabled" };
  const source = await ctx.runQuery(getClassifySourceRef, { assetId, version: FACETS_VERSION }) as { imageUrl?: string; kind: string; classified: boolean } | null;
  if (!source || (source.classified && !opts.force)) return { outcome: "skipped" };
  if (!source.imageUrl) return { outcome: "no_image", retryable: source.kind === "video" };
  try {
    const answers = await askOpenAI(await jpegOf(source.imageUrl));
    const tags = await ctx.runMutation(saveClassificationRef, {
      assetId, model: FACET_MODEL, version: FACETS_VERSION, status: "done", answers, apply: opts.apply,
    }) as string[];
    return { outcome: "classified", tags };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Tagging failed for asset:${assetId}: ${message}`);
    await ctx.runMutation(saveClassificationRef, { assetId, model: FACET_MODEL, version: FACETS_VERSION, status: "error", error: message.slice(0, 300) });
    return { outcome: "error", retryable: !(error instanceof DecisionError) || error.retryable };
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
    // A new picture saved into a world also goes onto that world's shelves
    // (convex/shelfClassify.ts); that step has its own retries.
    if (attempt === 0 && args.then && process.env.SHELF_CLASSIFY_ENABLED?.trim().toLowerCase() === "true") {
      await ctx.scheduler.runAfter(0, fileOnShelvesRef, { assetId: args.assetId });
    }
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

// Walks one owner's assets newest first, one page per action, ten pictures at
// a time, tagging those without a finished classification of this version
// (pictures Jev tagged are asked again; their tags stay, gaps get filled). Run:
//   convex run tagClassify:backfillTags '{"ownerUserId":"…","batchSize":40}'
export const backfillTags = internalAction({
  args: {
    ownerUserId: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    apply: v.optional(v.boolean()),
  },
  returns: v.object({ classified: v.number(), failed: v.number(), done: v.boolean() }),
  handler: async (ctx, args): Promise<{ classified: number; failed: number; done: boolean }> => {
    if (!tagsEnabled()) return { classified: 0, failed: 0, done: true };
    const page = await ctx.runQuery(listAssetsUnclassifiedRef, {
      ownerUserId: args.ownerUserId, cursor: args.cursor, batchSize: args.batchSize ?? 20, version: FACETS_VERSION,
    }) as { assetIds: Id<"assets">[]; nextCursor: string | null; isDone: boolean };
    let classified = 0;
    let failed = 0;
    for (let index = 0; index < page.assetIds.length; index += 10) {
      const results = await Promise.all(page.assetIds.slice(index, index + 10).map((assetId) => classifyOne(ctx, assetId, { apply: args.apply })));
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
    console.log(`Tag backfill page: ${classified} classified, ${failed} failed${done ? "; done" : ""}.`);
    return { classified, failed, done };
  },
});
