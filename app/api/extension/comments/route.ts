import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";

import { getServerConvexClient } from "@/lib/server/convex";
import {
  resolveExtensionOwnerUserId,
  validateExtensionToken,
} from "@/lib/server/extension-auth";

const addCommentMutation = makeFunctionReference<"mutation">(
  "assetComments:addAssetComment",
);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Token",
};

const corsJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: CORS_HEADERS });

const MAX_COMMENT_LENGTH = 4000;

export async function POST(request: Request) {
  try {
    if (!validateExtensionToken(request)) {
      return corsJson({ error: "Unauthorized extension request." }, 401);
    }

    const payload = (await request.json().catch(() => null)) as
      | { assetId?: unknown; body?: unknown }
      | null;
    const assetId =
      payload && typeof payload.assetId === "string" ? payload.assetId.trim() : "";
    const body =
      payload && typeof payload.body === "string" ? payload.body.trim() : "";
    if (!assetId) return corsJson({ error: "assetId is required." }, 400);
    if (!body) return corsJson({ error: "body is required." }, 400);
    if (body.length > MAX_COMMENT_LENGTH) {
      return corsJson(
        { error: `body must be ${MAX_COMMENT_LENGTH} characters or fewer.` },
        400,
      );
    }

    const ownerUserId = resolveExtensionOwnerUserId();
    const client = getServerConvexClient(ownerUserId);
    const comment = await client.mutation(addCommentMutation, {
      ownerUserId,
      assetId,
      body,
      author: "owner",
    });
    return corsJson({ ok: true, commentId: comment?._id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save the comment.";
    return corsJson({ error: message }, 400);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
