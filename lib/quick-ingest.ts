// One dropped file → one saved asset, with no form in between.
//
// The upload panels ask for prompt, model, destinations and taxonomy before
// they save. A drop onto an already-open collection has already answered the
// only questions that matter — where it goes and what it IS — so this path
// takes the file, the destination folder and the type tag, and does the same
// three-branch upload the panels do: video and large images travel
// browser → R2 and the ingest only carries the key; small images ride along as
// bytes.

import { buildUploadFormData } from "@/lib/upload-form";
import {
  LARGE_IMAGE_BYTES,
  appendImageUploadFields,
  uploadImageToR2,
} from "@/lib/image-ingest";
import { uploadVideoToR2 } from "@/lib/video-ingest";
import { resolveMedia } from "@/lib/bulk-upload";

export type QuickIngestOptions = {
  file: File;
  /** Collection the asset lands in. Omitted = uncategorized. */
  folderId?: string;
  /** Tags stamped on the asset — for a bucket drop, its type tag. */
  tags?: string[];
  /** useUploadFile(api.r2) from the calling component. */
  uploadToR2: (file: File) => Promise<string>;
};

export type QuickIngestResult = {
  assetId: string;
  /** These bytes were already in the vault; the drop filed onto the original. */
  duplicate: boolean;
};

export async function quickIngestFile({
  file,
  folderId,
  tags,
  uploadToR2,
}: QuickIngestOptions): Promise<QuickIngestResult> {
  const media = resolveMedia(file.name, file.type);
  if (!media) throw new Error(`${file.name} isn't an image or a video.`);

  const isVideo = media.kind === "video";
  const isLargeImage = !isVideo && file.size > LARGE_IMAGE_BYTES;
  const viaR2 = isVideo || isLargeImage;

  // The R2 helpers gate on file.type, and a drop can hand over a file the OS
  // never typed (some .mov / .webp sources arrive with an empty type). The
  // extension already answered the question, so re-type the blob.
  const typedFile =
    file.type === media.contentType
      ? file
      : new File([file], file.name, { type: media.contentType });

  const formData = buildUploadFormData({
    promptText: "",
    folderId,
    tags,
    file: viaR2 ? null : typedFile,
    generationType: isVideo ? "video_gen" : "image_gen",
  });

  // A quick drop carries no prompt, so the auto ingestKey would be the file
  // name alone — and "1.png" collides across every folder anyone ever drops.
  // An ingestKey hit returns the older asset WITHOUT merging the new tags,
  // which would silently swallow the bucket choice. Content-hash dedupe is
  // the honest check here, and it does merge tags and folders.
  formData.delete("ingestKey");
  formData.delete("promptIngestKey");

  if (isVideo) {
    const upload = await uploadVideoToR2(typedFile, { uploadVideo: uploadToR2 });
    formData.append("r2Key", upload.r2Key);
    if (upload.contentHash) {
      formData.append("mediaContentHash", upload.contentHash);
    }
    formData.append("mediaContentType", upload.contentType);
    formData.append("mediaSize", String(upload.size));
    formData.append("mediaWidth", String(upload.poster.width));
    formData.append("mediaHeight", String(upload.poster.height));
    formData.append("mediaFileName", upload.fileName);
    formData.append(
      "posterFile",
      new File([upload.poster.blob], `${upload.fileName}.poster.jpg`, {
        type: upload.poster.blob.type || "image/jpeg",
      }),
    );
    formData.append("posterWidth", String(upload.poster.width));
    formData.append("posterHeight", String(upload.poster.height));
  } else if (isLargeImage) {
    const upload = await uploadImageToR2(typedFile, { upload: uploadToR2 });
    appendImageUploadFields(formData, upload);
  }

  const response = await fetch("/api/ingest", { method: "POST", body: formData });
  const body = (await response.json().catch(() => null)) as
    | { error?: string; result?: { assetId?: string; duplicateMedia?: boolean } }
    | null;
  if (!response.ok) {
    throw new Error(
      typeof body?.error === "string" ? body.error : "Ingest failed.",
    );
  }
  const assetId = body?.result?.assetId;
  if (!assetId) throw new Error("Ingest returned no asset.");
  return { assetId, duplicate: Boolean(body?.result?.duplicateMedia) };
}
