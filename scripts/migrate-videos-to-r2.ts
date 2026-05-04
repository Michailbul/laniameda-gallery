// Phase 3 driver: walks every existing video asset that still lives
// in Convex _storage and migrates the bytes to Cloudflare R2 via the
// component's r2.store(). The migration LEAVES the original Convex
// storageId in place — once you've verified all videos play from R2
// for ~24h, run scripts/cleanup-migrated-convex-video-blobs.ts to
// free the Convex bytes.
//
// Usage:
//   bun scripts/migrate-videos-to-r2.ts              # real run
//   bun scripts/migrate-videos-to-r2.ts --dry-run    # report only
//   bun scripts/migrate-videos-to-r2.ts --batch-size 3
//
// Env required: CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL) + CONVEX_ADMIN_KEY.

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { buildSanitizedConvexEnv } from "./lib/convex-dev-env";

const migrateBatchAction = makeFunctionReference<"action">(
  "r2_migrate:migrateVideoBatch",
);

const sanitized = buildSanitizedConvexEnv(process.env);
const baseEnv: Record<string, string | undefined> = {
  ...process.env,
  CONVEX_URL:
    sanitized.CONVEX_URL ??
    process.env.CONVEX_URL ??
    process.env.NEXT_PUBLIC_CONVEX_URL,
};

type Flags = {
  dryRun: boolean;
  batchSize: number;
};

const parseFlags = (argv: string[]): Flags => {
  let dryRun = false;
  let batchSize = 1;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--batch-size") {
      const value = Number.parseInt(argv[++i] ?? "", 10);
      if (Number.isFinite(value) && value > 0) {
        batchSize = value;
      } else {
        throw new Error("--batch-size requires a positive integer.");
      }
    }
  }
  return { dryRun, batchSize };
};

const main = async () => {
  const flags = parseFlags(process.argv.slice(2));

  const convexUrl =
    baseEnv.CONVEX_URL?.trim() || baseEnv.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!convexUrl) {
    throw new Error("CONVEX_URL or NEXT_PUBLIC_CONVEX_URL is required.");
  }

  const adminKey =
    process.env.CONVEX_ADMIN_KEY?.trim() ??
    process.env.CONVEX_DEPLOY_KEY?.trim();
  if (!adminKey) {
    throw new Error("CONVEX_ADMIN_KEY or CONVEX_DEPLOY_KEY is required.");
  }

  const client = new ConvexHttpClient(convexUrl);
  (
    client as ConvexHttpClient & { setAdminAuth: (token: string) => void }
  ).setAdminAuth(adminKey);

  console.log(
    `[migrate] target=${convexUrl} batchSize=${flags.batchSize} dryRun=${flags.dryRun}`,
  );

  let cursor: string | undefined;
  let totalProcessed = 0;
  let totalMigrated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let safety = 0;

  while (safety < 5000) {
    safety += 1;
    const batch = (await client.action(migrateBatchAction as never, {
      cursor,
      batchSize: flags.batchSize,
      dryRun: flags.dryRun,
    } as never)) as {
      processed: number;
      migrated: number;
      skipped: number;
      failed: number;
      nextCursor?: string;
      done: boolean;
      sample: Array<{
        assetId: string;
        status: string;
        r2Key?: string;
        reason?: string;
      }>;
    };

    totalProcessed += batch.processed;
    totalMigrated += batch.migrated;
    totalSkipped += batch.skipped;
    totalFailed += batch.failed;
    cursor = batch.nextCursor;

    for (const item of batch.sample) {
      const tail = item.r2Key ? ` r2Key=${item.r2Key}` : "";
      const reason = item.reason ? ` reason=${item.reason}` : "";
      console.log(`  ${item.status} ${item.assetId}${tail}${reason}`);
    }
    console.log(
      `[batch] processed=${batch.processed} migrated=${batch.migrated} skipped=${batch.skipped} failed=${batch.failed} cursor=${batch.nextCursor ?? "done"}`,
    );

    if (batch.done || batch.processed === 0) break;
  }

  console.log(
    `[migrate done] processed=${totalProcessed} migrated=${totalMigrated} skipped=${totalSkipped} failed=${totalFailed}`,
  );
};

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exitCode = 1;
});
