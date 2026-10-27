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

  // bun scripts/backfill-semantic-index.ts [batchSize] [--sources=asset,skill] [--text-only]
  // Re-embeds through the deployment's normal reindex path, so it writes the
  // layout SEMANTIC_STORAGE selects. Only assets and Skills are searched;
  // prompt and design-inspiration vectors exist in legacy storage only.
  const args = process.argv.slice(2);
  const batchSizeRaw = args.find((arg) => !arg.startsWith("--"))?.trim();
  const batchSize = batchSizeRaw ? Number.parseInt(batchSizeRaw, 10) : 25;
  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    throw new Error("Batch size must be a positive integer.");
  }
  const sourceTypes = (args.find((arg) => arg.startsWith("--sources="))?.slice("--sources=".length) ?? "asset,skill")
    .split(",").map((source) => source.trim()).filter(Boolean);
  const allowed = new Set(["asset", "skill", "prompt", "designInspiration"]);
  if (sourceTypes.length === 0 || sourceTypes.some((source) => !allowed.has(source))) {
    throw new Error("--sources takes asset, skill, prompt and/or designInspiration.");
  }
  const textOnly = args.includes("--text-only");

  getRequiredEnv("SEMANTIC_EMBEDDINGS_ENABLED");

  const client = new ConvexHttpClient(convexUrl);
  (client as ConvexHttpClient & { setAdminAuth: (token: string) => void }).setAdminAuth(
    adminKey,
  );

  for (const sourceType of sourceTypes) {
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
        ...(textOnly && sourceType === "asset" ? { textOnly: true } : {}),
      } as never)) as {
        processed: number;
        successCount: number;
        failureCount: number;
        nextCursor?: string;
        done: boolean;
      };

      totalProcessed += batch.processed;
      totalSuccess += batch.successCount;
      totalFailure += batch.failureCount;
      if (!batch.done && (!batch.nextCursor || batch.nextCursor === cursor)) {
        throw new Error("Backfill returned a non-advancing cursor.");
      }
      cursor = batch.nextCursor;
      done = batch.done;

      console.log(
        `[${sourceType}] processed=${batch.processed} success=${batch.successCount} failure=${batch.failureCount} cursor=${batch.nextCursor ?? "done"}`,
      );

      // A bounded native page can contain no eligible legacy-cursor rows.
      // Only the server's done flag indicates that the source is exhausted.
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
