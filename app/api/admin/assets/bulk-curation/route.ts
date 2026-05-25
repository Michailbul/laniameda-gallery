import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";
import { requireAuth } from "@/lib/server-auth";
import type { Id } from "@/convex/_generated/dataModel";
import { canActorAccessByUserId, parseUserIdList } from "@/lib/identity";
import { getServerConvexClient } from "@/lib/server/convex";

const bulkSetAssetCurationMutation = makeFunctionReference<"mutation">(
  "assets:bulkSetAssetCuration",
);

const resolveCuratorUserIds = () =>
  parseUserIdList(
    process.env.CURATION_ADMIN_USER_IDS ?? process.env.KB_OWNER_USER_ID,
  );

const MAX_BATCH = 200;

export async function POST(request: Request) {
  try {
    const authUser = await requireAuth();
    const body = (await request.json().catch(() => null)) as
      | {
          assetIds?: unknown;
          isPublic?: unknown;
          isFeatured?: unknown;
        }
      | null;

    if (typeof body?.isPublic !== "boolean") {
      return NextResponse.json(
        { error: "isPublic must be a boolean." },
        { status: 400 },
      );
    }
    if (body.isFeatured !== undefined && typeof body.isFeatured !== "boolean") {
      return NextResponse.json(
        { error: "isFeatured must be a boolean when provided." },
        { status: 400 },
      );
    }
    if (!Array.isArray(body.assetIds) || body.assetIds.length === 0) {
      return NextResponse.json(
        { error: "assetIds must be a non-empty array." },
        { status: 400 },
      );
    }
    if (body.assetIds.length > MAX_BATCH) {
      return NextResponse.json(
        { error: `Maximum ${MAX_BATCH} assets per request.` },
        { status: 400 },
      );
    }
    const assetIds: string[] = [];
    for (const id of body.assetIds) {
      if (typeof id !== "string" || id.trim().length === 0) {
        return NextResponse.json(
          { error: "Each assetId must be a non-empty string." },
          { status: 400 },
        );
      }
      assetIds.push(id);
    }

    const adminSecret = process.env.CURATION_ADMIN_SECRET;
    if (!adminSecret) {
      return NextResponse.json(
        { error: "Server misconfigured: missing CURATION_ADMIN_SECRET." },
        { status: 500 },
      );
    }

    const allowedCurators = resolveCuratorUserIds();
    if (allowedCurators.length === 0) {
      return NextResponse.json(
        { error: "Server misconfigured: no curator users configured." },
        { status: 500 },
      );
    }

    const canCurate = canActorAccessByUserId(authUser.id, allowedCurators);
    if (!canCurate) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const client = getServerConvexClient();
    const result = await client.mutation(bulkSetAssetCurationMutation, {
      assetIds: assetIds as Id<"assets">[],
      actorUserId: authUser.id,
      isPublic: body.isPublic,
      isFeatured: body.isFeatured,
      adminSecret,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
