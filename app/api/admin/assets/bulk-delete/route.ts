import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";
import { requireAuth } from "@/lib/server-auth";
import type { Id } from "@/convex/_generated/dataModel";
import { canActorAccessByUserId, parseUserIdList } from "@/lib/identity";
import { getServerConvexClient } from "@/lib/server/convex";

const bulkDeleteGalleryItemsMutation = makeFunctionReference<"mutation">(
  "assets:bulkDeleteGalleryItems",
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
          assetPackIds?: unknown;
        }
      | null;

    const rawAssetIds = Array.isArray(body?.assetIds) ? body.assetIds : [];
    const rawAssetPackIds = Array.isArray(body?.assetPackIds)
      ? body.assetPackIds
      : [];
    if (rawAssetIds.length === 0 && rawAssetPackIds.length === 0) {
      return NextResponse.json(
        { error: "assetIds or assetPackIds must be a non-empty array." },
        { status: 400 },
      );
    }
    if (rawAssetIds.length + rawAssetPackIds.length > MAX_BATCH) {
      return NextResponse.json(
        { error: `Maximum ${MAX_BATCH} gallery items per request.` },
        { status: 400 },
      );
    }

    const assetIds: string[] = [];
    for (const id of rawAssetIds) {
      if (typeof id !== "string" || id.trim().length === 0) {
        return NextResponse.json(
          { error: "Each assetId must be a non-empty string." },
          { status: 400 },
        );
      }
      assetIds.push(id);
    }

    const assetPackIds: string[] = [];
    for (const id of rawAssetPackIds) {
      if (typeof id !== "string" || id.trim().length === 0) {
        return NextResponse.json(
          { error: "Each assetPackId must be a non-empty string." },
          { status: 400 },
        );
      }
      assetPackIds.push(id);
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
    const result = await client.mutation(bulkDeleteGalleryItemsMutation, {
      assetIds: assetIds as Id<"assets">[],
      assetPackIds: assetPackIds as Id<"assetPacks">[],
      actorUserId: authUser.id,
      adminSecret,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
