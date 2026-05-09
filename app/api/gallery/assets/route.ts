import { NextResponse } from "next/server";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { requireAppUser } from "@/lib/server/app-user";
import { getServerConvexClient } from "@/lib/server/convex";

type Scope = "mine" | "public";
type AssetKind = "image" | "video";
type Pillar = string;

const VALID_KINDS = new Set<AssetKind>(["image", "video"]);

const parseScope = (value: string | null): Scope => {
  return value === "mine" ? "mine" : "public";
};

const parseLimit = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
};

const parseTagIds = (params: URLSearchParams): string[] | undefined => {
  const values = params.getAll("tagIds");
  if (values.length === 0) return undefined;

  const parsed = values
    .flatMap((value) => value.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : undefined;
};

const parseKind = (value: string | null): AssetKind | undefined => {
  if (!value) return undefined;
  return VALID_KINDS.has(value as AssetKind) ? (value as AssetKind) : undefined;
};

const parsePillar = (value: string | null): Pillar | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const scope = parseScope(params.get("scope"));

  try {
    const client = getServerConvexClient();
    const kind = parseKind(params.get("kind"));
    const limit = parseLimit(params.get("limit"));
    const folderId = params.get("folderId")?.trim() || undefined;
    const modelName = params.get("modelName")?.trim() || undefined;
    const pillar = parsePillar(params.get("pillar"));
    const search = params.get("search")?.trim() || undefined;
    const tagIds = parseTagIds(params) as Id<"tags">[] | undefined;

    if (scope === "mine") {
      const user = await requireAppUser();
      const assets = await client.query(api.assets.listGalleryAssets, {
        ownerUserId: user.ownerUserId,
        kind,
        limit,
        folderId: folderId as Id<"folders"> | undefined,
        modelName,
        pillar,
        search,
        tagIds,
      });
      return NextResponse.json({ assets });
    }

    const assets = await client.query(api.assets.listPublicGalleryAssets, {
      kind,
      limit,
      folderId: folderId as Id<"folders"> | undefined,
      modelName,
      pillar,
      search,
      tagIds,
    });
    return NextResponse.json({ assets });
  } catch (error) {
    if (error instanceof Error && error.message === "Not authenticated.") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to load assets.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
