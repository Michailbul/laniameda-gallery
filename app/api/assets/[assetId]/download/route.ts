import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireAppUser } from "@/lib/server/app-user";
import { getServerConvexClient } from "@/lib/server/convex";
import { streamAssetDownload } from "@/lib/server/asset-download";

/**
 * Owner-side download proxy for the project workspace (session-gated twin of
 * /api/board/download). Streams the asset same-origin with an attachment
 * header, because R2's public domain sends no CORS headers and a plain
 * `download` attribute is ignored on cross-origin links.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  let user;
  try {
    user = await requireAppUser();
  } catch {
    return new Response("Not authenticated.", { status: 401 });
  }

  const { assetId } = await context.params;
  if (!assetId?.trim()) {
    return new Response("assetId is required.", { status: 400 });
  }

  let download;
  try {
    const client = getServerConvexClient();
    download = await client.query(api.assets.getAssetDownload, {
      ownerUserId: user.ownerUserId,
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
