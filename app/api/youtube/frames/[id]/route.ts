import { loadYouTubeVideos } from "@/lib/server/youtube-access";
import { youTubeFramesResponse } from "@/lib/server/youtube-frames-response";
import { loadYouTubeStoryboards } from "@/lib/server/youtube-storyboards";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return youTubeFramesResponse(id, { loadVideos: loadYouTubeVideos, loadFrames: loadYouTubeStoryboards });
}
