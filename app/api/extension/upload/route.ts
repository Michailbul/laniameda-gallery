import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";

import { getServerConvexClient } from "@/lib/server/convex";
import {
  resolveExtensionOwnerUserId,
  validateExtensionToken,
} from "@/lib/server/extension-auth";

const generateUploadUrlMutation = makeFunctionReference<"mutation">(
  "r2:generateUploadUrl",
);
const syncMetadataMutation = makeFunctionReference<"mutation">(
  "r2:syncMetadata",
);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Token",
  "Cache-Control": "no-store",
};

const corsJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: CORS_HEADERS });

type UploadRequest = {
  action?: unknown;
  key?: unknown;
};

export async function POST(request: Request) {
  try {
    if (!validateExtensionToken(request)) {
      return corsJson({ error: "Unauthorized extension request." }, 401);
    }

    // Keep the upload handshake scoped to the same configured owner as every
    // other extension route, even though the R2 component itself only needs a
    // token-authorized call to mint the signed URL.
    resolveExtensionOwnerUserId();

    const payload = (await request.json().catch(() => null)) as UploadRequest | null;
    const action = typeof payload?.action === "string" ? payload.action : "";
    const client = getServerConvexClient();

    if (action === "prepare") {
      const result = (await client.mutation(generateUploadUrlMutation, {})) as {
        key?: unknown;
        url?: unknown;
      };
      if (typeof result.key !== "string" || typeof result.url !== "string") {
        return corsJson({ error: "R2 did not return an upload session." }, 502);
      }
      return corsJson({ ok: true, key: result.key, url: result.url });
    }

    if (action === "complete") {
      const key = typeof payload?.key === "string" ? payload.key.trim() : "";
      if (!key || key.length > 500 || key.includes("..")) {
        return corsJson({ error: "A valid upload key is required." }, 400);
      }
      await client.mutation(syncMetadataMutation, { key });
      return corsJson({ ok: true, key });
    }

    return corsJson({ error: "action must be prepare or complete." }, 400);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to prepare extension upload.";
    return corsJson({ error: message }, 400);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
