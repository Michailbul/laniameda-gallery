export const VIDEO_SCRUB_FRAME_COUNT = 24;
export const VIDEO_SCRUB_INTERVAL_MS = 100;

export function videoScrubTime(progress: number, duration: number): number | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const fraction = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const frame = Math.round(fraction * (VIDEO_SCRUB_FRAME_COUNT - 1));
  const end = duration - Math.min(0.05, duration / 2);
  return Math.max(Math.min(0.001, end), frame / (VIDEO_SCRUB_FRAME_COUNT - 1) * end);
}

type ScrubVideo = Pick<HTMLVideoElement, "duration" | "currentTime" | "readyState" | "seeking">;
type Scheduler = {
  now: () => number;
  schedule: (callback: () => void, delay: number) => unknown;
  cancel: (timer: unknown) => void;
};

/** Coalesce pointer movement, throttle decoding, and wait for the current seek. */
export function createVideoScrubber(video: ScrubVideo, clock: Scheduler = {
  now: () => performance.now(),
  schedule: (callback, delay) => setTimeout(callback, delay),
  cancel: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
}) {
  let progress = 0;
  let lastSeek = -Infinity;
  let timer: unknown = null;
  let disposed = false;

  const flush = () => {
    timer = null;
    if (disposed || video.readyState < 1 || video.seeking) return;
    const time = videoScrubTime(progress, video.duration);
    if (time === null || Math.abs(video.currentTime - time) < 0.001) return;
    const delay = VIDEO_SCRUB_INTERVAL_MS - (clock.now() - lastSeek);
    if (delay > 0) {
      timer = clock.schedule(flush, delay);
      return;
    }
    try {
      video.currentTime = time;
      lastSeek = clock.now();
    } catch {
      // An unavailable or changed source keeps its poster; never autoplay it.
    }
  };

  return {
    seek(nextProgress: number) {
      progress = nextProgress;
      if (timer === null) flush();
    },
    flush,
    dispose() {
      disposed = true;
      if (timer !== null) clock.cancel(timer);
      timer = null;
    },
  };
}
