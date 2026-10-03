import { YouTubeBrowser } from "@/components/youtube/youtube-browser";
import { YouTubeGate } from "@/components/youtube/youtube-gate";
import { loadYouTubeVideos } from "@/lib/server/youtube-access";
import { parseFilters } from "@/lib/youtube-page";

export const dynamic = "force-dynamic";

export default async function YouTubePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const videos = await loadYouTubeVideos();
  if (!videos) return <YouTubeGate />;
  const params = await searchParams;
  const themes = [...new Set(videos.flatMap((video) => video.collections))];
  return <YouTubeBrowser videos={videos} initialFilters={parseFilters(params, themes)} />;
}
