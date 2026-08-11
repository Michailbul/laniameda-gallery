import sharp from "sharp";

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

// Formats re-encoded to JPEG on the way out. JPEG is already right; GIF would
// lose its animation and SVG is not raster at all, so both stream untouched.
const CONVERT_TO_JPEG = new Set([
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
  "image/png",
  "image/tiff",
]);

const JPEG_QUALITY = 92;

const sanitizeFileName = (name: string) =>
  name.replace(/[\r\n"\\]/g, "").trim();

const stripExtension = (name: string) => name.replace(/\.[^./\\]+$/, "");

const normalizeContentType = (value: string) =>
  value.split(";")[0]!.trim().toLowerCase();

export type AssetDownload = {
  url: string;
  fileName?: string;
  contentType?: string;
  kind: "image" | "video";
};

/**
 * Stream an asset's bytes with a Content-Disposition attachment header, so a
 * single click on the download control puts the file on disk. R2's public
 * domain sends no CORS headers, so downloads go through this same-origin proxy
 * (board token-gated or owner session-gated) instead of a cross-origin fetch.
 *
 * Images that aren't already JPEG are re-encoded here: assets captured before
 * the extension started converting are stored as WebP, and a .webp on disk is
 * useless in most desktop tools.
 */
export async function streamAssetDownload(
  download: AssetDownload,
  assetId: string,
): Promise<Response> {
  const upstream = await fetch(download.url);
  if (!upstream.ok || !upstream.body) {
    return new Response("Upstream fetch failed.", { status: 502 });
  }

  const sourceContentType = normalizeContentType(
    download.contentType ??
      upstream.headers.get("content-type") ??
      "application/octet-stream",
  );

  const shouldConvert =
    download.kind === "image" && CONVERT_TO_JPEG.has(sourceContentType);

  if (shouldConvert) {
    try {
      const original = Buffer.from(await upstream.arrayBuffer());
      const jpeg = await sharp(original)
        // JPEG has no alpha channel — flatten onto white rather than black.
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer();
      return fileResponse(jpeg, "image/jpeg", downloadFileName(download, assetId, "jpg"));
    } catch (error) {
      console.warn("Download JPEG conversion failed, serving original:", error);
      // The upstream body is already consumed — refetch to stream the original.
      const retry = await fetch(download.url);
      if (!retry.ok || !retry.body) {
        return new Response("Upstream fetch failed.", { status: 502 });
      }
      return streamResponse(retry, sourceContentType, download, assetId);
    }
  }

  return streamResponse(upstream, sourceContentType, download, assetId);
}

function downloadFileName(
  download: AssetDownload,
  assetId: string,
  extension: string,
) {
  const named = sanitizeFileName(download.fileName ?? "");
  if (named) return `${stripExtension(named)}.${extension}`;
  return `laniameda-${assetId.slice(-8)}.${extension}`;
}

function attachmentHeaders(contentType: string, fileName: string) {
  return new Headers({
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Cache-Control": "private, max-age=0",
  });
}

function fileResponse(body: Buffer, contentType: string, fileName: string) {
  const headers = attachmentHeaders(contentType, fileName);
  headers.set("Content-Length", String(body.byteLength));
  return new Response(new Uint8Array(body), { status: 200, headers });
}

function streamResponse(
  upstream: Response,
  contentType: string,
  download: AssetDownload,
  assetId: string,
) {
  const extension =
    EXTENSION_BY_CONTENT_TYPE[contentType] ??
    (download.kind === "video" ? "mp4" : "jpg");
  // Untouched bytes keep their stored name — only the fallback name needs an
  // extension derived from the content type.
  const fileName =
    sanitizeFileName(download.fileName ?? "") ||
    `laniameda-${assetId.slice(-8)}.${extension}`;
  const headers = attachmentHeaders(contentType, fileName);
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) {
    headers.set("Content-Length", contentLength);
  }
  return new Response(upstream.body, { status: 200, headers });
}
