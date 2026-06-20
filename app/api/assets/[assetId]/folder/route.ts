import { NextResponse } from "next/server";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { requireAppUser } from "@/lib/server/app-user";
import { getServerConvexClient } from "@/lib/server/convex";

export async function POST(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const user = await requireAppUser();
    const { assetId } = await context.params;
    if (!assetId?.trim()) {
      return NextResponse.json({ error: "assetId is required." }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as
      | { folderId?: string | null; folderIds?: string[] }
      | null;
    if (!body || (!("folderId" in body) && !("folderIds" in body))) {
      return NextResponse.json({ error: "folderId or folderIds must be provided." }, { status: 400 });
    }

    const client = getServerConvexClient();
    const asset = Array.isArray(body.folderIds)
      ? await client.mutation(api.assets.setAssetFolders, {
          ownerUserId: user.ownerUserId,
          assetId: assetId as Id<"assets">,
          folderIds: body.folderIds
            .filter((folderId): folderId is string =>
              typeof folderId === "string" && folderId.trim().length > 0,
            )
            .map((folderId) => folderId as Id<"folders">),
        })
      : await client.mutation(api.assets.setAssetFolder, {
          ownerUserId: user.ownerUserId,
          assetId: assetId as Id<"assets">,
          folderId:
            typeof body.folderId === "string" && body.folderId.trim().length > 0
              ? (body.folderId as Id<"folders">)
              : undefined,
        });

    return NextResponse.json({ asset });
  } catch (error) {
    if (error instanceof Error && error.message === "Not authenticated.") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to update asset folder.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
