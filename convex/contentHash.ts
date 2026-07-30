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

/**
 * Find byte-identical assets already in the vault and fold each group into one.
 *
 * `dryRun` (the default) only reports, because this deletes rows: run it, read
 * the groups, then pass dryRun: false. Assets whose bytes were never hashable
 * (a missing blob) carry no digest and are simply not considered — they can't
 * be compared, so they are never touched.
 */
export const dedupeExistingAssets: ReturnType<typeof internalAction> = internalAction({
  args: {
    ownerUserId: v.string(),
    dryRun: v.optional(v.boolean()),
    pageSize: v.optional(v.number()),
  },
  returns: v.object({
    scanned: v.number(),
    duplicateGroups: v.number(),
    removable: v.number(),
    removed: v.number(),
    foldersGained: v.number(),
    tagsGained: v.number(),
    referencesRepointed: v.number(),
    groups: v.array(
      v.object({
        contentHash: v.string(),
        assetIds: v.array(v.id("assets")),
      }),
    ),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    scanned: number;
    duplicateGroups: number;
    removable: number;
    removed: number;
    foldersGained: number;
    tagsGained: number;
    referencesRepointed: number;
    groups: Array<{ contentHash: string; assetIds: Id<"assets">[] }>;
  }> => {
    const dryRun = args.dryRun !== false;
    const byHash = new Map<string, Id<"assets">[]>();
    let cursor: string | null = null;
    let scanned = 0;

    for (;;) {
      const page: {
        rows: Array<{ assetId: Id<"assets">; contentHash: string }>;
        nextCursor: string | null;
        isDone: boolean;
      } = await ctx.runQuery(internal.assets.listAssetHashPage, {
        ownerUserId: args.ownerUserId,
        cursor,
        batchSize: args.pageSize ?? 200,
      });
      for (const row of page.rows) {
        scanned += 1;
        const list = byHash.get(row.contentHash) ?? [];
        list.push(row.assetId);
        byHash.set(row.contentHash, list);
      }
      if (page.isDone) break;
      cursor = page.nextCursor;
    }

    const groups = Array.from(byHash.entries())
      .filter(([, ids]) => ids.length > 1)
      .map(([contentHash, assetIds]) => ({ contentHash, assetIds }));
    const removable = groups.reduce((sum, group) => sum + group.assetIds.length - 1, 0);

    let removed = 0;
    let foldersGained = 0;
    let tagsGained = 0;
    let referencesRepointed = 0;

    if (!dryRun) {
      for (const group of groups) {
        const result: {
          removed: Id<"assets">[];
          foldersGained: number;
          tagsGained: number;
          referencesRepointed: number;
        } = await ctx.runMutation(internal.assets.mergeDuplicateAssets, {
          ownerUserId: args.ownerUserId,
          assetIds: group.assetIds,
        });
        removed += result.removed.length;
        foldersGained += result.foldersGained;
        tagsGained += result.tagsGained;
        referencesRepointed += result.referencesRepointed;
      }
    }

    return {
      scanned,
      duplicateGroups: groups.length,
      removable,
      removed,
      foldersGained,
      tagsGained,
      referencesRepointed,
      groups,
    };
  },
});
