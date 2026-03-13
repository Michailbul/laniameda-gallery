import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const backfillBatchAction = makeFunctionReference<"action">(
  "semanticIndex:backfillBatch",
);

const getRequiredEnv = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
};

const main = async () => {
  const convexUrl =
    process.env.CONVEX_URL?.trim() ??
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

  const batchSizeRaw = process.argv[2]?.trim();
  const batchSize = batchSizeRaw ? Number.parseInt(batchSizeRaw, 10) : 25;
  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    throw new Error("Batch size must be a positive integer.");
  }

  getRequiredEnv("SEMANTIC_EMBEDDINGS_ENABLED");

  const client = new ConvexHttpClient(convexUrl);
  client.setAdminAuth(adminKey);

  for (const sourceType of ["asset", "prompt", "designInspiration"] as const) {
    let cursor: string | undefined;
    let done = false;
    let totalProcessed = 0;
    let totalSuccess = 0;
    let totalFailure = 0;

    console.log(`\n== Backfill ${sourceType} ==`);

    while (!done) {
      const batch = (await client.action(backfillBatchAction as never, {
        sourceType,
        cursor,
        batchSize,
      })) as {
        processed: number;
        successCount: number;
        failureCount: number;
        nextCursor?: string;
        done: boolean;
      };

      totalProcessed += batch.processed;
      totalSuccess += batch.successCount;
      totalFailure += batch.failureCount;
      cursor = batch.nextCursor;
      done = batch.done;

      console.log(
        `[${sourceType}] processed=${batch.processed} success=${batch.successCount} failure=${batch.failureCount} cursor=${batch.nextCursor ?? "done"}`,
      );

      if (batch.processed === 0) {
        done = true;
      }
    }

    console.log(
      `[${sourceType}] total processed=${totalProcessed} success=${totalSuccess} failure=${totalFailure}`,
    );
  }
};

main().catch((error) => {
  console.error("Semantic index backfill failed:", error);
  process.exitCode = 1;
});
