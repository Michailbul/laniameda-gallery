// Cleanup driver. Run AFTER scripts/migrate-videos-to-r2.ts has
// finished and you've confirmed migrated media serves from R2 for
// ~24h. For every asset that has R2 keys and matching Convex blobs
// still around, this deletes the Convex blobs and clears storage IDs.
//
// Reversibility note: this step is destructive on Convex side. R2
// is the only source of bytes after this runs. If R2 misbehaves later
// you'll need a local backup or re-ingest from origin.
//
// Usage:
//   bun scripts/cleanup-migrated-convex-video-blobs.ts             # real
//   bun scripts/cleanup-migrated-convex-video-blobs.ts --dry-run   # report
//   bun scripts/cleanup-migrated-convex-video-blobs.ts --kind image

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { buildSanitizedConvexEnv } from "./lib/convex-dev-env";

const cleanupBatchAction = makeFunctionReference<"action">(
  "r2_migrate:cleanupMigratedConvexBlobsBatch",
);

const sanitized = buildSanitizedConvexEnv(process.env);

const parseFlags = (argv: string[]) => {
  let dryRun = false;
  let batchSize = 5;
  let kind: "image" | "video" = "image";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--batch-size") {
      const value = Number.parseInt(argv[++i] ?? "", 10);
      if (Number.isFinite(value) && value > 0) batchSize = value;
      else throw new Error("--batch-size requires a positive integer.");
    } else if (arg === "--kind") {
      const value = argv[++i];
      if (value === "image" || value === "video") kind = value;
      else throw new Error("--kind must be image or video.");
    }
  }
  return { dryRun, batchSize, kind };
};

const main = async () => {
  const flags = parseFlags(process.argv.slice(2));

  const convexUrl =
    sanitized.CONVEX_URL?.trim() ||
    process.env.CONVEX_URL?.trim() ||
    process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
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
    `[cleanup] target=${convexUrl} kind=${flags.kind} batchSize=${flags.batchSize} dryRun=${flags.dryRun}`,
  );

  let cursor: string | undefined;
  let totalProcessed = 0;
  let totalCleaned = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let safety = 0;

  while (safety < 5000) {
    safety += 1;
    const batch = (await client.action(cleanupBatchAction as never, {
      cursor,
      batchSize: flags.batchSize,
      dryRun: flags.dryRun,
      kind: flags.kind,
    } as never)) as {
      processed: number;
      cleaned: number;
      skipped: number;
      failed: number;
      nextCursor?: string;
      done: boolean;
    };

    totalProcessed += batch.processed;
    totalCleaned += batch.cleaned;
    totalSkipped += batch.skipped;
    totalFailed += batch.failed;
    cursor = batch.nextCursor;

    console.log(
      `[batch] processed=${batch.processed} cleaned=${batch.cleaned} skipped=${batch.skipped} failed=${batch.failed} cursor=${batch.nextCursor ?? "done"}`,
    );

    if (batch.done) break;
  }

  console.log(
    `[cleanup done] processed=${totalProcessed} cleaned=${totalCleaned} skipped=${totalSkipped} failed=${totalFailed}`,
  );
};

main().catch((error) => {
  console.error("Cleanup failed:", error);
  process.exitCode = 1;
});
