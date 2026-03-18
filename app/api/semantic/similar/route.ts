import { NextResponse } from "next/server";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { getAppUser } from "@/lib/server/app-user";
import { getServerConvexClient } from "@/lib/server/convex";

type Scope = "mine" | "public";

const normalizeScope = (value: unknown): Scope =>
  value === "mine" ? "mine" : "public";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | {
          scope?: unknown;
          assetId?: unknown;
          limit?: unknown;
        }
      | null;
    if (!body || typeof body.assetId !== "string" || body.assetId.trim().length === 0) {
      return NextResponse.json({ error: "assetId is required." }, { status: 400 });
    }

    const scope = normalizeScope(body.scope);
    const appUser = scope === "mine" ? await getAppUser() : null;
    if (scope === "mine" && !appUser) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const client = getServerConvexClient();
    const results = await client.action(api.semanticSearch.findSimilarAssets, {
      ownerUserId: scope === "mine" ? appUser?.ownerUserId : undefined,
      scope,
      assetId: body.assetId as Id<"assets">,
      limit:
        typeof body.limit === "number" && Number.isFinite(body.limit)
          ? body.limit
          : undefined,
    });

    return NextResponse.json({ results });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Semantic similar lookup failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
