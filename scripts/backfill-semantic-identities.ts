import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

// Administrative, metadata-only migration. No embedding calls or reindexing.
// No network access occurs without an explicit --check or --apply argument.
const CANONICAL_URL = "https://perfect-buffalo-375.convex.cloud";
const backfill = makeFunctionReference<"mutation">("semanticIndex:backfillSemanticIdentities");
const audit = makeFunctionReference<"query">("semanticIndex:auditSemanticIdentities");

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.length === 0) {
    console.log("Usage: bun scripts/backfill-semantic-identities.ts --check|--apply [--batch-size=25] [--cursor=CURSOR]");
    console.log("--check audits metadata coverage. --apply copies only identity metadata; requires separate deployment/migration approval.");
    return;
  }
  const apply = args.includes("--apply");
  if (apply === args.includes("--check") || args.some((arg) =>
    arg !== "--apply" && arg !== "--check" && !arg.startsWith("--batch-size=") && !arg.startsWith("--cursor="),
  )) throw new Error("Choose exactly one of --check or --apply. Use --help for options.");
  const batchSize = Number(args.find((arg) => arg.startsWith("--batch-size="))?.slice(13) ?? 25);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) {
    throw new Error("Batch size must be an integer between 1 and 50.");
  }
  const urls = [process.env.CONVEX_URL, process.env.NEXT_PUBLIC_CONVEX_URL]
    .map((value) => value?.trim()).filter(Boolean);
  if (urls.length === 0 || urls.some((url) => url !== CANONICAL_URL)) {
    throw new Error("Set CONVEX_URL to the canonical gallery deployment; resolve any conflicting NEXT_PUBLIC_CONVEX_URL first.");
  }
  if (process.env.CONVEX_DEPLOYMENT && process.env.CONVEX_DEPLOYMENT !== "dev:perfect-buffalo-375") {
    throw new Error("CONVEX_DEPLOYMENT conflicts with the canonical gallery deployment.");
  }
  const key = process.env.CONVEX_ADMIN_KEY?.trim() ?? process.env.CONVEX_DEPLOY_KEY?.trim();
  if (!key) throw new Error("CONVEX_ADMIN_KEY or CONVEX_DEPLOY_KEY is required.");
  const client = new ConvexHttpClient(CANONICAL_URL);
  (client as ConvexHttpClient & { setAdminAuth(token: string): void }).setAdminAuth(key);
  let cursor = args.find((arg) => arg.startsWith("--cursor="))?.slice(9) || undefined;
  const resumed = cursor !== undefined;
  const totals = { scanned: 0, written: 0, missing: 0, mismatched: 0 };
  while (true) {
    const input = { cursor, batchSize };
    const result = (apply ? await client.mutation(backfill, input) : await client.query(audit, input)) as {
      scanned: number; written?: number; missing?: number; mismatched?: number;
      nextCursor?: string; done: boolean;
    };
    for (const key of ["scanned", "written", "missing", "mismatched"] as const) totals[key] += result[key] ?? 0;
    console.log(JSON.stringify({ mode: apply ? "apply" : "check", ...result }));
    if (result.done) break;
    if (!result.nextCursor || result.nextCursor === cursor) throw new Error("Migration returned a non-advancing cursor.");
    cursor = result.nextCursor;
  }
  console.log(JSON.stringify({ totals, completeCoverage: !apply && !resumed && totals.missing === 0 && totals.mismatched === 0 }));
  if (!apply && (totals.missing > 0 || totals.mismatched > 0)) process.exitCode = 1;
}

if (import.meta.main) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Semantic identity migration failed.");
  process.exitCode = 1;
});
