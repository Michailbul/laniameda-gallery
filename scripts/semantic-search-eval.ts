import { readFileSync, writeFileSync } from "node:fs";
import { makeFunctionReference } from "convex/server";
import { createCanonicalAdminClient, readFlag } from "./lib/canonical-convex-admin";

// Runs representative searches through the read plans and prints, per query,
// how far each plan's results agree with the old one and roughly how many
// bytes it read. Read-only apart from query-embedding cache rows.
//   before - lane depths and hydration before 18 October 2026 (legacy storage)
//   tuned  - current lane depths, legacy storage
//   split  - current lane depths, split storage (after the migration)
// Runbook: agent-docs/SEMANTIC_SPLIT_RUNBOOK.md.
const evaluate = makeFunctionReference<"action">("semanticSearch:evaluateSearchPlans");
const rowSizes = makeFunctionReference<"query">("semanticSearch:measureSearchRowSizes");

export const DEFAULT_QUERIES = [
  "Gothic city at dusk",
  "Art Deco interior",
  "romance close-up",
  "cyberpunk street",
  "flower shop at night",
  "rainy street at night",
  "clay character waving",
  "character reference sheet",
  "vintage car on a mountain road",
  "foggy forest cabin",
];

type Plan = "before" | "tuned" | "split";
export type EvalTrace = {
  rounds: number; queryEmbeddingReads: number; providerCalls: number; vectorSearches: number;
  vectorHits: number; resolvedHits: number; legacyDocumentReads: number; vectorRowReads: number;
  hydratedAssets: number; hydrationCalls: number;
};
export type EvalRow = {
  query: string; plan: Plan; results: Array<{ assetId: string; score: number }>; trace: EvalTrace; error?: string;
};
export type RowSizes = {
  legacyDocument: number; identity: number; entry: number; pixelVector: number; textVector: number;
  queryEmbeddingFull: number; queryEmbeddingSplit: number; hydratedAsset: number;
};

// Fallbacks are the sizes of representative rows (agent-docs/DATABASE_IO.md)
// for tables the sample found empty.
const FALLBACK_SIZES: RowSizes = {
  legacyDocument: 56_211, identity: 329, entry: 359, pixelVector: 7_019, textVector: 7_019,
  queryEmbeddingFull: 27_890, queryEmbeddingSplit: 7_154, hydratedAsset: 3_000,
};
// Index entry read alongside each indexed lookup (key values + document ID).
const INDEX_KEY_BYTES = 70;

const sizeOf = (sizes: Partial<RowSizes>, key: keyof RowSizes) => sizes[key] || FALLBACK_SIZES[key];

export const estimateBytes = (trace: EvalTrace, plan: Plan, sizes: Partial<RowSizes>) => {
  const split = plan === "split";
  return Math.round(
    trace.queryEmbeddingReads * (sizeOf(sizes, split ? "queryEmbeddingSplit" : "queryEmbeddingFull") + INDEX_KEY_BYTES) +
    trace.resolvedHits * (sizeOf(sizes, split ? "entry" : "identity") + INDEX_KEY_BYTES) +
    trace.legacyDocumentReads * sizeOf(sizes, "legacyDocument") +
    trace.vectorRowReads * sizeOf(sizes, "pixelVector") +
    trace.hydratedAssets * sizeOf(sizes, "hydratedAsset"),
  );
};

export const overlapAt = (baseline: string[], candidate: string[], k: number) => {
  const top = baseline.slice(0, k);
  if (top.length === 0) return candidate.length === 0 ? 1 : 0;
  const found = new Set(candidate.slice(0, k));
  return top.filter((id) => found.has(id)).length / top.length;
};

export const summarizeEval = (rows: EvalRow[], sizes: Partial<RowSizes>, k = 10) => {
  const queries = [...new Set(rows.map((row) => row.query))];
  const perQuery = queries.map((query) => {
    const byPlan = new Map(rows.filter((row) => row.query === query).map((row) => [row.plan, row]));
    const baseline = byPlan.get("before")?.results.map((result) => result.assetId) ?? [];
    return {
      query,
      plans: Object.fromEntries([...byPlan].map(([plan, row]) => {
        const ids = row.results.map((result) => result.assetId);
        return [plan, {
          results: ids.length,
          top1Agrees: baseline.length === 0 ? ids.length === 0 : ids[0] === baseline[0],
          overlapAtK: overlapAt(baseline, ids, k),
          bytes: estimateBytes(row.trace, plan, sizes),
          error: row.error,
        }];
      })),
    };
  });
  const plans = [...new Set(rows.map((row) => row.plan))];
  const mean = (values: number[]) => (values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length);
  const overall = Object.fromEntries(plans.map((plan) => {
    const stats = perQuery.map((entry) => entry.plans[plan]).filter(Boolean);
    return [plan, {
      meanOverlapAtK: Number(mean(stats.map((stat) => stat!.overlapAtK)).toFixed(3)),
      top1Agreement: `${stats.filter((stat) => stat!.top1Agrees).length}/${stats.length}`,
      meanBytes: Math.round(mean(stats.map((stat) => stat!.bytes))),
      errors: stats.filter((stat) => stat!.error).length,
    }];
  }));
  return { k, perQuery, overall };
};

const USAGE = `Usage: bun scripts/semantic-search-eval.ts --owner=<ownerUserId> [--plans=before,tuned,split]
  [--limit=24] [--mode=hybrid|visual|text] [--queries=queries.txt] [--similar=assetId,assetId] [--out=report.json]`;

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(USAGE);
    return;
  }
  const ownerUserId = readFlag(args, "owner")?.trim();
  if (!ownerUserId) throw new Error(`--owner is required.\n${USAGE}`);
  const plans = (readFlag(args, "plans") ?? "before,tuned,split").split(",").map((plan) => plan.trim()) as Plan[];
  if (plans.some((plan) => !["before", "tuned", "split"].includes(plan))) throw new Error("Plans are before, tuned and split.");
  const limit = Number(readFlag(args, "limit") ?? 24);
  const mode = readFlag(args, "mode");
  const queriesFile = readFlag(args, "queries");
  const queries = queriesFile
    ? readFileSync(queriesFile, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : DEFAULT_QUERIES;
  const similarTo = readFlag(args, "similar")?.split(",").map((id) => id.trim()).filter(Boolean) ?? [];

  const client = createCanonicalAdminClient();
  const sizes = (await client.query(rowSizes, { sample: 10 })) as RowSizes;
  const rows: EvalRow[] = [];
  // One action per query keeps each call short and a failure local.
  for (const query of queries) {
    rows.push(...((await client.action(evaluate, { ownerUserId, queries: [query], plans, limit, mode })) as EvalRow[]));
  }
  if (similarTo.length > 0) {
    rows.push(...((await client.action(evaluate, { ownerUserId, queries: [], similarTo, plans, limit, mode })) as EvalRow[]));
  }
  const summary = summarizeEval(rows, sizes, Math.min(10, limit));
  for (const entry of summary.perQuery) {
    console.log(`${entry.query}\n${Object.entries(entry.plans).map(([plan, stat]) =>
      `  ${plan.padEnd(6)} results ${String(stat.results).padStart(3)}  overlap@${summary.k} ${stat.overlapAtK.toFixed(2)}  ` +
      `top1 ${stat.top1Agrees ? "same" : "DIFF"}  ~${(stat.bytes / 1024).toFixed(0)} KB${stat.error ? `  ERROR ${stat.error}` : ""}`,
    ).join("\n")}`);
  }
  console.log(JSON.stringify({ sizes, overall: summary.overall }, null, 2));
  const out = readFlag(args, "out");
  if (out) writeFileSync(out, JSON.stringify({ sizes, summary, rows }, null, 2));
}

if (import.meta.main) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Semantic search eval failed.");
  process.exitCode = 1;
});
