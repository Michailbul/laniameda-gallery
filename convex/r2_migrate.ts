"use node";

// Phase 3 of the Convex → R2 video migration: walk every existing
// video asset that still lives in Convex _storage, copy its bytes to
// Cloudflare R2 via the @convex-dev/r2 component, and stamp r2Key on
// the asset row. The original storageId is intentionally LEFT IN
// PLACE — a follow-up cleanup script deletes it after a 24h soak so
// we can roll back without re-uploading from scratch if R2 misbehaves.

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { r2 } from "./r2";

type Asset = {
  _id: Id<"assets">;
  ownerUserId?: string;
  kind: "image" | "video";
  storageId?: Id<"_storage">;
  r2Key?: string;
  contentType?: string;
  size?: number;
  fileName?: string;
};

const slug = (input: string) =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9-_.]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60);

const buildMigrationKey = (asset: Asset) => {
  const owner = asset.ownerUserId ? slug(asset.ownerUserId) : "unknown";
  const ext = asset.fileName?.split(".").pop()?.toLowerCase();
  const safeExt = ext && /^[a-z0-9]{1,8}$/.test(ext) ? `.${ext}` : "";
  const baseName = asset.fileName ? slug(asset.fileName) : asset._id;
  return `videos-migrated/${owner}/${asset._id}-${baseName}${safeExt}`;
};

export const migrateVideoBatch = action({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    processed: v.number(),
    migrated: v.number(),
    skipped: v.number(),
    failed: v.number(),
    nextCursor: v.optional(v.string()),
    done: v.boolean(),
    sample: v.array(
      v.object({
        assetId: v.id("assets"),
        status: v.string(),
        r2Key: v.optional(v.string()),
        reason: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    const batchSize = args.batchSize ?? 1;

    const page = (await ctx.runQuery(
      internal.r2_migrate_db.listMigrationCandidates,
      {
        cursor: args.cursor,
        batchSize,
      },
    )) as { items: Asset[]; nextCursor?: string; done: boolean };

    let migrated = 0;
    let skipped = 0;
    let failed = 0;
    const sample: Array<{
      assetId: Id<"assets">;
      status: string;
      r2Key?: string;
      reason?: string;
    }> = [];

    for (const asset of page.items) {
      try {
        if (asset.kind !== "video") {
          skipped += 1;
          sample.push({
            assetId: asset._id,
            status: "skipped",
            reason: "not a video",
          });
          continue;
        }
        if (asset.r2Key) {
          skipped += 1;
          sample.push({
            assetId: asset._id,
            status: "skipped",
            reason: "already on R2",
            r2Key: asset.r2Key,
          });
          continue;
        }
        if (!asset.storageId) {
          skipped += 1;
          sample.push({
            assetId: asset._id,
            status: "skipped",
            reason: "no storageId",
          });
          continue;
        }

        const blob = await ctx.storage.get(asset.storageId);
        if (!blob) {
          skipped += 1;
          sample.push({
            assetId: asset._id,
            status: "skipped",
            reason: "convex blob missing",
          });
          continue;
        }

        if (dryRun) {
          sample.push({
            assetId: asset._id,
            status: "would-migrate",
            r2Key: buildMigrationKey(asset),
          });
          migrated += 1;
          continue;
        }

        const customKey = buildMigrationKey(asset);
        const r2Key = await r2.store(ctx, blob, {
          key: customKey,
          type: asset.contentType || blob.type || undefined,
        });

        await ctx.runMutation(api.r2_migrate_db.markAssetMigrated, {
          assetId: asset._id,
          r2Key,
        });

        migrated += 1;
        sample.push({
          assetId: asset._id,
          status: "migrated",
          r2Key,
        });
      } catch (error) {
        failed += 1;
        sample.push({
          assetId: asset._id,
          status: "failed",
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      processed: page.items.length,
      migrated,
      skipped,
      failed,
      nextCursor: page.nextCursor,
      done: page.done,
      sample,
    };
  },
});

export const cleanupMigratedConvexBlobsBatch = action({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    processed: v.number(),
    cleaned: v.number(),
    skipped: v.number(),
    failed: v.number(),
    nextCursor: v.optional(v.string()),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    const batchSize = args.batchSize ?? 5;

    const page = (await ctx.runQuery(
      internal.r2_migrate_db.listCleanupCandidates,
      { cursor: args.cursor, batchSize },
    )) as { items: Asset[]; nextCursor?: string; done: boolean };

    let cleaned = 0;
    let skipped = 0;
    let failed = 0;

    for (const asset of page.items) {
      try {
        if (!asset.r2Key || !asset.storageId) {
          skipped += 1;
          continue;
        }
        if (dryRun) {
          cleaned += 1;
          continue;
        }
        await ctx.runMutation(api.r2_migrate_db.dropConvexBlob, {
          assetId: asset._id,
        });
        cleaned += 1;
      } catch {
        failed += 1;
      }
    }

    return {
      processed: page.items.length,
      cleaned,
      skipped,
      failed,
      nextCursor: page.nextCursor,
      done: page.done,
    };
  },
});
