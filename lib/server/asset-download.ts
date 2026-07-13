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

const sanitizeFileName = (name: string) =>
  name.replace(/[\r\n"\\]/g, "").trim();

export type AssetDownload = {
  url: string;
  fileName?: string;
  contentType?: string;
  kind: "image" | "video";
};

/**
 * Stream an asset's bytes with a Content-Disposition attachment header.
 * R2's public domain sends no CORS headers, so downloads go through a
 * same-origin proxy route (board token-gated or owner session-gated) instead
 * of a cross-origin fetch.
 */
export async function streamAssetDownload(
  download: AssetDownload,
  assetId: string,
): Promise<Response> {
  const upstream = await fetch(download.url);
  if (!upstream.ok || !upstream.body) {
    return new Response("Upstream fetch failed.", { status: 502 });
  }

  const contentType =
    download.contentType ??
    upstream.headers.get("content-type") ??
    "application/octet-stream";
  const extension =
    EXTENSION_BY_CONTENT_TYPE[contentType.toLowerCase()] ??
    (download.kind === "video" ? "mp4" : "jpg");
  const fileName =
    sanitizeFileName(download.fileName ?? "") ||
    `laniameda-${assetId.slice(-8)}.${extension}`;

  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Cache-Control": "private, max-age=0",
  });
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) {
    headers.set("Content-Length", contentLength);
  }

  return new Response(upstream.body, { status: 200, headers });
}
