import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";
import { buildIngestKey } from "@/lib/ingest";
import { getServerConvexClient } from "@/lib/server/convex";
import {
  resolveExtensionOwnerUserId,
  validateExtensionToken,
} from "@/lib/server/extension-auth";
import {
  collectionSectionLabel,
  normalizeCollectionSection,
} from "@/lib/collection-sections";

const ingestAction = makeFunctionReference<"action">("ingest:ingestFromApi");
const updateAction = makeFunctionReference<"action">("ingest:updateFromApi");
const addAssetFoldersMutation = makeFunctionReference<"mutation">(
  "assets:addAssetFolders",
);
const listFoldersQuery = makeFunctionReference<"query">("folders:listFolders");
const createFolderMutation = makeFunctionReference<"mutation">(
  "folders:createFolder",
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
  if (url.host.includes("higgsfield")) return "higgsfield";
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

type ExtensionFolder = {
  _id: string;
  name: string;
  kind?: string;
  parentFolderId?: string;
};

async function resolveCollectionPillarFolders(
  client: ReturnType<typeof getServerConvexClient>,
  ownerUserId: string,
  requestedFolderIds: string[],
  rawPillar: unknown,
) {
  const pillar =
    typeof rawPillar === "string"
      ? normalizeCollectionSection(rawPillar)
      : null;
  if (!pillar || requestedFolderIds.length === 0) {
    return requestedFolderIds;
  }

  const folders = (await client.query(listFoldersQuery, {
    ownerUserId,
  })) as ExtensionFolder[];
  const folderById = new Map(folders.map((folder) => [folder._id, folder]));
  const roots: ExtensionFolder[] = [];
  const seenRootIds = new Set<string>();

  for (const requestedFolderId of requestedFolderIds) {
    const requested = folderById.get(requestedFolderId);
    if (!requested || requested.kind) {
      continue;
    }
    const root = requested.parentFolderId
      ? folderById.get(requested.parentFolderId)
      : requested;
    if (!root || root.kind || root.parentFolderId || seenRootIds.has(root._id)) {
      continue;
    }
    seenRootIds.add(root._id);
    roots.push(root);
  }

  if (roots.length === 0) {
    return requestedFolderIds;
  }

  const label = collectionSectionLabel(pillar);
  const childFolderIds: string[] = [];
  for (const root of roots) {
    const existing = folders.find(
      (folder) =>
        !folder.kind &&
        folder.parentFolderId === root._id &&
        normalizeCollectionSection(folder.name) === pillar,
    );
    if (existing) {
      childFolderIds.push(existing._id);
      continue;
    }

    const result = (await client.mutation(createFolderMutation, {
      ownerUserId,
      name: label,
      parentFolderId: root._id,
    })) as { folderId: string };
    childFolderIds.push(result.folderId);
  }

  return [...roots.map((folder) => folder._id), ...childFolderIds];
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
    const mediaType = data.mediaType === "video" ? "video" : "image";
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
    const requestedFolderIds = normalizeFolderIds(data);
    const client = getServerConvexClient();
    const sourcePath = getUrlParts(sourceUrl)?.pathname ?? "";
    const inferredCollectionPillar =
      /\/profiles?(?:\/|$)/.test(sourcePath) ||
      (sourcePath.includes("/personalize/") && sourcePath.includes("/teach"))
        ? "inspirations"
        : undefined;
    const folderIds = await resolveCollectionPillarFolders(
      client,
      ownerUserId,
      requestedFolderIds,
      data.collectionPillar ?? inferredCollectionPillar,
    );
    const folderId = folderIds[0];

    // Accept base64 file data (for CDNs that block server-side fetch, e.g. Midjourney)
    let file: { base64: string; contentType?: string; fileName?: string } | undefined;
    if (data.file && typeof data.file.base64 === "string") {
      file = {
        base64: data.file.base64,
        contentType: typeof data.file.contentType === "string" ? data.file.contentType : undefined,
      };
    }
    const inputImages = Array.isArray(data.inputImages)
      ? data.inputImages.slice(0, 6).flatMap((value: unknown) => {
          if (!value || typeof value !== "object") return [];
          const input = value as Record<string, unknown>;
          const url = typeof input.url === "string" ? input.url.trim() : undefined;
          const rawFile =
            input.file && typeof input.file === "object"
              ? (input.file as Record<string, unknown>)
              : undefined;
          const inputFile =
            rawFile && typeof rawFile.base64 === "string"
              ? {
                  base64: rawFile.base64,
                  contentType:
                    typeof rawFile.contentType === "string"
                      ? rawFile.contentType
                      : undefined,
                }
              : undefined;
          if (!url && !inputFile) return [];
          return [{
            url,
            file: inputFile,
            role: typeof input.role === "string" ? input.role : undefined,
          }];
        })
      : [];

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
    const isHiggsfieldSave =
      sourceParts?.host.includes("higgsfield") ||
      getUrlParts(imageUrl)?.host.includes("higgsfield") ||
      modelName?.toLowerCase().includes("higgsfield") ||
      tagNames.some((tagName) => tagName.toLowerCase().startsWith("higgsfield"));

    if (isMidjourneySave) {
      addTagName("midjourney");
      addTagName("midjourney-web");

      if (sourceParts?.pathname.includes("/explore")) {
        addTagName("midjourney-explore");
      }
      if (/\/profiles?(?:\/|$)/.test(sourceParts?.pathname ?? "")) {
        addTagName("midjourney-profile");
      }
      if (
        sourceParts?.pathname.includes("/personalize/") &&
        sourceParts.pathname.includes("/teach")
      ) {
        addTagName("midjourney-teach");
        addTagName("personalize");
      }
    }
    if (isHiggsfieldSave) {
      addTagName("higgsfield");
      addTagName("higgsfield-web");
      addTagName("higgsfield-video");
    }

    const effectiveModelName = isMidjourneySave
      ? "Midjourney"
      : isHiggsfieldSave
        ? modelName || "Higgsfield"
        : modelName || undefined;
    const effectiveModelProvider = isMidjourneySave
      ? "midjourney"
      : isHiggsfieldSave
        ? "other"
        : undefined;
    const isVideoSave =
      mediaType === "video" ||
      file?.contentType?.toLowerCase().startsWith("video/") ||
      /\.(mp4|webm|mov)(?:[?#]|$)/i.test(imageUrl || "");
    const effectiveGenerationType = isVideoSave ? "video_gen" : "image_gen";

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

    const upstreamInputs = [];
    for (const [index, input] of inputImages.entries()) {
      const inputIngestKey =
        buildIngestKey({ url: input.url }) || `${ingestKey}:input:${index + 1}`;
      const inputResult = await client.action(ingestAction, {
        ownerUserId,
        url: input.url,
        file: input.file,
        ingestKey: inputIngestKey,
        tagNames: [...tagNames, "higgsfield-input"],
        modelName: effectiveModelName,
        modelProvider: effectiveModelProvider,
        folderId: folderId || undefined,
        generationType: "image_gen",
        assetRole: "reference",
        ingestSource: "import",
        domain: sourceUrl || undefined,
      });
      if (inputResult.assetId && folderIds.length > 1) {
        await client.mutation(addAssetFoldersMutation, {
          ownerUserId,
          assetId: inputResult.assetId,
          folderIds,
        });
      }
      const normalizedRole = input.role?.toLowerCase() || "";
      upstreamInputs.push({
        type: "asset" as const,
        ingestKey: inputIngestKey,
        role: normalizedRole.includes("start")
          ? "starting_image_asset" as const
          : normalizedRole.includes("motion")
            ? "motion_reference" as const
            : "style_reference" as const,
        stageOrder: index,
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
      generationType: effectiveGenerationType,
      promptType: isVideoSave ? "video_gen" : "image_gen",
      assetRole: isVideoSave ? "generated_output" : "inspiration_capture",
      ingestSource: "import",
      domain: sourceUrl || undefined,
      upstreamInputs: upstreamInputs.length > 0 ? upstreamInputs : undefined,
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
