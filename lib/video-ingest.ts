// Browser-side helper that orchestrates a video upload:
//   1. Extract a poster JPEG from the video file (client-side canvas).
//   2. Upload the video bytes directly to Cloudflare R2 via the
//      @convex-dev/r2 useUploadFile hook (no Vercel involvement).
//   3. Caller follows up with /api/ingest, passing r2Key + the poster
//      blob so the asset row gets created.
//
// Both the Seedance modal and the generic upload panel share this so
// the video flow lives in one place.

import { extractVideoPoster, type PosterResult } from "@/lib/video-poster";

export type VideoUploadResult = {
  r2Key: string;
  poster: PosterResult;
  contentType: string;
  size: number;
  fileName: string;
};

export type UploadVideoToR2Options = {
  uploadVideo: (file: File) => Promise<string>; // useUploadFile from @convex-dev/r2/react
  onStage?: (stage: "poster" | "uploading" | "done") => void;
};

export async function uploadVideoToR2(
  file: File,
  { uploadVideo, onStage }: UploadVideoToR2Options,
): Promise<VideoUploadResult> {
  if (!file.type.startsWith("video/")) {
    throw new Error("uploadVideoToR2 only accepts video files.");
  }

  onStage?.("poster");
  const poster = await extractVideoPoster(file);

  onStage?.("uploading");
  const r2Key = await uploadVideo(file);

  onStage?.("done");
  return {
    r2Key,
    poster,
    contentType: file.type,
    size: file.size,
    fileName: file.name,
  };
}
