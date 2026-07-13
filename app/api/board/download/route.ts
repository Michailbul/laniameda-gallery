import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getServerConvexClient } from "@/lib/server/convex";
import { streamAssetDownload } from "@/lib/server/asset-download";

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

  return streamAssetDownload(download, assetId);
}
