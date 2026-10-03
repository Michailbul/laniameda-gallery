import Link from "next/link";
import { YouTubeGate } from "@/components/youtube/youtube-gate";
import { YouTubeVideoPage } from "@/components/youtube/youtube-video";
import { loadYouTubeVideos } from "@/lib/server/youtube-access";
import { YOUTUBE_PATH } from "@/lib/youtube-page";

export const dynamic = "force-dynamic";

export default async function YouTubeVideoRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const videos = await loadYouTubeVideos();
  if (!videos) return <YouTubeGate />;
  const video = videos.find((entry) => entry.externalId === id);
  if (!video) {
    return (
      <main className="yt-empty">
        <h1 className="yt-title">Video not found</h1>
        <p>This link points at a video that is not in the collection.</p>
        <Link className="yt-button" href={YOUTUBE_PATH}>
          Back to YouTube
        </Link>
      </main>
    );
  }
  return <YouTubeVideoPage video={video} videos={videos} />;
}
