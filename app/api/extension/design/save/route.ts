import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";

import { getServerConvexClient } from "@/lib/server/convex";
import {
  resolveExtensionOwnerUserId,
  validateExtensionToken,
} from "@/lib/server/extension-auth";

const saveDesignFromExtensionAction = makeFunctionReference<"action">(
  "designExtensionSaves:saveFromExtension",
);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Token",
};

const corsJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: CORS_HEADERS });

export async function POST(request: Request) {
  try {
    if (!validateExtensionToken(request)) {
      return corsJson({ error: "Unauthorized extension request." }, 401);
    }

    const ownerUserId = resolveExtensionOwnerUserId();
    const payload = await request.json();
    const client = getServerConvexClient();
    const result = await client.action(saveDesignFromExtensionAction, {
      ownerUserId,
      pillar: payload.pillar,
      description: payload.description,
      capture: payload.capture,
      captureKind: payload.captureKind,
      saveIntent: payload.saveIntent,
      inspirationType: payload.inspirationType,
      platform: payload.platform,
      workflowType: payload.workflowType,
      tagNames: payload.tagNames,
      userNote: payload.userNote,
      templateKey: payload.templateKey,
    });

    return corsJson({ ok: true, result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save design reference.";
    return corsJson({ error: message }, 400);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

