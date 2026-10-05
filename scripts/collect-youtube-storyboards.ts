/** Collect public preview metadata for a saved shortlist, without media downloads.
 * bun scripts/collect-youtube-storyboards.ts --ids ids.json --output snapshots.json
 * Sequential requests stop on HTTP429; existing good snapshots are preserved.
 */
import { isYouTubeVideoId, parseYouTubePlayer } from "../lib/youtube-storyboards";
import { readStoryboardCache } from "../lib/youtube-storyboard-cache";

const option = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const input = option("--ids"), output = option("--output");
if (!input || !output) throw new Error("Pass --ids and --output.");
const ids: unknown = await Bun.file(input).json();
if (!Array.isArray(ids) || ids.length > 50 || ids.some(id => typeof id !== "string" || !isYouTubeVideoId(id)))
  throw new Error("Pass up to50 saved YouTube IDs, as a JSON array.");
type Snapshot = { spec: string; durationSeconds: number; checkedAt: string };
const snapshots: Record<string, Snapshot> = await Bun.file(output).exists() ? await Bun.file(output).json() : {};
let collected = 0, unavailable = 0, rateLimited = false;
for (const id of [...new Set(ids)] as string[]) {
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 429) { rateLimited = true; break; }
    if (!response.ok) { unavailable++; continue; }
    const player = parseYouTubePlayer(await response.text());
    const boards = player?.storyboards as { playerStoryboardSpecRenderer?: { spec?: string } } | undefined;
    const details = player?.videoDetails as { lengthSeconds?: string } | undefined;
    const snapshot = { spec: boards?.playerStoryboardSpecRenderer?.spec ?? "",
      durationSeconds: Number(details?.lengthSeconds), checkedAt: new Date().toISOString() };
    if (!readStoryboardCache({ v: 1, videoId: id, fetchedAt: snapshot.checkedAt, ...snapshot }, id).length) {
      unavailable++; continue;
    }
    snapshots[id] = snapshot;
    await Bun.write(output, JSON.stringify(snapshots));
    collected++;
  } catch { unavailable++; }
}
console.log(JSON.stringify({ collected, unavailable, rateLimited, action: rateLimited ? "Back off; retain existing previews." : "Complete" }));
