import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getServerConvexClient } from "@/lib/server/convex";

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

/**
 * Download proxy for the public direction board. The share token gates
 * access (validated in Convex against the project's member collections);
 * the response streams the asset same-origin with a Content-Disposition
 * header, because R2's public domain sends no CORS headers and a
 * cross-origin fetch from the board page would be blocked.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token")?.trim() ?? "";
  const assetId = searchParams.get("assetId")?.trim() ?? "";
  if (!token || !assetId) {
    return new Response("Missing token or assetId.", { status: 400 });
  }

  let download;
  try {
    const client = getServerConvexClient();
    download = await client.query(api.directionBoard.getBoardAssetDownload, {
      token,
      assetId: assetId as Id<"assets">,
    });
  } catch {
    return new Response("Invalid request.", { status: 400 });
  }
  if (!download) {
    return new Response("Not found.", { status: 404 });
  }

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
