import { makeFunctionReference } from "convex/server";
import { createCanonicalAdminClient, readFlag } from "./lib/canonical-convex-admin";

// Copies legacy semanticDocuments vectors into split storage (semanticEntries
// + one 768-value vector row per lane). No provider calls. Dry run unless
// --apply. Idempotent: sources that already have an entry are skipped, so a
// rerun or a resumed run (--cursor) never overwrites newer writes.
// Runbook: agent-docs/SEMANTIC_SPLIT_RUNBOOK.md.
const migrate = makeFunctionReference<"mutation">("semanticIndex:migrateSemanticVectorsToSplit");
const storageStatus = makeFunctionReference<"query">("semanticIndex:getSemanticStorageStatus");
const rowSizes = makeFunctionReference<"query">("semanticSearch:measureSearchRowSizes");

type Batch = {
  apply: boolean; table: string; scanned: number; alreadySplit: number; missing: number; copied: number;
  noLegacyVectors: number; unverifiedPixel: number; unverifiedText: number;
  legacyBytesRead: number; splitBytesWritten: number; nextCursor?: string; done: boolean;
};

const USAGE = `Usage: bun scripts/migrate-semantic-split.ts [--apply] [--batch-size=25] [--cursor=CURSOR]
Without --apply: a dry run that reads source rows and entries only (no legacy vectors) and writes nothing.
--apply copies missing sources; the deployment must already run SEMANTIC_STORAGE=dual (or split).`;

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(USAGE);
    return;
  }
  const unknown = args.filter((arg) =>
    arg !== "--apply" && arg !== "--dry-run" && !arg.startsWith("--batch-size=") && !arg.startsWith("--cursor="));
  if (unknown.length > 0) throw new Error(`Unknown arguments: ${unknown.join(" ")}\n${USAGE}`);
  const apply = args.includes("--apply");
  if (apply && args.includes("--dry-run")) throw new Error("Choose --apply or --dry-run, not both.");
  const batchSize = Number(readFlag(args, "batch-size") ?? 25);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) {
    throw new Error("Batch size must be an integer between 1 and 50.");
  }
  const client = createCanonicalAdminClient();
  const status = (await client.query(storageStatus, {})) as { mode: string; embeddingsEnabled: boolean };
  console.log(JSON.stringify({ deployment: status }));
  if (apply && status.mode === "legacy") {
    throw new Error(
      "The deployment still writes legacy storage only. Set SEMANTIC_STORAGE=dual first, so edits made " +
      "while the copy runs reach the split tables too.",
    );
  }

  let cursor = readFlag(args, "cursor") || undefined;
  const totals = {
    scanned: 0, alreadySplit: 0, missing: 0, copied: 0, noLegacyVectors: 0,
    unverifiedPixel: 0, unverifiedText: 0, legacyBytesRead: 0, splitBytesWritten: 0,
  };
  for (;;) {
    const batch = (await client.mutation(migrate, { cursor, batchSize, apply })) as Batch;
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += batch[key];
    console.log(JSON.stringify(batch));
    if (batch.done) break;
    if (!batch.nextCursor || batch.nextCursor === cursor) throw new Error("Migration returned a non-advancing cursor.");
    cursor = batch.nextCursor;
  }

  if (!apply) {
    const sizes = (await client.query(rowSizes, { sample: 5 })) as { legacyDocument: number };
    const legacyRow = sizes.legacyDocument || 56_211;
    console.log(JSON.stringify({
      totals,
      estimate: {
        note: "An --apply run reads each missing source's legacy row once and writes an entry plus up to two 768-value vectors.",
        legacyBytesToRead: totals.missing * legacyRow,
        splitBytesToWrite: totals.missing * 14_500,
        averageLegacyRowBytes: legacyRow,
      },
    }));
    return;
  }
  console.log(JSON.stringify({
    totals,
    next: totals.noLegacyVectors > 0
      ? "Sources without legacy vectors are indexed by their next edit, or run bun scripts/backfill-semantic-index.ts."
      : "Compare search quality with bun scripts/semantic-search-eval.ts before setting SEMANTIC_STORAGE=split.",
  }));
}

if (import.meta.main) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Semantic split migration failed.");
  process.exitCode = 1;
});
