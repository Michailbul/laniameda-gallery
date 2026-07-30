"use node";

import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { buildR2PublicUrl } from "./r2_url";

/**
 * Backfill `assets.contentHash` for rows that predate it.
 *
 * The duplicate check at ingest compares digests, so every asset saved before
 * this feature existed is invisible to it — re-uploading a two-month-old image
 * would create a second copy. This walks the owner's assets, fetches the stored
 * bytes, and records the digest.
 *
 * Self-scheduling one batch at a time: hashing means downloading the original
 * media, which is far too slow to do for a whole vault inside one action
 * timeout. Safe to re-run — `setAssetContentHash` only fills gaps, and a batch
 * that dies mid-way just leaves the rest for the next run.
 */
// The explicit annotations below are load-bearing: the handler schedules
// ITSELF, so without them TypeScript can't close the inference loop and every
// `api`/`internal` type in the project silently degrades to `any`.
export const backfillContentHashes: ReturnType<typeof internalAction> = internalAction({
  args: {
    ownerUserId: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    /** Stop after this many batches (safety valve); omit for "until done". */
    maxBatches: v.optional(v.number()),
    /** Running totals across the self-scheduled chain. */
    hashedSoFar: v.optional(v.number()),
    skippedSoFar: v.optional(v.number()),
  },
  returns: v.object({
    hashed: v.number(),
    skipped: v.number(),
    done: v.boolean(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ hashed: number; skipped: number; done: boolean }> => {
    const batch: {
      rows: Array<{
        assetId: Id<"assets">;
        r2Key?: string;
        storageId?: Id<"_storage">;
      }>;
      nextCursor: string | null;
      isDone: boolean;
    } = await ctx.runQuery(internal.assets.listAssetsMissingContentHash, {
      ownerUserId: args.ownerUserId,
      cursor: args.cursor,
      batchSize: args.batchSize ?? 25,
    });

    let hashed = args.hashedSoFar ?? 0;
    let skipped = args.skippedSoFar ?? 0;

    for (const row of batch.rows) {
      const url = row.r2Key
        ? buildR2PublicUrl(row.r2Key)
        : row.storageId
          ? await ctx.storage.getUrl(row.storageId)
          : null;
      if (!url) {
        skipped += 1;
        continue;
      }
      try {
        const response = await fetch(url);
        if (!response.ok) {
          skipped += 1;
          continue;
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        const digest = createHash("sha256").update(bytes).digest("hex");
        await ctx.runMutation(internal.assets.setAssetContentHash, {
          assetId: row.assetId,
          contentHash: digest,
        });
        hashed += 1;
      } catch {
        // A single unreachable blob must not stall the whole vault.
        skipped += 1;
      }
    }

    const batchesLeft = (args.maxBatches ?? Infinity) - 1;
    const done = batch.isDone || batchesLeft <= 0;
    if (!done) {
      await ctx.scheduler.runAfter(
        0,
        internal.contentHash.backfillContentHashes,
        {
          ownerUserId: args.ownerUserId,
          cursor: batch.nextCursor,
          batchSize: args.batchSize,
          maxBatches: args.maxBatches === undefined ? undefined : batchesLeft,
          hashedSoFar: hashed,
          skippedSoFar: skipped,
        },
      );
    }

    return { hashed, skipped, done };
  },
});
