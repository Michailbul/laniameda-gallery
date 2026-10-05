/** Publish public seek-preview metadata; never store research rows or credentials.
 * bun scripts/cache-youtube-storyboards.ts --snapshots <json> [--deployment <name>]
 * The input is keyed by saved YouTube IDs: {spec?,frames?,durationSeconds,checkedAt}.
 * Capture snapshots with bounded watch requests; stop/back off on the first429.
 */
import { readStoryboardCache, STORYBOARD_CACHE_BASE, storyboardCacheKey } from "../lib/youtube-storyboard-cache";

const option = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const path = option("--snapshots");
if (!path) throw new Error("Pass --snapshots with verified public frame metadata.");
const snapshots = await Bun.file(path).json() as Record<string, {
  spec?: string; frames?: unknown[]; durationSeconds: number; checkedAt: string;
}>;
let config = process.env as Record<string, string | undefined>;
if (!config.R2_ACCESS_KEY_ID || !config.R2_SECRET_ACCESS_KEY || !config.R2_BUCKET || !config.R2_ENDPOINT) {
  const deployment = option("--deployment");
  if (!deployment) throw new Error("Set existing R2 envs or pass the existing Convex --deployment.");
  // Capture in memory only. Never print env output, stderr, signed URLs or keys.
  const cli = Bun.spawn(["node", "node_modules/convex/bin/main.js", "env", "list", "--deployment", deployment],
    { stdout: "pipe", stderr: "pipe" });
  const [output, code] = await Promise.all([new Response(cli.stdout).text(), cli.exited]);
  if (code !== 0) throw new Error(`Could not read existing storage configuration (exit ${code}).`);
  config = { ...config };
  for (const line of output.split("\n")) {
    const match = line.match(/^(R2_[A-Z_]+)=(.*)$/);
    if (match) config[match[1]] = match[2].trim();
  }
}
if (!config.R2_ACCESS_KEY_ID || !config.R2_SECRET_ACCESS_KEY || !config.R2_BUCKET || !config.R2_ENDPOINT)
  throw new Error("Existing R2 storage configuration is incomplete.");
const bucket = new Bun.S3Client({ accessKeyId: config.R2_ACCESS_KEY_ID, secretAccessKey: config.R2_SECRET_ACCESS_KEY,
  bucket: config.R2_BUCKET, endpoint: config.R2_ENDPOINT, region: "auto" });
const base = config.R2_PUBLIC_BASE_URL || STORYBOARD_CACHE_BASE;
let written = 0;
for (const [videoId, snapshot] of Object.entries(snapshots)) {
  const value = { v: 1, videoId, fetchedAt: snapshot.checkedAt, durationSeconds: snapshot.durationSeconds,
    ...(snapshot.spec ? { spec: snapshot.spec } : { frames: snapshot.frames }) };
  const frames = readStoryboardCache(value, videoId);
  if (!frames.length) throw new Error(`Invalid public preview snapshot: ${videoId}`);
  try {
    await bucket.write(storyboardCacheKey(videoId), JSON.stringify(value), { type: "application/json" });
  } catch { throw new Error(`Public preview upload failed: ${videoId}`); }
  written++;
  if (written % 50 === 0) console.log(JSON.stringify({ written }));
}
// Read back representative files, including the requested inspiration if present.
const ids = Object.keys(snapshots);
const samples = [...new Set([ids[0], ids.at(-1), ...(snapshots["504koqyhKoo"] ? ["504koqyhKoo"] : [])])].filter(Boolean) as string[];
for (const id of samples) {
  const response = await fetch(`${base.replace(/\/$/, "")}/${storyboardCacheKey(id)}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok || !readStoryboardCache(await response.json(), id).length)
    throw new Error(`Preview cache readback failed: ${id}`);
}
console.log(JSON.stringify({ written, readback: samples.length }));
