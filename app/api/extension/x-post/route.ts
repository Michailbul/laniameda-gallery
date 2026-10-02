import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";

import { getServerConvexClient } from "@/lib/server/convex";
import {
  resolveExtensionOwnerUserId,
  validateExtensionToken,
} from "@/lib/server/extension-auth";

// Dedicated contract for saving X posts as bookmarks. The extension sends the
// post as it read it off the page plus a preview crop; Convex normalizes it,
// stores the preview as a "bookmark" asset and files it into collections.
const saveXPostAction = makeFunctionReference<"action">(
  "bookmarkSaves:saveXPostFromExtension",
);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Token",
};

const corsJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: CORS_HEADERS });

const MAX_TAGS = 20;

const readStringArray = (value: unknown, max: number) =>
  Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(0, max)
    : [];

const readFolderIds = (payload: Record<string, unknown>) => {
  const ids = [
    ...(typeof payload.folderId === "string" ? [payload.folderId] : []),
    ...readStringArray(payload.folderIds, 50),
  ]
    .map((id) => id.trim())
    .filter(Boolean);
  return Array.from(new Set(ids));
};

export async function POST(request: Request) {
  try {
    if (!validateExtensionToken(request)) {
      return corsJson({ error: "Unauthorized extension request." }, 401);
    }

    const ownerUserId = resolveExtensionOwnerUserId();
    const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!payload || typeof payload !== "object") {
      return corsJson({ error: "Invalid JSON body." }, 400);
    }
    const post = payload.post as Record<string, unknown> | undefined;
    if (!post || typeof post !== "object" || typeof post.url !== "string") {
      return corsJson({ error: "post.url is required." }, 400);
    }

    const preview =
      payload.preview &&
      typeof payload.preview === "object" &&
      typeof (payload.preview as { base64?: unknown }).base64 === "string"
        ? {
            base64: (payload.preview as { base64: string }).base64,
            contentType:
              typeof (payload.preview as { contentType?: unknown }).contentType === "string"
                ? (payload.preview as { contentType: string }).contentType
                : undefined,
          }
        : undefined;

    const client = getServerConvexClient(ownerUserId);
    const result = await client.action(saveXPostAction, {
      ownerUserId,
      post,
      preview,
      folderIds: readFolderIds(payload),
      tagNames: readStringArray(payload.tagNames, MAX_TAGS),
      userNote: typeof payload.userNote === "string" ? payload.userNote : undefined,
    });

    return corsJson({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save the X post.";
    return corsJson({ error: message }, 400);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
