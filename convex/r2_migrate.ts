"use node";

// Phase 3 of the Convex → R2 video migration: walk every existing
// video asset that still lives in Convex _storage, copy its bytes to
// Cloudflare R2 via the @convex-dev/r2 component, and stamp r2Key on
// the asset row. The original storageId is intentionally LEFT IN
// PLACE — a follow-up cleanup script deletes it after a 24h soak so
// we can roll back without re-uploading from scratch if R2 misbehaves.

import { v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { storeBlobToR2 } from "./r2_store";

type Asset = {
  _id: Id<"assets">;
  ownerUserId?: string;
  kind: "image" | "video";
  storageId?: Id<"_storage">;
  thumbStorageId?: Id<"_storage">;
  r2Key?: string;
  thumbR2Key?: string;
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
  return `${asset.kind}s-migrated/${owner}/${asset._id}-${baseName}${safeExt}`;
};

const buildThumbMigrationKey = (asset: Asset) => {
  const owner = asset.ownerUserId ? slug(asset.ownerUserId) : "unknown";
  const baseName = asset.fileName ? slug(asset.fileName) : asset._id;
  return `${asset.kind}s-migrated/${owner}/${asset._id}-${baseName}.thumb`;
};

const migrateBatch = async (
  ctx: ActionCtx,
  args: {
    cursor?: string;
    batchSize?: number;
    dryRun?: boolean;
    kind?: "image" | "video";
  },
) => {
  const dryRun = args.dryRun ?? false;
  const batchSize = args.batchSize ?? 1;
  const kind = args.kind ?? "video";

  const page = (await ctx.runQuery(
    internal.r2_migrate_db.listMigrationCandidates,
    {
      cursor: args.cursor,
      batchSize,
      kind,
    },
  )) as { items: Asset[]; nextCursor?: string; done: boolean };

  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  const sample: Array<{
    assetId: Id<"assets">;
    status: string;
    r2Key?: string;
    thumbR2Key?: string;
    reason?: string;
  }> = [];

  for (const asset of page.items) {
    try {
      if (asset.kind !== kind) {
        skipped += 1;
        sample.push({
          assetId: asset._id,
          status: "skipped",
          reason: `not a ${kind}`,
        });
        continue;
      }

      if (!asset.storageId && !asset.thumbStorageId) {
        skipped += 1;
        sample.push({
          assetId: asset._id,
          status: "skipped",
          reason: "no Convex storage blobs",
        });
        continue;
      }

      const nextR2Key = asset.r2Key;
      const nextThumbR2Key = asset.thumbR2Key;
      let migratedR2Key = nextR2Key;
      let migratedThumbR2Key = nextThumbR2Key;

      if (dryRun) {
        sample.push({
          assetId: asset._id,
          status: "would-migrate",
          r2Key: asset.r2Key ?? (asset.storageId ? buildMigrationKey(asset) : undefined),
          thumbR2Key:
            asset.thumbR2Key ??
            (asset.thumbStorageId ? buildThumbMigrationKey(asset) : undefined),
        });
        migrated += 1;
        continue;
      }

      if (!asset.r2Key && asset.storageId) {
        const blob = await ctx.storage.get(asset.storageId);
        if (!blob) {
          skipped += 1;
          sample.push({
            assetId: asset._id,
            status: "skipped",
            reason: "primary Convex blob missing",
          });
          continue;
        }
        migratedR2Key = await storeBlobToR2(ctx, blob, {
          key: buildMigrationKey(asset),
          type: asset.contentType || blob.type || undefined,
        });
      }

      if (!asset.thumbR2Key && asset.thumbStorageId) {
        const thumbBlob = await ctx.storage.get(asset.thumbStorageId);
        if (thumbBlob) {
          migratedThumbR2Key = await storeBlobToR2(ctx, thumbBlob, {
            key: buildThumbMigrationKey(asset),
            type: thumbBlob.type || undefined,
          });
        }
      }

      if (!migratedR2Key) {
        skipped += 1;
        sample.push({
          assetId: asset._id,
          status: "skipped",
          reason: "no primary R2 key",
        });
        continue;
      }

      await ctx.runMutation(api.r2_migrate_db.markAssetMigrated, {
        assetId: asset._id,
        r2Key: migratedR2Key,
        thumbR2Key: migratedThumbR2Key,
      });

      migrated += 1;
      sample.push({
        assetId: asset._id,
        status: "migrated",
        r2Key: migratedR2Key,
        thumbR2Key: migratedThumbR2Key,
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
};

export const migrateImageBatch = action({
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
        thumbR2Key: v.optional(v.string()),
        reason: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx, args) => await migrateBatch(ctx, { ...args, kind: "image" }),
});

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
        thumbR2Key: v.optional(v.string()),
        reason: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx, args) => await migrateBatch(ctx, { ...args, kind: "video" }),
});

export const cleanupMigratedConvexBlobsBatch = action({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
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
      { cursor: args.cursor, batchSize, kind: args.kind ?? "video" },
    )) as { items: Asset[]; nextCursor?: string; done: boolean };

    let cleaned = 0;
    let skipped = 0;
    let failed = 0;

    for (const asset of page.items) {
      try {
        if (
          (!asset.r2Key || !asset.storageId) &&
          (!asset.thumbR2Key || !asset.thumbStorageId)
        ) {
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
