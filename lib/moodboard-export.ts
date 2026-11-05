import { assetDownloadHref } from "./download-image";

// "Download images" for a moodboard: every image fetched through the
// same-origin download route (R2 sends no CORS headers) and zipped with JSZip,
// as the Skill export does. Files are numbered in board order so they upload
// to Midjourney in the same sequence. Videos are left out: Midjourney
// moodboards take images only.

export type MoodboardExportItem = {
  assetId: string;
  kind: "image" | "video";
  fileName?: string;
};

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

const CONCURRENCY = 4;

export const slugifyMoodboardName = (name: string) =>
  name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "moodboard";

const attachmentName = (header: string | null) =>
  /filename="?([^";]+)"?/i.exec(header ?? "")?.[1]?.trim();

const stem = (name: string) => name.replace(/\.[^./\\]+$/, "");

// "07-dari-golden-hour.jpg": position, then the stored file name (or the
// asset ID's tail), then the extension the route actually served.
export const moodboardExportFileName = (
  index: number,
  item: MoodboardExportItem,
  contentType: string | null,
  served?: string,
) => {
  const type = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  const source = served ?? item.fileName;
  const extension =
    EXTENSION_BY_TYPE[type] ??
    source?.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() ??
    "jpg";
  const base = slugifyMoodboardName(source ? stem(source) : item.assetId.slice(-8));
  return `${String(index + 1).padStart(2, "0")}-${base}.${extension}`;
};

const saveBlob = (blob: Blob, name: string) => {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
};

export async function downloadMoodboardImages(
  boardName: string,
  items: MoodboardExportItem[],
  onProgress?: (done: number, total: number) => void,
) {
  const images = items.filter((item) => item.kind === "image");
  if (images.length === 0) throw new Error("This board has no images to download.");
  const { default: JSZip } = await import("jszip");
  const slug = slugifyMoodboardName(boardName);
  const zip = new JSZip();
  const folder = zip.folder(slug) ?? zip;
  let next = 0;
  let done = 0;
  let zipped = 0;
  let firstStatus: number | undefined;

  const worker = async () => {
    while (next < images.length) {
      const index = next;
      next += 1;
      const item = images[index]!;
      try {
        const response = await fetch(assetDownloadHref(item.assetId));
        if (!response.ok) {
          firstStatus ??= response.status;
          throw new Error(`HTTP ${response.status}`);
        }
        const blob = await response.blob();
        folder.file(
          moodboardExportFileName(
            index,
            item,
            response.headers.get("content-type") ?? blob.type,
            attachmentName(response.headers.get("content-disposition")),
          ),
          blob,
        );
        zipped += 1;
      } catch {
        // Counted below; one missing file does not sink the archive.
      } finally {
        done += 1;
        onProgress?.(done, images.length);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, images.length) }, worker));

  if (zipped === 0) {
    throw new Error(
      firstStatus === 401
        ? "Your session expired. Sign in again, then retry the download."
        : "Could not fetch any of the board's images.",
    );
  }
  saveBlob(await zip.generateAsync({ type: "blob" }), `${slug}-moodboard.zip`);
  return { zipped, failed: images.length - zipped };
}
