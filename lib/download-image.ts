export async function downloadImage(url: string, filename?: string) {
  const name = filename ?? url.split("/").pop() ?? "image";
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("fetch failed");
    const blob = await res.blob();
    triggerBlobDownload(blob, name);
    return true;
  } catch {
    // CORS fallback — open in new tab
    window.open(url, "_blank");
    return false;
  }
}

function triggerBlobDownload(blob: Blob, name: string) {
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}

const stripExtension = (name: string) => name.replace(/\.[^./\\]+$/, "");

// Re-encode an image blob to JPEG via canvas. Transparency is flattened onto a
// white background since JPEG has no alpha channel.
async function blobToJpeg(blob: Blob, quality = 0.92): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!out) throw new Error("JPEG encoding failed.");
    return out;
  } finally {
    bitmap.close();
  }
}

/**
 * One-click download of a single asset. Images are re-encoded to JPEG (matching
 * the bulk export); non-images (video) download as their original bytes. Falls
 * back to opening the URL in a new tab when the fetch is blocked by CORS.
 */
export async function downloadAssetFile({
  url,
  baseName,
  isImage,
}: {
  url: string;
  baseName: string;
  isImage?: boolean;
}): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("fetch failed");
    const raw = await res.blob();
    const treatAsImage = isImage ?? raw.type.startsWith("image/");
    if (treatAsImage) {
      const jpeg = await blobToJpeg(raw);
      triggerBlobDownload(jpeg, `${stripExtension(baseName)}.jpg`);
    } else {
      triggerBlobDownload(raw, baseName);
    }
    return true;
  } catch {
    window.open(url, "_blank");
    return false;
  }
}

export type ZipDownloadItem = {
  /** Source URL to fetch the bytes from. */
  url: string;
  /** Base file name (extension is replaced with .jpg for images). */
  name: string;
  /** When false (e.g. video), bytes are stored as-is without JPEG conversion. */
  isImage?: boolean;
};

export type ZipDownloadResult = {
  zipped: number;
  failed: number;
};

/**
 * Fetch every item, convert images to JPEG, and deliver them as a single .zip.
 * Returns counts so the caller can surface a status. Throws only if nothing
 * could be fetched (so the caller can show a hard error).
 */
export async function downloadImagesAsZip(
  items: ZipDownloadItem[],
  zipFileName = "laniameda-gallery.zip",
): Promise<ZipDownloadResult> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();

  let zipped = 0;
  let failed = 0;
  const usedNames = new Set<string>();

  const uniqueName = (base: string) => {
    let candidate = base;
    let counter = 1;
    while (usedNames.has(candidate)) {
      const dot = base.lastIndexOf(".");
      candidate =
        dot > 0
          ? `${base.slice(0, dot)}-${counter}${base.slice(dot)}`
          : `${base}-${counter}`;
      counter += 1;
    }
    usedNames.add(candidate);
    return candidate;
  };

  for (const item of items) {
    try {
      const res = await fetch(item.url);
      if (!res.ok) throw new Error(`fetch failed (${res.status})`);
      const raw = await res.blob();
      const isImage = item.isImage ?? raw.type.startsWith("image/");
      if (isImage) {
        const jpeg = await blobToJpeg(raw);
        zip.file(uniqueName(`${stripExtension(item.name)}.jpg`), jpeg);
      } else {
        zip.file(uniqueName(item.name), raw);
      }
      zipped += 1;
    } catch {
      failed += 1;
    }
  }

  if (zipped === 0) {
    throw new Error("Could not fetch any of the selected files.");
  }

  const archive = await zip.generateAsync({ type: "blob" });
  triggerBlobDownload(archive, zipFileName);
  return { zipped, failed };
}
