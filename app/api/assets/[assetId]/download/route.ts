import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireAppUser } from "@/lib/server/app-user";
import { getServerConvexClient } from "@/lib/server/convex";
import { streamAssetDownload } from "@/lib/server/asset-download";

/**
 * Download proxy for the workspace. Streams the asset same-origin with an
 * attachment header, because R2's public domain sends no CORS headers and a
 * plain `download` attribute is ignored on cross-origin links.
 *
 * Signed-in owners get any of their assets. Signed-out visitors get the same
 * route for pieces that are already `isPublic` on the showcase — the download
 * control lives on public tiles too, and it should put a file on disk there as
 * well instead of opening a tab.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await context.params;
  if (!assetId?.trim()) {
    return new Response("assetId is required.", { status: 400 });
  }

  let user: Awaited<ReturnType<typeof requireAppUser>> | null = null;
  try {
    user = await requireAppUser();
  } catch {
    user = null;
  }

  let download;
  try {
    const client = getServerConvexClient();
    download = user
      ? await client.query(api.assets.getAssetDownload, {
          ownerUserId: user.ownerUserId,
          assetId: assetId as Id<"assets">,
        })
      : await client.query(api.showcase.getPublicAssetDownload, { assetId });
  } catch {
    return new Response("Invalid request.", { status: 400 });
  }
  if (!download) {
    return new Response(user ? "Not found." : "Not authenticated.", {
      status: user ? 404 : 401,
    });
  }

  return streamAssetDownload(download, assetId);
}
