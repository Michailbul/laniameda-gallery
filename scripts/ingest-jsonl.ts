import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { readFile } from "node:fs/promises";

const convexUrl = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  console.error("Missing CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL)");
  process.exit(1);
}

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: bun scripts/ingest-jsonl.ts <path-to-jsonl>");
  process.exit(1);
}

const main = async () => {
  const content = await readFile(filePath, "utf8");
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const client = new ConvexHttpClient(convexUrl);

  let ok = 0;
  let failed = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    try {
      const args = JSON.parse(line);
      const res = await client.action(api.ingest.ingestFromApi, args);
      ok++;
      console.log(`[${i + 1}/${lines.length}] ok`, res);
    } catch (err: any) {
      failed++;
      console.error(`[${i + 1}/${lines.length}] failed`, err?.message ?? err);
    }
  }

  console.log(`Done. ok=${ok} failed=${failed}`);
  if (failed > 0) process.exit(2);
};

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
