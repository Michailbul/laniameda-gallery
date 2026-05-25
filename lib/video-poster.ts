// Client-only utility. Captures a still frame from a video File and
// returns it as a JPEG Blob suitable for Convex _storage. Used at
// upload time so video gallery cards can render a poster without
// streaming the actual video file.

export type PosterResult = {
  blob: Blob;
  width: number;
  height: number;
  durationSec?: number;
};

export type ExtractVideoPosterOptions = {
  maxEdge?: number; // longest edge in pixels (default 320)
  seekSeconds?: number; // where in the video to grab (default 0.1)
  quality?: number; // 0..1 JPEG quality (default 0.66)
  timeoutMs?: number; // give up after this long (default 10000)
};

const fitWithin = (
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } => {
  if (width <= maxEdge && height <= maxEdge) {
    return { width, height };
  }
  const scale = maxEdge / Math.max(width, height);
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
};

export async function extractVideoPoster(
  file: File,
  opts: ExtractVideoPosterOptions = {},
): Promise<PosterResult> {
  if (typeof window === "undefined") {
    throw new Error("extractVideoPoster must run in the browser.");
  }
  const {
    maxEdge = 320,
    seekSeconds = 0.1,
    quality = 0.66,
    timeoutMs = 10000,
  } = opts;

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.src = objectUrl;
  // Off-DOM: most browsers still decode metadata, and skipping the
  // append avoids layout flicker.

  const cleanup = () => {
    URL.revokeObjectURL(objectUrl);
    video.removeAttribute("src");
    try {
      video.load();
    } catch {
      // best-effort
    }
  };

  return new Promise<PosterResult>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Video poster extraction timed out."));
    }, timeoutMs);

    const fail = (error: unknown) => {
      window.clearTimeout(timer);
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    video.addEventListener("error", () => fail("Video element failed to load."));

    video.addEventListener("loadedmetadata", () => {
      const target = Math.min(
        Math.max(seekSeconds, 0),
        Math.max(0, video.duration - 0.05),
      );
      try {
        video.currentTime = target;
      } catch (error) {
        fail(error);
      }
    });

    video.addEventListener("seeked", () => {
      try {
        const naturalWidth = video.videoWidth;
        const naturalHeight = video.videoHeight;
        if (!naturalWidth || !naturalHeight) {
          fail(new Error("Video has no decodable frame."));
          return;
        }
        const { width, height } = fitWithin(
          naturalWidth,
          naturalHeight,
          maxEdge,
        );
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          fail(new Error("2D canvas context unavailable."));
          return;
        }
        ctx.drawImage(video, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              fail(new Error("Canvas toBlob returned null."));
              return;
            }
            window.clearTimeout(timer);
            cleanup();
            resolve({
              blob,
              width,
              height,
              durationSec: Number.isFinite(video.duration)
                ? video.duration
                : undefined,
            });
          },
          "image/jpeg",
          quality,
        );
      } catch (error) {
        fail(error);
      }
    });
  });
}
