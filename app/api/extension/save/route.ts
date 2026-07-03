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
const addAssetFoldersMutation = makeFunctionReference<"mutation">(
  "assets:addAssetFolders",
);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Token",
};

function corsJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

function getUrlParts(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return {
      host: url.hostname.replace(/^www\./, "").toLowerCase(),
      pathname: url.pathname.toLowerCase(),
    };
  } catch {
    return null;
  }
}

function isMidjourneyUrl(value: string | undefined) {
  const url = getUrlParts(value);
  if (!url) return false;
  return (
    url.host.includes("midjourney.com") ||
    url.host === "mj.run" ||
    url.host.endsWith(".mj.run")
  );
}

function inferPlatformTag(value: string | undefined) {
  const url = getUrlParts(value);
  if (!url) return undefined;

  if (
    url.host.includes("midjourney.com") ||
    url.host === "mj.run" ||
    url.host.endsWith(".mj.run")
  ) {
    return "midjourney";
  }
  if (url.host.includes("krea")) return "krea";
  if (url.host.includes("recraft")) return "recraft";
  if (url.host.includes("pinterest")) return "pinterest";
  if (url.host.includes("instagram")) return "instagram";
  if (url.host.includes("civitai")) return "civitai";
  if (url.host.includes("behance")) return "behance";
  return undefined;
}

function isMidjourneyModel(value: string | undefined) {
  return value?.toLowerCase().includes("midjourney") ?? false;
}

function normalizeFolderIds(data: unknown) {
  if (!data || typeof data !== "object") return [];
  const input = data as { folderId?: unknown; folderIds?: unknown };
  const values = [
    ...(typeof input.folderId === "string" ? [input.folderId] : []),
    ...(Array.isArray(input.folderIds) ? input.folderIds : []),
  ];
  const seen = new Set<string>();
  const folderIds: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const folderId = value.trim();
    if (!folderId || seen.has(folderId)) continue;
    seen.add(folderId);
    folderIds.push(folderId);
  }
  return folderIds;
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
    // Client-supplied intrinsic dimensions (naturalWidth/Height from the page).
    // Used as a fallback when the server decoder can't read the image format,
    // so the gallery masonry keeps the native aspect instead of a 1:1 square.
    const toPositiveInt = (value: unknown) =>
      typeof value === "number" && Number.isFinite(value) && value > 0
        ? Math.round(value)
        : undefined;
    const imageWidth = toPositiveInt(data.imageWidth);
    const imageHeight = toPositiveInt(data.imageHeight);
    // Collections are owner-scoped `folders` rows. `folderId` remains the
    // primary/back-compat field; `folderIds` can attach the asset to many.
    const folderIds = normalizeFolderIds(data);
    const folderId = folderIds[0];

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
    const tagKeys = new Set<string>();
    const addTagName = (value: string | undefined) => {
      const tagName = value?.trim();
      if (!tagName) return;

      const key = tagName.toLowerCase();
      if (tagKeys.has(key)) return;
      tagKeys.add(key);
      tagNames.push(tagName);
    };

    if (Array.isArray(data.tagNames)) {
      for (const t of data.tagNames) {
        if (typeof t === "string") addTagName(t);
      }
    }

    const sourcePlatformTag = inferPlatformTag(sourceUrl) ?? inferPlatformTag(imageUrl);
    if (sourcePlatformTag) addTagName(sourcePlatformTag);

    const sourceParts = getUrlParts(sourceUrl);
    const isMidjourneySave =
      isMidjourneyUrl(sourceUrl) ||
      isMidjourneyUrl(imageUrl) ||
      isMidjourneyModel(modelName) ||
      tagNames.some((tagName) => tagName.toLowerCase().startsWith("midjourney"));

    if (isMidjourneySave) {
      addTagName("midjourney");
      addTagName("midjourney-web");

      if (sourceParts?.pathname.includes("/explore")) {
        addTagName("midjourney-explore");
      }
      if (
        sourceParts?.pathname.includes("/personalize/") &&
        sourceParts.pathname.includes("/teach")
      ) {
        addTagName("midjourney-teach");
        addTagName("personalize");
      }
    }

    const effectiveModelName = isMidjourneySave ? "Midjourney" : modelName || undefined;
    const effectiveModelProvider = isMidjourneySave ? "midjourney" : undefined;

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
        modelName: effectiveModelName,
        modelProvider: effectiveModelProvider,
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
        modelName: effectiveModelName,
        modelProvider: effectiveModelProvider,
        domain: sourceUrl || undefined,
      });

      const assetResult = await client.action(updateAction, {
        ownerUserId,
        target: "asset",
        ingestKey,
        promptId: promptSeed.promptId ?? promptResult.promptId,
        tagNames,
        modelName: effectiveModelName,
        ...(folderId ? { folderId } : {}),
      });
      if (assetResult.assetId && folderIds.length > 1) {
        await client.mutation(addAssetFoldersMutation, {
          ownerUserId,
          assetId: assetResult.assetId,
          folderIds,
        });
      }

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
      modelName: effectiveModelName,
      modelProvider: effectiveModelProvider,
      folderId: folderId || undefined,
      mediaWidth: imageWidth,
      mediaHeight: imageHeight,
      generationType: "image_gen",
      assetRole: "inspiration_capture",
      ingestSource: "import",
      domain: sourceUrl || undefined,
    });
    if (result.assetId && folderIds.length > 1) {
      await client.mutation(addAssetFoldersMutation, {
        ownerUserId,
        assetId: result.assetId,
        folderIds,
      });
    }

    return corsJson({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return corsJson({ error: message }, 400);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
