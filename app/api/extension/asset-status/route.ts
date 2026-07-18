import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";

import {
  buildIngestKey,
  buildMidjourneyIngestKeyPrefixes,
} from "@/lib/ingest";
import { getServerConvexClient } from "@/lib/server/convex";
import {
  resolveExtensionOwnerUserId,
  validateExtensionToken,
} from "@/lib/server/extension-auth";

// "Is this image already in the gallery?" — read-only lookup the extension
// uses to mark viewer media as saved. Matches by the same ingestKey the save
// route derives (the exact image URL), widened with Midjourney variant
// prefixes so a grid save (640 webp) still marks the job page's full-res jpeg.
const checkMatchesQuery = makeFunctionReference<"query">(
  "assets:checkAssetIngestMatches",
);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Token",
};

const corsJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: CORS_HEADERS });

const MAX_URLS = 8;

export async function POST(request: Request) {
  try {
    if (!validateExtensionToken(request)) {
      return corsJson({ error: "Unauthorized extension request." }, 401);
    }

    const ownerUserId = resolveExtensionOwnerUserId();
    const data = (await request.json().catch(() => null)) as
      | { imageUrls?: unknown }
      | null;

    const imageUrls = Array.isArray(data?.imageUrls)
      ? data.imageUrls
          .filter((url): url is string => typeof url === "string" && Boolean(url.trim()))
          .map((url) => url.trim())
          .slice(0, MAX_URLS)
      : [];
    if (imageUrls.length === 0) {
      return corsJson({ error: "imageUrls is required." }, 400);
    }

    const entries = imageUrls.map((url) => ({
      url,
      key: buildIngestKey({ url }),
      prefixes: buildMidjourneyIngestKeyPrefixes(url),
    }));

    const keys = [
      ...new Set(entries.map((entry) => entry.key).filter((key): key is string => Boolean(key))),
    ];
    const prefixes = [...new Set(entries.flatMap((entry) => entry.prefixes))];

    const client = getServerConvexClient();
    const result = (await client.query(checkMatchesQuery, {
      ownerUserId,
      keys,
      prefixes,
    })) as { matchedKeys?: string[]; matchedPrefixes?: string[] } | null;

    const matchedKeys = new Set(result?.matchedKeys ?? []);
    const matchedPrefixes = new Set(result?.matchedPrefixes ?? []);

    const statuses = entries.map((entry) => ({
      url: entry.url,
      saved:
        (entry.key ? matchedKeys.has(entry.key) : false) ||
        entry.prefixes.some((prefix) => matchedPrefixes.has(prefix)),
    }));

    return corsJson({ ok: true, statuses });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to check saved status.";
    return corsJson({ error: message }, 400);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
