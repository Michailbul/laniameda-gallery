import { NextResponse } from "next/server";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { requireAppUser } from "@/lib/server/app-user";
import { getServerConvexClient } from "@/lib/server/convex";
import {
  getCurationAdminSecret,
  isCurationAdmin,
} from "@/lib/server/admin";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const user = await requireAppUser();
    if (!isCurationAdmin(user.ownerUserId)) {
      return NextResponse.json(
        { error: "Only gallery admins can delete assets." },
        { status: 403 },
      );
    }
    const adminSecret = getCurationAdminSecret();
    if (!adminSecret) {
      return NextResponse.json(
        { error: "Delete is disabled: CURATION_ADMIN_SECRET is not configured." },
        { status: 503 },
      );
    }

    const { assetId } = await context.params;
    if (!assetId?.trim()) {
      return NextResponse.json({ error: "assetId is required." }, { status: 400 });
    }

    const client = getServerConvexClient();
    await client.mutation(api.assets.deleteAsset, {
      id: assetId as Id<"assets">,
      actorUserId: user.ownerUserId,
      adminSecret,
    });

    return NextResponse.json({
      deleted: true,
      assetId,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Not authenticated.") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to delete asset.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
