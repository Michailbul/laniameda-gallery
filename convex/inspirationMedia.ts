"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { signedOwnerAction as ownerAction } from "./actor";
import { encodeCardThumbnail } from "./thumbnails";
import { storeBlobToR2 } from "./r2_store";

// Posting a version with media: the agent route has already resolved each
// upload ticket (the bytes are in R2, read back, hashed and measured) and
// passes a poster JPEG per output. Here each poster becomes a card thumbnail
// in R2; then the version row is written. Nothing becomes an asset.

const outputInput = v.object({
  key: v.string(),
  kind: v.union(v.literal("image"), v.literal("video")),
  r2Key: v.string(),
  contentType: v.string(),
  contentHash: v.string(),
  size: v.number(),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  label: v.optional(v.string()),
  posterBase64: v.optional(v.string()),
});

export const postVersion = ownerAction({
  args: {
    ownerUserId: v.string(),
    adaptationId: v.id("inspirationAdaptations"),
    ingestKey: v.string(),
    basedOnVersion: v.number(),
    outputs: v.array(outputInput),
    text: v.optional(v.string()),
    prompt: v.optional(v.string()),
    references: v.optional(v.array(v.string())),
    model: v.optional(v.string()),
    provider: v.optional(v.string()),
    costUsd: v.optional(v.number()),
    costExact: v.optional(v.boolean()),
    costNote: v.optional(v.string()),
    notes: v.optional(v.string()),
    redoEventId: v.optional(v.id("inspirationEvents")),
    jobId: v.optional(v.id("inspirationJobs")),
    dispatchNonce: v.optional(v.string()),
    dispatchFence: v.optional(v.number()),
    createdBy: v.optional(v.string()),
  },
  returns: v.object({
    versionId: v.id("inspirationVersions"), number: v.number(), created: v.boolean(), orphan: v.boolean(), revision: v.number(),
  }),
  handler: async (ctx, args): Promise<{ versionId: Id<"inspirationVersions">; number: number; created: boolean; orphan: boolean; revision: number }> => {
    // A retry with the same key returns the version already written, before any new thumbnail is stored.
    const repeat: { versionId: Id<"inspirationVersions">; number: number; orphan: boolean; revision: number } | null =
      await ctx.runQuery(internal.inspiration.findVersionForRetry, { ownerUserId: args.ownerUserId, adaptationId: args.adaptationId, ingestKey: args.ingestKey });
    if (repeat) return { ...repeat, created: false };
    const outputs = [];
    for (const output of args.outputs) {
      let thumb: { thumbR2Key: string; thumbWidth: number; thumbHeight: number } | undefined;
      if (output.posterBase64) {
        const encoded = await encodeCardThumbnail(Buffer.from(output.posterBase64, "base64"));
        if (encoded) {
          thumb = {
            thumbR2Key: await storeBlobToR2(ctx, encoded.blob, { type: encoded.contentType }),
            thumbWidth: encoded.width, thumbHeight: encoded.height,
          };
        }
      }
      const { posterBase64: _poster, ...rest } = output;
      void _poster;
      outputs.push({ ...rest, ...(thumb ?? {}) });
    }
    const { outputs: _raw, ...rest } = args;
    void _raw;
    return await ctx.runMutation(internal.inspiration.postInspirationVersionInternal, { ...rest, outputs });
  },
});
