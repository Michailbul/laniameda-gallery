import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";
import { buildIngestKey } from "@/lib/ingest";
import { getServerConvexClient } from "@/lib/server/convex";

const ingestAction = makeFunctionReference<"action">("ingest:ingestFromApi");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Gallery-API-Key",
};

function corsJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

function validateApiKey(request: Request): boolean {
  const key = request.headers.get("x-gallery-api-key");
  const expected = process.env.EXTENSION_API_KEY;
  if (!expected) return false;
  return key === expected;
}

export async function POST(request: Request) {
  try {
    if (!validateApiKey(request)) {
      return corsJson({ error: "Unauthorized" }, 401);
    }

    const ownerUserId = process.env.EXTENSION_OWNER_USER_ID;
    if (!ownerUserId) {
      return corsJson({ error: "Extension owner not configured." }, 500);
    }

    const data = await request.json();
    const imageUrl = typeof data.imageUrl === "string" ? data.imageUrl : undefined;
    const promptText = typeof data.promptText === "string" ? data.promptText.trim() : undefined;
    const sourceUrl = typeof data.sourceUrl === "string" ? data.sourceUrl : undefined;
    const pillar = typeof data.pillar === "string" ? data.pillar : "dump";
    const modelName = typeof data.modelName === "string" ? data.modelName : undefined;

    if (!imageUrl) {
      return corsJson({ error: "imageUrl is required." }, 400);
    }

    // Dedup key based on image URL only (so prompt update re-uses same key)
    const ingestKey = buildIngestKey({ url: imageUrl });

    const tagNames: string[] = [];
    if (Array.isArray(data.tagNames)) {
      for (const t of data.tagNames) {
        if (typeof t === "string" && t.trim()) tagNames.push(t.trim());
      }
    }

    // Auto-tag with source platform
    if (sourceUrl) {
      try {
        const host = new URL(sourceUrl).hostname.replace("www.", "");
        if (host.includes("midjourney")) tagNames.push("midjourney");
        else if (host.includes("pinterest")) tagNames.push("pinterest");
        else if (host.includes("instagram")) tagNames.push("instagram");
        else if (host.includes("civitai")) tagNames.push("civitai");
        else if (host.includes("behance")) tagNames.push("behance");
      } catch {
        // invalid URL, skip auto-tag
      }
    }

    const client = getServerConvexClient();
    const result = await client.action(ingestAction, {
      ownerUserId,
      url: imageUrl,
      promptText: promptText || undefined,
      allowPromptOnly: false,
      ingestKey,
      tagNames,
      pillar,
      modelName: modelName || undefined,
      generationType: "image_gen",
      assetRole: "inspiration_capture",
      ingestSource: "import",
      domain: sourceUrl || undefined,
    });

    return corsJson({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return corsJson({ error: message }, 400);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
