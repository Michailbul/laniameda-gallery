// Browser-side helper for LARGE image uploads. /api/ingest ships image bytes
// as base64 inside a Convex Node action call, and Convex caps action
// ARGUMENTS at 5 MiB — so any image past ~3.7 MB raw fails with "Node actions
// arguments size is too large". Mirror the video flow instead: bytes go
// browser → R2 directly (useUploadFile), and the ingest request only carries
// the r2Key, dimensions, and a small client-rendered thumbnail.

export const LARGE_IMAGE_BYTES = 3 * 1024 * 1024; // base64 ≈ 4 MiB < 5 MiB cap

const THUMB_MAX_EDGE = 1024; // matches the server-side Jimp thumb target
const THUMB_QUALITY = 0.85;

export type ImageThumbResult = {
  blob: Blob;
  width: number;
  height: number;
};

export type ImageUploadResult = {
  r2Key: string;
  contentType: string;
  size: number;
  fileName: string;
  /** Intrinsic dimensions — the masonry needs them, since the server never
   * decodes r2Key'd bytes. Undefined when the browser can't decode the
   * format (the tile then falls back to a square slot). */
  width?: number;
  height?: number;
  /** Downscaled JPEG for gallery cards; null when decoding failed. */
  thumb: ImageThumbResult | null;
};

export type UploadImageToR2Options = {
  upload: (file: File) => Promise<string>; // useUploadFile from @convex-dev/r2/react
};

const decodeAndThumb = async (
  file: File,
): Promise<{ width: number; height: number; thumb: ImageThumbResult | null }> => {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = bitmap;
    const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(width, height));
    const thumbWidth = Math.max(1, Math.round(width * scale));
    const thumbHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = thumbWidth;
    canvas.height = thumbHeight;
    const context = canvas.getContext("2d");
    if (!context) return { width, height, thumb: null };
    context.drawImage(bitmap, 0, 0, thumbWidth, thumbHeight);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", THUMB_QUALITY),
    );
    return {
      width,
      height,
      thumb: blob ? { blob, width: thumbWidth, height: thumbHeight } : null,
    };
  } finally {
    bitmap.close();
  }
};

export async function uploadImageToR2(
  file: File,
  { upload }: UploadImageToR2Options,
): Promise<ImageUploadResult> {
  if (!file.type.startsWith("image/")) {
    throw new Error("uploadImageToR2 only accepts image files.");
  }

  // Decode failures (exotic formats) still upload — just without dims/thumb.
  let decoded: Awaited<ReturnType<typeof decodeAndThumb>> | null = null;
  try {
    decoded = await decodeAndThumb(file);
  } catch {
    decoded = null;
  }

  const r2Key = await upload(file);

  return {
    r2Key,
    contentType: file.type || "image/jpeg",
    size: file.size,
    fileName: file.name,
    width: decoded?.width,
    height: decoded?.height,
    thumb: decoded?.thumb ?? null,
  };
}

/**
 * Append the r2Key ingest fields for a large image to an /api/ingest form —
 * the exact contract the video path uses, so the ingest action creates the
 * asset from the R2 bytes without ever seeing them.
 */
export function appendImageUploadFields(
  formData: FormData,
  upload: ImageUploadResult,
) {
  formData.append("r2Key", upload.r2Key);
  formData.append("mediaContentType", upload.contentType);
  formData.append("mediaSize", String(upload.size));
  if (upload.width) formData.append("mediaWidth", String(upload.width));
  if (upload.height) formData.append("mediaHeight", String(upload.height));
  formData.append("mediaFileName", upload.fileName);
  if (upload.thumb) {
    formData.append(
      "posterFile",
      new File([upload.thumb.blob], `${upload.fileName}.thumb.jpg`, {
        type: "image/jpeg",
      }),
    );
    formData.append("posterWidth", String(upload.thumb.width));
    formData.append("posterHeight", String(upload.thumb.height));
  }
}
