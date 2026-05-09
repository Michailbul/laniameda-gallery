import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";

import { getServerConvexClient } from "@/lib/server/convex";
import {
  resolveExtensionOwnerUserId,
  validateExtensionToken,
} from "@/lib/server/extension-auth";

const listPillarsQuery = makeFunctionReference<"query">(
  "userPillars:listPillars",
);
const upsertPillarMutation = makeFunctionReference<"mutation">(
  "userPillars:upsertPillar",
);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Token",
};

const corsJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: CORS_HEADERS });

const listPillars = async (ownerUserId: string) => {
  const client = getServerConvexClient();
  const pillars = await client.query(listPillarsQuery, { ownerUserId });
  return { client, pillars };
};

export async function GET(request: Request) {
  try {
    if (!validateExtensionToken(request)) {
      return corsJson({ error: "Unauthorized extension request." }, 401);
    }

    const ownerUserId = resolveExtensionOwnerUserId();
    const { pillars } = await listPillars(ownerUserId);
    return corsJson({ ok: true, pillars });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load pillars.";
    return corsJson({ error: message }, 400);
  }
}

export async function POST(request: Request) {
  try {
    if (!validateExtensionToken(request)) {
      return corsJson({ error: "Unauthorized extension request." }, 401);
    }

    const ownerUserId = resolveExtensionOwnerUserId();
    const payload = (await request.json().catch(() => null)) as
      | {
          key?: unknown;
          label?: unknown;
          description?: unknown;
          color?: unknown;
          icon?: unknown;
          sortOrder?: unknown;
        }
      | null;
    if (!payload || typeof payload.label !== "string") {
      return corsJson({ error: "label is required." }, 400);
    }

    const client = getServerConvexClient();
    const result = await client.mutation(upsertPillarMutation, {
      ownerUserId,
      key: typeof payload.key === "string" ? payload.key : undefined,
      label: payload.label,
      description:
        typeof payload.description === "string" ? payload.description : undefined,
      color: typeof payload.color === "string" ? payload.color : undefined,
      icon: typeof payload.icon === "string" ? payload.icon : undefined,
      sortOrder:
        typeof payload.sortOrder === "number" && Number.isFinite(payload.sortOrder)
          ? payload.sortOrder
          : undefined,
    });
    const pillars = await client.query(listPillarsQuery, { ownerUserId });
    return corsJson({ ok: true, result, pillars });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save pillar.";
    return corsJson({ error: message }, 400);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
