import { unstable_cache } from "next/cache";
import { isYouTubeVideoId, storyboardsFromWatchPage } from "@/lib/youtube-storyboards";
import { readStoryboardCache, STORYBOARD_CACHE_BASE, storyboardCacheKey } from "@/lib/youtube-storyboard-cache";

// Public preview metadata only. The route checks current auth and membership
// before calling this loader. Missing/invalid caches throw so empty results do
// not hide a sequence published by research after an earlier failed request.
const persistedFrames = unstable_cache(async (id: string) => {
  const base = process.env.YOUTUBE_STORYBOARD_CACHE_BASE_URL || STORYBOARD_CACHE_BASE;
  const response = await fetch(`${base.replace(/\/$/, "")}/${storyboardCacheKey(id)}`, {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Preview cache unavailable");
  const text = await response.text();
  if (text.length > 256_000) throw new Error("Invalid preview cache");
  const frames = readStoryboardCache(JSON.parse(text), id);
  if (!frames.length) throw new Error("Invalid preview cache");
  return frames;
}, ["youtube-persisted-storyboards-v1"], { revalidate: 300 });

const watchFrames = unstable_cache(async (id: string) => {
  const response = await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9" },
    redirect: "error", signal: AbortSignal.timeout(12_000), cache: "no-store",
  });
  if (!response.ok) throw new Error("YouTube preview unavailable");
  const frames = storyboardsFromWatchPage(await response.text());
  if (!frames.length) throw new Error("YouTube preview unavailable");
  return frames;
}, ["youtube-public-storyboards-v2"], { revalidate: 60 * 60 });

export async function loadYouTubeStoryboards(id: string) {
  if (!isYouTubeVideoId(id)) return [];
  const saved = await persistedFrames(id).catch(() => []);
  if (saved.length) return saved;
  return watchFrames(id).catch(() => []);
}
