import { NextResponse } from "next/server";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { getAppUser } from "@/lib/server/app-user";
import { getServerConvexClient } from "@/lib/server/convex";

type Scope = "mine" | "public";
type AssetKind = "image" | "video";
type AssetRole =
  | "generated_output"
  | "reference"
  | "inspiration_capture"
  | "workflow_asset"
  | "other";
type Pillar = "creators" | "designs" | "dump";

const VALID_SCOPES = new Set<Scope>(["mine", "public"]);
const VALID_KINDS = new Set<AssetKind>(["image", "video"]);
const VALID_ASSET_ROLES = new Set<AssetRole>([
  "generated_output",
  "reference",
  "inspiration_capture",
  "workflow_asset",
  "other",
]);
const VALID_PILLARS = new Set<Pillar>(["creators", "designs", "dump"]);

const normalizeScope = (value: unknown): Scope => {
  if (typeof value === "string" && VALID_SCOPES.has(value as Scope)) {
    return value as Scope;
  }
  return "public";
};

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | {
          scope?: unknown;
          query?: unknown;
          pillar?: unknown;
          folderId?: unknown;
          modelName?: unknown;
          assetRole?: unknown;
          kind?: unknown;
          limit?: unknown;
        }
      | null;
    if (!body || typeof body.query !== "string" || body.query.trim().length === 0) {
      return NextResponse.json({ error: "query is required." }, { status: 400 });
    }

    const scope = normalizeScope(body.scope);
    const appUser = scope === "mine" ? await getAppUser() : null;
    if (scope === "mine" && !appUser) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const client = getServerConvexClient();
    const results = await client.action(api.semanticSearch.searchAssets, {
      ownerUserId: scope === "mine" ? appUser?.ownerUserId : undefined,
      scope,
      query: body.query.trim(),
      pillar:
        typeof body.pillar === "string" && VALID_PILLARS.has(body.pillar as Pillar)
          ? (body.pillar as Pillar)
          : undefined,
      folderId:
        typeof body.folderId === "string" && body.folderId.trim().length > 0
          ? (body.folderId as Id<"folders">)
          : undefined,
      modelName:
        typeof body.modelName === "string" && body.modelName.trim().length > 0
          ? body.modelName
          : undefined,
      assetRole:
        typeof body.assetRole === "string" && VALID_ASSET_ROLES.has(body.assetRole as AssetRole)
          ? (body.assetRole as AssetRole)
          : undefined,
      kind:
        typeof body.kind === "string" && VALID_KINDS.has(body.kind as AssetKind)
          ? (body.kind as AssetKind)
          : undefined,
      limit:
        typeof body.limit === "number" && Number.isFinite(body.limit)
          ? body.limit
          : undefined,
    });

    return NextResponse.json({ results });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Semantic search failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
