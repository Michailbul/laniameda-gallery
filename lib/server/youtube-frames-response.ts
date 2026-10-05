import { isYouTubeVideoId, type YouTubeStoryboardFrame } from "@/lib/youtube-storyboards";

type FrameDependencies = {
  loadVideos: () => Promise<{ externalId: string }[] | null>;
  loadFrames: (id: string) => Promise<YouTubeStoryboardFrame[]>;
};

/** Authorize against the current page access and saved membership before fetching. */
export async function youTubeFramesResponse(id: string, dependencies: FrameDependencies): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store" };
  if (!isYouTubeVideoId(id)) return Response.json({ frames: [] }, { status: 400, headers });
  const videos = await dependencies.loadVideos();
  if (videos === null) return Response.json({ frames: [] }, { status: 401, headers });
  if (!videos.some((video) => video.externalId === id)) return Response.json({ frames: [] }, { status: 404, headers });
  const frames = await dependencies.loadFrames(id).catch(() => []);
  return Response.json({ frames }, { headers });
}
