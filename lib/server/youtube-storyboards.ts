import { unstable_cache } from "next/cache";
import { isYouTubeVideoId, storyboardsFromWatchPage } from "@/lib/youtube-storyboards";

// Only public player metadata is cached. Request cookies, gallery records and
// private research notes never enter this cache. Fetch happens on card hover.
export const loadYouTubeStoryboards = unstable_cache(async (id: string) => {
  if (!isYouTubeVideoId(id)) return [];
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9" },
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!response.ok) return [];
    return storyboardsFromWatchPage(await response.text());
  } catch {
    // Removed/restricted videos or YouTube network blocks keep the card cover.
    return [];
  }
}, ["youtube-public-storyboards-v1"], { revalidate: 60 * 60 });
