// Gives every video tile a sharp poster, so the grid stops mounting the full
// video just to paint a first frame. Convex has no frame decoder, so the frame
// is pulled here with ffmpeg and handed to thumbnails:attachVideoPoster, which
// encodes and files it like any other card thumb.
//
//   CONVEX_DEPLOYMENT=dev:perfect-buffalo-375 bun scripts/backfill-video-posters.ts [--dry-run]
//
// Needs ffmpeg and ffprobe on PATH and a logged-in Convex CLI.

import { spawnSync } from "node:child_process";

type Candidate = { assetId: string; url: string | null };

const dryRun = process.argv.includes("--dry-run");

if (!process.env.CONVEX_DEPLOYMENT) {
  console.error("Pin the deployment: CONVEX_DEPLOYMENT=dev:<name> bun scripts/backfill-video-posters.ts");
  process.exit(1);
}

const runConvex = <T>(fn: string, args: Record<string, unknown>): T => {
  const result = spawnSync("bunx", ["convex", "run", fn, JSON.stringify(args)], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`convex run ${fn} failed:\n${result.stderr}`);
  }
  return JSON.parse(result.stdout) as T;
};

/** Display dimensions: coded size, swapped when the stream is rotated. */
const probeDimensions = (url: string) => {
  const result = spawnSync(
    "ffprobe",
    [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height:stream_side_data=rotation",
      "-of", "json",
      url,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) return undefined;
  const stream = JSON.parse(result.stdout).streams?.[0] as
    | { width?: number; height?: number; side_data_list?: Array<{ rotation?: number }> }
    | undefined;
  if (!stream?.width || !stream.height) return undefined;
  const rotation = Math.abs(stream.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0);
  return rotation === 90 || rotation === 270
    ? { width: stream.height, height: stream.width }
    : { width: stream.width, height: stream.height };
};

/** A JPEG of the most typical of the opening 48 frames, fit to the card box.
 *  The very first frame of a fade-in is black. */
const grabFrame = (url: string) => {
  const result = spawnSync(
    "ffmpeg",
    [
      "-v", "error",
      "-i", url,
      "-frames:v", "1",
      // min() keeps a frame smaller than the box at its own size.
      "-vf", "thumbnail=48,scale=w='min(1440,iw)':h='min(960,ih)':force_original_aspect_ratio=decrease",
      "-q:v", "3",
      "-f", "image2",
      "-c:v", "mjpeg",
      "pipe:1",
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0 || !result.stdout?.length) {
    throw new Error(`ffmpeg could not read a frame: ${result.stderr?.toString().trim()}`);
  }
  return result.stdout as Buffer;
};

const candidates = runConvex<Candidate[]>("thumbnailBackfill:listVideosNeedingPoster", {});
console.log(`${candidates.length} video(s) without a sharp poster.`);

let attached = 0;
let failed = 0;
for (const { assetId, url } of candidates) {
  if (!url) {
    console.warn(`${assetId}: no playable URL, skipped.`);
    failed += 1;
    continue;
  }
  try {
    const dimensions = probeDimensions(url);
    const frame = grabFrame(url);
    if (dryRun) {
      console.log(`${assetId}: frame ${Math.round(frame.byteLength / 1000)} KB, video ${dimensions?.width}x${dimensions?.height}`);
      continue;
    }
    const thumb = runConvex<{ thumbWidth: number; thumbHeight: number; thumbSize: number }>(
      "thumbnails:attachVideoPoster",
      {
        assetId,
        frameBase64: frame.toString("base64"),
        videoWidth: dimensions?.width,
        videoHeight: dimensions?.height,
      },
    );
    attached += 1;
    console.log(`${assetId}: poster ${thumb.thumbWidth}x${thumb.thumbHeight}, ${Math.round(thumb.thumbSize / 1000)} KB`);
  } catch (error) {
    failed += 1;
    console.warn(`${assetId}: ${error instanceof Error ? error.message : error}`);
  }
}

console.log(dryRun ? "Dry run done." : `Done: ${attached} poster(s) attached, ${failed} failed.`);
