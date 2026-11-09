import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

// How much of the gallery is searchable: every asset counted against its
// search document, picture vector and text vector. Read-only.
// CONVEX_URL=… CONVEX_DEPLOY_KEY=… bun scripts/semantic-coverage.ts

const coverageBatch = makeFunctionReference<"query">("semanticIndex:semanticCoverageBatch");

type Batch = {
  assets: number; images: number; videos: number; withDocument: number; withVisual: number; withText: number;
  missingSample: string[]; imagesWithoutVisual: string[]; nextCursor?: string; done: boolean;
};

const main = async () => {
  const url = process.env.CONVEX_URL?.trim() || process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  const key = process.env.CONVEX_ADMIN_KEY?.trim() || process.env.CONVEX_DEPLOY_KEY?.trim();
  if (!url || !key) throw new Error("CONVEX_URL and CONVEX_DEPLOY_KEY (or CONVEX_ADMIN_KEY) are required.");
  const client = new ConvexHttpClient(url);
  (client as ConvexHttpClient & { setAdminAuth: (token: string) => void }).setAdminAuth(key);
  const total = { assets: 0, images: 0, videos: 0, withDocument: 0, withVisual: 0, withText: 0 };
  const missing: string[] = [];
  const noVisual: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const batch = (await client.query(coverageBatch as never, (cursor ? { cursor } : {}) as never)) as Batch;
    for (const key of Object.keys(total) as Array<keyof typeof total>) total[key] += batch[key];
    noVisual.push(...batch.imagesWithoutVisual);
    if (missing.length < 20) missing.push(...batch.missingSample.slice(0, 20 - missing.length));
    if (batch.done) break;
    if (!batch.nextCursor || batch.nextCursor === cursor) throw new Error("Coverage returned a non-advancing cursor.");
    cursor = batch.nextCursor;
  }
  const pct = (n: number) => `${total.assets ? ((n / total.assets) * 100).toFixed(1) : "0"}%`;
  // --ids prints the assets to reindex (missing documents, images without a picture vector).
  if (process.argv.includes("--ids")) {
    console.log([...missing, ...noVisual].join("\n"));
    return;
  }
  console.log(JSON.stringify({ ...total, imagesWithoutVisual: noVisual.length, documentPct: pct(total.withDocument), visualPct: pct(total.withVisual), textPct: pct(total.withText), missingSample: missing }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
