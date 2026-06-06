import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";
import { buildIngestKey } from "@/lib/ingest";
import { getServerConvexClient } from "@/lib/server/convex";
import {
  resolveExtensionOwnerUserId,
  validateExtensionToken,
} from "@/lib/server/extension-auth";

const ingestAction = makeFunctionReference<"action">("ingest:ingestFromApi");
const updateAction = makeFunctionReference<"action">("ingest:updateFromApi");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Token",
};

function corsJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

// Auth note: validateExtensionToken enforces EXTENSION_API_TOKEN when set, and
// fails OPEN (returns true) when it is unset. To actually protect this route,
// set EXTENSION_API_TOKEN and have the extension send it (X-Extension-Token).
export async function POST(request: Request) {
  try {
    if (!validateExtensionToken(request)) {
      return corsJson({ error: "Unauthorized extension request." }, 401);
    }

    const ownerUserId = resolveExtensionOwnerUserId();

    const data = await request.json();
    const mode = typeof data.mode === "string" ? data.mode : "save";
    const imageUrl = typeof data.imageUrl === "string" ? data.imageUrl : undefined;
    const promptText = typeof data.promptText === "string" ? data.promptText.trim() : undefined;
    const sourceUrl = typeof data.sourceUrl === "string" ? data.sourceUrl : undefined;
    const modelName = typeof data.modelName === "string" ? data.modelName : undefined;
    // Collection (stored as a `folders` row) the asset should be filed under.
    const folderId =
      typeof data.folderId === "string" && data.folderId.trim()
        ? data.folderId.trim()
        : undefined;

    // Accept base64 file data (for CDNs that block server-side fetch, e.g. Midjourney)
    let file: { base64: string; contentType?: string; fileName?: string } | undefined;
    if (data.file && typeof data.file.base64 === "string") {
      file = {
        base64: data.file.base64,
        contentType: typeof data.file.contentType === "string" ? data.file.contentType : undefined,
      };
    }

    if (!imageUrl && !file) {
      return corsJson({ error: "imageUrl or file is required." }, 400);
    }

    const ingestKey = buildIngestKey({
      url: imageUrl ?? sourceUrl,
      fileName: file?.fileName,
    });
    if (!ingestKey) {
      return corsJson({ error: "Could not derive ingest key." }, 400);
    }

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
        else if (host.includes("krea")) tagNames.push("krea");
        else if (host.includes("recraft")) tagNames.push("recraft");
        else if (host.includes("pinterest")) tagNames.push("pinterest");
        else if (host.includes("instagram")) tagNames.push("instagram");
        else if (host.includes("civitai")) tagNames.push("civitai");
        else if (host.includes("behance")) tagNames.push("behance");
      } catch {
        // invalid URL, skip auto-tag
      }
    }

    const client = getServerConvexClient();

    if (mode === "updatePrompt") {
      if (!promptText) {
        return corsJson({ error: "promptText is required for prompt updates." }, 400);
      }

      const promptSeed = await client.action(ingestAction, {
        ownerUserId,
        promptText,
        allowPromptOnly: true,
        promptIngestKey: ingestKey,
        tagNames,
        modelName: modelName || undefined,
        generationType: "image_gen",
        assetRole: "inspiration_capture",
        ingestSource: "import",
        domain: sourceUrl || undefined,
      });

      const promptResult = await client.action(updateAction, {
        ownerUserId,
        target: "prompt",
        ingestKey,
        promptText,
        tagNames,
        modelName: modelName || undefined,
        domain: sourceUrl || undefined,
      });

      const assetResult = await client.action(updateAction, {
        ownerUserId,
        target: "asset",
        ingestKey,
        promptId: promptSeed.promptId ?? promptResult.promptId,
        tagNames,
        modelName: modelName || undefined,
        ...(folderId ? { folderId } : {}),
      });

      return corsJson({
        ok: true,
        result: {
          assetId: assetResult.assetId,
          promptId: promptSeed.promptId ?? promptResult.promptId,
        },
      });
    }

    const result = await client.action(ingestAction, {
      ownerUserId,
      url: imageUrl,
      file: file || undefined,
      promptText: promptText || undefined,
      allowPromptOnly: false,
      ingestKey,
      tagNames,
      modelName: modelName || undefined,
      folderId: folderId || undefined,
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
