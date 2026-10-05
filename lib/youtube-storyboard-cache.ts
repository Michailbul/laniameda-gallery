import { isYouTubeVideoId, sampleYouTubeStoryboard, type YouTubeStoryboardFrame } from "./youtube-storyboards";

export const STORYBOARD_CACHE_BASE = "https://pub-ad6ed85f12d147539181afa324bead00.r2.dev";
export const storyboardCacheKey = (id: string) => `youtube-storyboards/v1/${id}.json`;

export function readStoryboardCache(value: unknown, id: string): YouTubeStoryboardFrame[] {
  if (!isYouTubeVideoId(id) || !value || typeof value !== "object") return [];
  const data = value as Record<string, unknown>;
  if (data.v !== 1 || data.videoId !== id || typeof data.fetchedAt !== "string" ||
      !Number.isFinite(Date.parse(data.fetchedAt)) || typeof data.durationSeconds !== "number" ||
      !Number.isFinite(data.durationSeconds) || data.durationSeconds <= 0) return [];
  const frames = typeof data.spec === "string" ? sampleYouTubeStoryboard(data.spec, data.durationSeconds) : data.frames;
  if (!Array.isArray(frames) || !frames.length || frames.length > 24) return [];
  let previous = -1;
  const seen = new Set<string>();
  for (const value of frames) {
    if (!value || typeof value !== "object") return [];
    const frame = value as YouTubeStoryboardFrame;
    try {
      const url = new URL(frame.url);
      if (url.protocol !== "https:" || url.hostname !== "i.ytimg.com" || url.port ||
          url.username || url.password || !url.pathname.startsWith(`/sb/${id}/`)) return [];
    } catch { return []; }
    for (const number of [frame.width, frame.height, frame.columns, frame.rows]) {
      if (!Number.isSafeInteger(number) || number <= 0 || number > 4096) return [];
    }
    if (!Number.isSafeInteger(frame.column) || frame.column < 0 || frame.column >= frame.columns ||
        !Number.isSafeInteger(frame.row) || frame.row < 0 || frame.row >= frame.rows ||
        !Number.isFinite(frame.timeSeconds) || frame.timeSeconds < 0 || frame.timeSeconds > data.durationSeconds ||
        frame.timeSeconds <= previous) return [];
    const tile = `${frame.url}:${frame.column}:${frame.row}`;
    if (seen.has(tile)) return [];
    seen.add(tile); previous = frame.timeSeconds;
  }
  return frames.map(({url,width,height,columns,rows,column,row,timeSeconds}) =>
    ({url,width,height,columns,rows,column,row,timeSeconds}));
}
