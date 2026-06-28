"use node";

import { Jimp, JimpMime } from "jimp";
import { action, type ActionCtx } from "./_generated/server";
import { v, ConvexError, type Infer } from "convex/values";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { makeFunctionReference } from "convex/server";
import { storeBlobToR2 } from "./r2_store";
import {
  assetRoleValidator,
  designCaptureKindValidator,
  designSaveIntentValidator,
  designInspirationStatusValidator,
  designInspirationTypeValidator,
  designPlatformValidator,
  generationTypeValidator,
  ingestSourceValidator,
  lineageRoleValidator,
  modelProviderValidator,
  optionalPillarValidator,
  promptProfileValidator,
  promptSectionsValidator,
  promptTypeValidator,
  typedTagInputValidator,
  workflowTypeValidator,
} from "./validators";

type Pillar = string;
type PromptType = Infer<typeof promptTypeValidator>;
type GenerationType = Infer<typeof generationTypeValidator>;
type ModelProvider = Infer<typeof modelProviderValidator>;
type WorkflowType = Infer<typeof workflowTypeValidator>;
type PromptSections = Infer<typeof promptSectionsValidator>;
type PromptProfile = Infer<typeof promptProfileValidator>;
type AssetRole = Infer<typeof assetRoleValidator>;
type DesignCaptureKind = Infer<typeof designCaptureKindValidator>;
type DesignSaveIntent = Infer<typeof designSaveIntentValidator>;
type IngestSource = Infer<typeof ingestSourceValidator>;
type DesignInspirationType = Infer<typeof designInspirationTypeValidator>;
type DesignPlatform = Infer<typeof designPlatformValidator>;
type DesignInspirationStatus = Infer<typeof designInspirationStatusValidator>;
type TagCategory =
  | "model_name"
  | "style"
  | "content_type"
  | "platform"
  | "color"
  | "camera_angle"
  | "lighting"
  | "composition"
  | "car_make"
  | "car_model"
  | "car_angle"
  | "environment"
  | "design_style"
  | "design_type"
  | "workflow_type"
  | "component_type"
  | "custom";
type TagSource = "user" | "agent" | "system";

const pillarValidator = optionalPillarValidator;
const createDesignInspirationMutation = makeFunctionReference<"mutation">(
  "designInspirations:createDesignInspiration",
);
const getOrCreateTagsWithMetadataMutation = makeFunctionReference<"mutation">(
  "tags:getOrCreateTagsWithMetadata",
);

const upstreamInputValidator = v.object({
  type: v.union(v.literal("prompt"), v.literal("asset")),
  id: v.optional(v.union(v.id("prompts"), v.id("assets"))),
  ingestKey: v.optional(v.string()),
  role: lineageRoleValidator,
  stageOrder: v.optional(v.number()),
  notes: v.optional(v.string()),
});

type UpstreamInput = Infer<typeof upstreamInputValidator>;
type LineageRole = Infer<typeof lineageRoleValidator>;

const upsertLineageMutation = makeFunctionReference<"mutation">(
  "generationLineage:upsertLineage",
);

const designInspirationInputValidator = v.object({
  title: v.optional(v.string()),
  summary: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  sourceTitle: v.optional(v.string()),
  userNote: v.optional(v.string()),
  inspirationType: designInspirationTypeValidator,
  platform: designPlatformValidator,
  workflowType: workflowTypeValidator,
  captureKind: v.optional(designCaptureKindValidator),
  saveIntent: v.optional(designSaveIntentValidator),
  templateKey: v.optional(v.string()),
  sourceFingerprint: v.optional(v.string()),
  status: designInspirationStatusValidator,
  ingestKey: v.optional(v.string()),
});

const targetValidator = v.union(
  v.literal("prompt"),
  v.literal("asset"),
  v.literal("designInspiration"),
);

const updateArgsValidator = v.object({
  ownerUserId: v.string(),
  target: targetValidator,
  id: v.optional(v.union(v.id("prompts"), v.id("assets"), v.id("designInspirations"))),
  ingestKey: v.optional(v.string()),
  file: v.optional(
    v.object({
      base64: v.string(),
      fileName: v.optional(v.string()),
      contentType: v.optional(v.string()),
    }),
  ),
  url: v.optional(v.string()),
  assetIngestKey: v.optional(v.string()),
  promptText: v.optional(v.string()),
  tagNames: v.optional(v.array(v.string())),
  typedTags: v.optional(v.array(typedTagInputValidator)),
  folderId: v.optional(v.union(v.null(), v.id("folders"))),
  pillar: v.optional(v.union(v.null(), v.string())),
  promptType: v.optional(v.union(v.null(), v.string())),
  domain: v.optional(v.union(v.null(), v.string())),
  modelName: v.optional(v.union(v.null(), v.string())),
  description: v.optional(v.union(v.null(), v.string())),
  modelProvider: v.optional(v.union(v.null(), v.string())),
  workflowType: v.optional(v.union(v.null(), v.string())),
  promptSections: v.optional(v.union(v.null(), v.any())),
  promptProfile: v.optional(v.union(v.null(), v.any())),
  promptId: v.optional(v.union(v.null(), v.id("prompts"))),
  sourceUrl: v.optional(v.union(v.null(), v.string())),
  sourceTitle: v.optional(v.union(v.null(), v.string())),
  userNote: v.optional(v.union(v.null(), v.string())),
  fileName: v.optional(v.union(v.null(), v.string())),
  contentType: v.optional(v.union(v.null(), v.string())),
  generationType: v.optional(v.union(v.null(), v.string())),
  assetRole: v.optional(v.union(v.null(), v.string())),
  ingestSource: v.optional(v.union(v.null(), v.string())),
  title: v.optional(v.union(v.null(), v.string())),
  summary: v.optional(v.union(v.null(), v.string())),
  inspirationType: v.optional(v.union(v.null(), v.string())),
  platform: v.optional(v.union(v.null(), v.string())),
  captureKind: v.optional(v.union(v.null(), v.string())),
  saveIntent: v.optional(v.union(v.null(), v.string())),
  templateKey: v.optional(v.union(v.null(), v.string())),
  sourceFingerprint: v.optional(v.union(v.null(), v.string())),
  status: v.optional(v.union(v.null(), v.string())),
  assetId: v.optional(v.union(v.null(), v.id("assets"))),
});

const deleteArgsValidator = v.object({
  ownerUserId: v.string(),
  target: targetValidator,
  id: v.optional(v.union(v.id("prompts"), v.id("assets"), v.id("designInspirations"))),
  ingestKey: v.optional(v.string()),
});

const normalizeTags = (names: string[]) => {
  const cleaned = names
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  return Array.from(new Set(cleaned));
};

const guessTags = (promptText?: string, fileName?: string, url?: string) => {
  const haystack = [promptText, fileName, url].filter(Boolean).join(" ");
  if (!haystack) return [];

  const keywords = [
    "portrait",
    "neon",
    "cyberpunk",
    "studio",
    "cinematic",
    "film",
    "illustration",
    "anime",
    "fashion",
    "product",
  ];
  const lower = haystack.toLowerCase();
  return keywords.filter((word) => lower.includes(word));
};

const blobFromBase64 = (base64: string, contentType?: string) => {
  const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Blob([binary], { type: contentType || "application/octet-stream" });
};

const normalizeTypedTags = (
  tags: Array<{
    name: string;
    category?: TagCategory;
    pillar?: Pillar;
    source?: TagSource;
  }>,
) => {
  const seen = new Set<string>();
  const normalized = [];
  for (const tag of tags) {
    const name = tag.name.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      name,
      category: tag.category,
      pillar: tag.pillar,
      source: tag.source,
    });
  }
  return normalized;
};

const resolveTagIds = async (
  ctx: ActionCtx,
  input: {
    ownerUserId: string;
    pillar?: Pillar;
    tagNames?: string[];
    typedTags?: Array<{
      name: string;
      category?: TagCategory;
      pillar?: Pillar;
      source?: TagSource;
    }>;
  },
) => {
  const normalizedTagNames = normalizeTags(input.tagNames ?? []);
  const tagInputs = normalizeTypedTags([
    ...(input.typedTags ?? []),
    ...normalizedTagNames.map((name) => ({
      name,
      category: undefined,
      pillar: input.pillar,
      source: "user" as const,
    })),
  ]);

  if (tagInputs.length === 0) {
    return [] as Id<"tags">[];
  }

  return (await ctx.runMutation(getOrCreateTagsWithMetadataMutation, {
    tags: tagInputs,
  })) as Id<"tags">[];
};

const normalizeOptionalString = (value: string | null | undefined) => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const hasOwn = <T extends object>(value: T, key: PropertyKey) =>
  Object.prototype.hasOwnProperty.call(value, key);

const resolvePromptId = async (
  ctx: ActionCtx,
  ownerUserId: string,
  selector: { id?: Id<"prompts">; ingestKey?: string },
) => {
  if (selector.id) {
    const prompt = (await ctx.runQuery(api.prompts.getPrompt, {
      id: selector.id,
      ownerUserId,
    })) as { _id: Id<"prompts"> } | null;
    return prompt?._id;
  }

  const ingestKey = selector.ingestKey?.trim();
  if (!ingestKey) {
    return undefined;
  }

  return (await ctx.runQuery(internal.prompts.getPromptIdForIngestKey, {
    ownerUserId,
    ingestKey,
  })) as Id<"prompts"> | null;
};

const resolveAssetId = async (
  ctx: ActionCtx,
  ownerUserId: string,
  selector: { id?: Id<"assets">; ingestKey?: string },
) => {
  if (selector.id) {
    const asset = (await ctx.runQuery(api.assets.getAsset, {
      id: selector.id,
      ownerUserId,
    })) as { _id: Id<"assets"> } | null;
    return asset?._id;
  }

  const ingestKey = selector.ingestKey?.trim();
  if (!ingestKey) {
    return undefined;
  }

  return (await ctx.runQuery(internal.assets.getAssetIdForIngestKey, {
    ownerUserId,
    ingestKey,
  })) as Id<"assets"> | null;
};

const resolveDesignInspirationId = async (
  ctx: ActionCtx,
  ownerUserId: string,
  selector: { id?: Id<"designInspirations">; ingestKey?: string },
) => {
  if (selector.id) {
    const designInspiration = (await ctx.runQuery(
      api.designInspirations.getDesignInspiration,
      {
        id: selector.id,
        ownerUserId,
      },
    )) as { _id: Id<"designInspirations"> } | null;
    return designInspiration?._id;
  }

  const ingestKey = selector.ingestKey?.trim();
  if (!ingestKey) {
    return undefined;
  }

  return (await ctx.runQuery(
    internal.designInspirations.getDesignInspirationIdForIngestKey,
    {
      ownerUserId,
      ingestKey,
    },
  )) as Id<"designInspirations"> | null;
};

const applyUpstreamInputs = async (
  ctx: ActionCtx,
  params: {
    ownerUserId: string;
    upstreamInputs: UpstreamInput[];
    targetAssetId?: Id<"assets">;
    targetPromptId?: Id<"prompts">;
  },
) => {
  if (!params.targetAssetId && !params.targetPromptId) {
    throw new ConvexError(
      "Cannot attach upstreamInputs without a created prompt or asset.",
    );
  }

  for (const input of params.upstreamInputs) {
    let sourcePromptId: Id<"prompts"> | undefined;
    let sourceAssetId: Id<"assets"> | undefined;

    if (input.type === "prompt") {
      sourcePromptId = (await resolvePromptId(ctx, params.ownerUserId, {
        id: input.id as Id<"prompts"> | undefined,
        ingestKey: input.ingestKey,
      })) ?? undefined;
      if (!sourcePromptId) {
        throw new ConvexError(
          `Upstream prompt not found (id=${input.id ?? ""}, ingestKey=${input.ingestKey ?? ""}).`,
        );
      }
    } else {
      sourceAssetId = (await resolveAssetId(ctx, params.ownerUserId, {
        id: input.id as Id<"assets"> | undefined,
        ingestKey: input.ingestKey,
      })) ?? undefined;
      if (!sourceAssetId) {
        throw new ConvexError(
          `Upstream asset not found (id=${input.id ?? ""}, ingestKey=${input.ingestKey ?? ""}).`,
        );
      }
    }

    const targetAssetId = params.targetAssetId;
    const targetPromptId = params.targetAssetId ? undefined : params.targetPromptId;

    await ctx.runMutation(upsertLineageMutation, {
      ownerUserId: params.ownerUserId,
      targetAssetId,
      targetPromptId,
      sourcePromptId,
      sourceAssetId,
      role: input.role as LineageRole,
      stageOrder: input.stageOrder,
      notes: input.notes,
    });
  }
};

type ProcessedMedia = {
  storageId?: Id<"_storage">;
  thumbStorageId?: Id<"_storage">;
  r2Key?: string;
  thumbR2Key?: string;
  kind: "image" | "video";
  contentType: string;
  fileName?: string;
  size: number;
  width?: number;
  height?: number;
  thumbSize?: number;
  thumbWidth?: number;
  thumbHeight?: number;
};

const processMediaInput = async (
  ctx: ActionCtx,
  input: {
    file?: { base64: string; fileName?: string; contentType?: string };
    url?: string;
  },
): Promise<ProcessedMedia> => {
  let blob: Blob | null = null;
  const fileName = input.file?.fileName;
  let contentType = input.file?.contentType;

  if (input.file) {
    blob = blobFromBase64(input.file.base64, contentType);
  } else if (input.url) {
    const response = await fetch(input.url);
    if (!response.ok) {
      throw new ConvexError("Failed to fetch remote media.");
    }
    contentType = response.headers.get("content-type") || undefined;
    blob = await response.blob();
  }

  if (!blob) {
    throw new ConvexError("No media available for processing.");
  }

  const arrayBuffer = await blob.arrayBuffer();
  const fileBuffer = Buffer.from(arrayBuffer);
  const normalizedContentType = contentType ?? "application/octet-stream";

  let thumbStorageId: Id<"_storage"> | undefined;
  let thumbR2Key: string | undefined;
  let thumbSize: number | undefined;
  let thumbWidth: number | undefined;
  let thumbHeight: number | undefined;
  let width: number | undefined;
  let height: number | undefined;

  if (normalizedContentType.startsWith("image/")) {
    try {
      const originalImage = await Jimp.read(fileBuffer);
      width = originalImage.bitmap.width ?? undefined;
      height = originalImage.bitmap.height ?? undefined;

      const thumbWidthTarget = 420;
      const generatedThumbHeight =
        width && height
          ? Math.max(1, Math.round((thumbWidthTarget * height) / width))
          : thumbWidthTarget;
      const thumb = originalImage
        .clone()
        .resize({ w: thumbWidthTarget, h: generatedThumbHeight });
      const thumbMime =
        normalizedContentType.includes("png") &&
        normalizedContentType !== "image/jpeg"
          ? JimpMime.png
          : JimpMime.jpeg;
      const thumbBuffer = await thumb.getBuffer(thumbMime);
      thumbWidth = thumb.bitmap.width ?? undefined;
      thumbHeight = thumb.bitmap.height ?? undefined;
      thumbSize = thumbBuffer.byteLength;
      const thumbArrayBuffer = (thumbBuffer.buffer.slice(
        thumbBuffer.byteOffset,
        thumbBuffer.byteOffset + thumbBuffer.byteLength,
      ) as ArrayBuffer);
      const thumbBlob = new Blob([thumbArrayBuffer], { type: thumbMime });
      thumbR2Key = await storeBlobToR2(ctx, thumbBlob, { type: thumbMime });
    } catch (error) {
      console.warn("Thumbnail generation failed:", error);
    }
  }

  const storageBlob = new Blob([fileBuffer], { type: normalizedContentType });
  const r2Key = await storeBlobToR2(ctx, storageBlob, {
    type: normalizedContentType,
  });

  return {
    storageId: undefined,
    thumbStorageId,
    r2Key,
    thumbR2Key,
    kind: normalizedContentType.startsWith("video/") ? "video" : "image",
    contentType: normalizedContentType,
    fileName,
    size: storageBlob.size,
    width,
    height,
    thumbSize,
    thumbWidth,
    thumbHeight,
  };
};

export const ingestFromApi: ReturnType<typeof action> = action({
  args: {
    ownerUserId: v.string(),
    promptText: v.optional(v.string()),
    allowPromptOnly: v.optional(v.boolean()),
    url: v.optional(v.string()),
    file: v.optional(
      v.object({
        base64: v.string(),
        fileName: v.optional(v.string()),
        contentType: v.optional(v.string()),
      }),
    ),
    tagNames: v.optional(v.array(v.string())),
    typedTags: v.optional(v.array(typedTagInputValidator)),
    folderId: v.optional(v.id("folders")),
    ingestKey: v.optional(v.string()),
    promptIngestKey: v.optional(v.string()),
    modelName: v.optional(v.string()),
    description: v.optional(v.string()),
    modelProvider: modelProviderValidator,
    pillar: pillarValidator,
    generationType: generationTypeValidator,
    promptType: promptTypeValidator,
    workflowType: workflowTypeValidator,
    promptSections: promptSectionsValidator,
    promptProfile: promptProfileValidator,
    assetRole: assetRoleValidator,
    ingestSource: ingestSourceValidator,
    designInspiration: v.optional(designInspirationInputValidator),
    domain: v.optional(v.string()),
    upstreamInputs: v.optional(v.array(upstreamInputValidator)),
    r2Key: v.optional(v.string()),
    r2Bucket: v.optional(v.string()),
    mediaContentType: v.optional(v.string()),
    mediaSize: v.optional(v.number()),
    mediaWidth: v.optional(v.number()),
    mediaHeight: v.optional(v.number()),
    mediaFileName: v.optional(v.string()),
    posterFile: v.optional(
      v.object({
        base64: v.string(),
        contentType: v.optional(v.string()),
        width: v.optional(v.number()),
        height: v.optional(v.number()),
        size: v.optional(v.number()),
      }),
    ),
  },
  returns: v.object({
    assetId: v.optional(v.id("assets")),
    promptId: v.optional(v.id("prompts")),
    designInspirationId: v.optional(v.id("designInspirations")),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    assetId?: Id<"assets">;
    promptId?: Id<"prompts">;
    designInspirationId?: Id<"designInspirations">;
  }> => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const promptText = args.promptText?.trim() || undefined;
    const resolvedPromptText = promptText || args.promptSections?.finalPrompt.trim() || undefined;
    const hasMediaInput = Boolean(args.url || args.file || args.r2Key);
    const hasDesignInspirationInput = Boolean(args.designInspiration);
    const isPromptOnlyIngest =
      Boolean(resolvedPromptText) &&
      !hasMediaInput &&
      !hasDesignInspirationInput;

    if (!resolvedPromptText && !hasMediaInput && !hasDesignInspirationInput) {
      throw new ConvexError("Provide prompt content, URL, file, or design inspiration.");
    }
    if (isPromptOnlyIngest && args.allowPromptOnly !== true) {
      throw new ConvexError(
        "Prompt-only ingest requires allowPromptOnly=true.",
      );
    }

    const inferredTagNames = normalizeTags([
      ...(args.tagNames ?? []),
      ...guessTags(resolvedPromptText, args.file?.fileName, args.url),
    ]);
    const tagInputs = normalizeTypedTags([
      ...(args.typedTags ?? []),
      ...inferredTagNames.map((name) => ({
        name,
        category: undefined,
        pillar: args.pillar,
        source: "user" as const,
      })),
    ]);
    const tagIds: Id<"tags">[] = tagInputs.length
      ? ((await ctx.runMutation(getOrCreateTagsWithMetadataMutation, {
          tags: tagInputs,
        })) as Id<"tags">[])
      : [];

    let promptCreated = true;
    let promptId: Id<"prompts"> | undefined;
    let assetCreated = true;
    let assetId: Id<"assets"> | undefined;
    let designInspirationCreated = true;
    let designInspirationId: Id<"designInspirations"> | undefined;

    try {
      const promptResult: { promptId: Id<"prompts">; created: boolean } | undefined = resolvedPromptText
        ? ((await ctx.runMutation(api.prompts.createPrompt, {
            ownerUserId,
            text: resolvedPromptText,
            tagIds,
            folderId: args.folderId,
            ingestKey: args.promptIngestKey ?? args.ingestKey,
            pillar: args.pillar,
            promptType: args.promptType,
            workflowType: args.workflowType,
            domain: args.domain,
            modelName: args.modelName,
            modelProvider: args.modelProvider,
            promptSections: args.promptSections,
            promptProfile: args.promptProfile,
          })) as { promptId: Id<"prompts">; created: boolean })
        : undefined;
      promptId = promptResult?.promptId;
      if (promptResult) {
        promptCreated = promptResult.created;
      }

      if (hasMediaInput) {
        let kind: "image" | "video";
        let storageId: Id<"_storage"> | undefined;
        let thumbStorageId: Id<"_storage"> | undefined;
        let thumbR2Key: string | undefined;
        let contentType: string | undefined;
        let size: number | undefined;
        let width: number | undefined;
        let height: number | undefined;
        let thumbSize: number | undefined;
        let thumbWidth: number | undefined;
        let thumbHeight: number | undefined;
        let fileName: string | undefined;
        let r2KeyForRow: string | undefined;
        let r2BucketForRow: string | undefined;

        if (args.r2Key) {
          // R2-hosted media: bytes already live in Cloudflare R2 and were
          // uploaded directly from the browser. A poster/thumbnail, when
          // supplied, is also stored on R2 so gallery cards avoid Convex
          // storage URLs on the hot path.
          kind = (args.mediaContentType ?? "video/").startsWith("image/")
            ? "image"
            : "video";
          contentType = args.mediaContentType;
          size = args.mediaSize;
          width = args.mediaWidth;
          height = args.mediaHeight;
          fileName = args.mediaFileName ?? args.r2Key.split("/").pop();
          r2KeyForRow = args.r2Key;
          r2BucketForRow = args.r2Bucket;

          if (args.posterFile) {
            const posterBuffer = Buffer.from(args.posterFile.base64, "base64");
            const posterBlob = new Blob([new Uint8Array(posterBuffer)], {
              type: args.posterFile.contentType ?? "image/jpeg",
            });
            thumbR2Key = await storeBlobToR2(ctx, posterBlob, {
              type: args.posterFile.contentType ?? "image/jpeg",
            });
            thumbSize = args.posterFile.size ?? posterBuffer.byteLength;
            thumbWidth = args.posterFile.width;
            thumbHeight = args.posterFile.height;
          }
        } else {
          const media = await processMediaInput(ctx, {
            file: args.file,
            url: args.url,
          });
          kind = media.kind;
          storageId = media.storageId;
          thumbStorageId = media.thumbStorageId;
          r2KeyForRow = media.r2Key;
          thumbR2Key = media.thumbR2Key;
          contentType = media.contentType;
          size = media.size;
          // Prefer dimensions decoded server-side; fall back to client-supplied
          // hints (e.g. naturalWidth/Height from the extension) when the decoder
          // can't read the format (some webp/avif). Without dims the masonry
          // slot falls back to a 1:1 square and object-cover crops the image.
          width = media.width ?? args.mediaWidth;
          height = media.height ?? args.mediaHeight;
          thumbSize = media.thumbSize;
          thumbWidth = media.thumbWidth;
          thumbHeight = media.thumbHeight;
          fileName = media.fileName;
        }

        const result = (await ctx.runMutation(api.assets.createAsset, {
          ownerUserId,
          kind,
          storageId,
          thumbStorageId,
          r2Key: r2KeyForRow,
          r2Bucket: r2BucketForRow,
          thumbR2Key,
          thumbR2Bucket: r2BucketForRow,
          sourceUrl: args.url,
          fileName,
          description: args.description,
          contentType,
          size,
          width,
          height,
          thumbSize,
          thumbWidth,
          thumbHeight,
          promptId,
          tagIds,
          folderId: args.folderId,
          ingestKey: args.ingestKey,
          modelName: args.modelName,
          pillar: args.pillar,
          generationType: args.generationType,
          assetRole: args.assetRole,
          ingestSource: args.ingestSource ?? "api",
        })) as { assetId: Id<"assets">; created: boolean };
        assetId = result.assetId;
        assetCreated = result.created;
      }

      if (args.designInspiration) {
        const result = (await ctx.runMutation(createDesignInspirationMutation, {
          ownerUserId,
          title: args.designInspiration.title,
          summary: args.designInspiration.summary,
          sourceUrl: args.designInspiration.sourceUrl ?? args.url,
          sourceTitle: args.designInspiration.sourceTitle,
          userNote: args.designInspiration.userNote,
          inspirationType: args.designInspiration.inspirationType,
          platform: args.designInspiration.platform,
          workflowType: args.designInspiration.workflowType ?? args.workflowType,
          captureKind: args.designInspiration.captureKind,
          saveIntent: args.designInspiration.saveIntent,
          templateKey: args.designInspiration.templateKey,
          sourceFingerprint: args.designInspiration.sourceFingerprint,
          status: args.designInspiration.status,
          tagIds,
          folderId: args.folderId,
          ingestKey: args.designInspiration.ingestKey ?? args.ingestKey,
          assetId,
          promptId,
        })) as { designInspirationId: Id<"designInspirations">; created: boolean };
        designInspirationId = result.designInspirationId;
        designInspirationCreated = result.created;
      }
    } catch (error) {
      const shouldRollbackPrompt =
        promptCreated &&
        Boolean(promptId) &&
        !assetId &&
        !designInspirationId &&
        (hasMediaInput || hasDesignInspirationInput);

      if (shouldRollbackPrompt && promptId) {
        await ctx.runMutation(internal.prompts.deletePrompt, { id: promptId });
      }

      throw error;
    }

    if (args.upstreamInputs && args.upstreamInputs.length > 0) {
      await applyUpstreamInputs(ctx, {
        ownerUserId,
        upstreamInputs: args.upstreamInputs,
        targetAssetId: assetId,
        targetPromptId: promptId,
      });
    }

    const ingestKeyDuplicate = Boolean(args.ingestKey && !assetCreated);
    const promptIngestKeyDuplicate = Boolean((args.promptIngestKey ?? args.ingestKey) && !promptCreated);
    const inspirationIngestKeyDuplicate = Boolean(
      (args.designInspiration?.ingestKey ?? args.ingestKey) && !designInspirationCreated,
    );
    await ctx.scheduler.runAfter(0, internal.notifications.notifyKBIngest, {
      ownerUserId,
      pillar: args.pillar ?? (args.designInspiration ? "designs" : "dump"),
      promptText: resolvedPromptText ?? args.designInspiration?.title,
      modelName: args.modelName,
      tagNames: tagInputs.map((tag) => tag.name),
      assetId,
      promptId,
      isDuplicate:
        ingestKeyDuplicate || promptIngestKeyDuplicate || inspirationIngestKeyDuplicate,
    });
    return {
      assetId,
      promptId,
      designInspirationId,
    };
  },
});

export const updateFromApi: ReturnType<typeof action> = action({
  args: updateArgsValidator,
  returns: v.object({
    target: targetValidator,
    promptId: v.optional(v.id("prompts")),
    assetId: v.optional(v.id("assets")),
    designInspirationId: v.optional(v.id("designInspirations")),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    if (args.target === "prompt") {
      const promptId = await resolvePromptId(ctx, ownerUserId, {
        id: args.id as Id<"prompts"> | undefined,
        ingestKey: args.ingestKey,
      });
      if (!promptId) {
        throw new ConvexError("Prompt not found.");
      }

      const existing = await ctx.runQuery(api.prompts.getPrompt, {
        id: promptId,
        ownerUserId,
      });
      if (!existing) {
        throw new ConvexError("Prompt not found.");
      }

      const nextPillar =
        hasOwn(args, "pillar") ? (args.pillar ?? undefined) : existing.pillar;
      const shouldReplaceTags = args.tagNames !== undefined || args.typedTags !== undefined;
      const tagIds = shouldReplaceTags
        ? await resolveTagIds(ctx, {
            ownerUserId,
            pillar: nextPillar as Pillar | undefined,
            tagNames: args.tagNames ?? [],
            typedTags: args.typedTags,
          })
        : existing.tagIds;

      const nextPromptSections =
        hasOwn(args, "promptSections")
          ? (args.promptSections ?? undefined)
          : existing.promptSections;
      const nextText =
        args.promptText?.trim() ||
        nextPromptSections?.finalPrompt.trim() ||
        existing.text;

      const updatedPromptId = (await ctx.runMutation(api.prompts.updatePrompt, {
        ownerUserId,
        id: promptId,
        text: nextText,
        tagIds,
        folderId:
          hasOwn(args, "folderId") ? (args.folderId ?? undefined) : existing.folderId,
        pillar: nextPillar as Pillar | undefined,
        promptType:
          hasOwn(args, "promptType")
            ? ((args.promptType ?? undefined) as PromptType)
            : existing.promptType,
        domain:
          hasOwn(args, "domain") ? normalizeOptionalString(args.domain) : existing.domain,
        modelName:
          hasOwn(args, "modelName")
            ? normalizeOptionalString(args.modelName)
            : existing.modelName,
        modelProvider:
          hasOwn(args, "modelProvider")
            ? ((args.modelProvider ?? undefined) as ModelProvider)
            : existing.modelProvider,
        workflowType:
          hasOwn(args, "workflowType")
            ? ((args.workflowType ?? undefined) as WorkflowType)
            : existing.workflowType,
        promptSections: nextPromptSections as PromptSections,
        promptProfile:
          hasOwn(args, "promptProfile")
            ? ((args.promptProfile ?? undefined) as PromptProfile)
            : existing.promptProfile,
      })) as Id<"prompts">;

      const hasMediaInput = Boolean(args.file || args.url);
      if (hasMediaInput) {
        const media = await processMediaInput(ctx, { file: args.file, url: args.url });
        const assetIngestKey = args.assetIngestKey ??
          (args.ingestKey ? `${args.ingestKey}:img` : undefined);

        let resolvedAssetId: Id<"assets"> | null | undefined;
        if (assetIngestKey) {
          resolvedAssetId = await resolveAssetId(ctx, ownerUserId, {
            ingestKey: assetIngestKey,
          });
        }

        let assetId: Id<"assets">;
        if (resolvedAssetId) {
          await ctx.runMutation(api.assets.replaceAssetMedia, {
            ownerUserId,
            assetId: resolvedAssetId,
            storageId: media.storageId,
            thumbStorageId: media.thumbStorageId,
            r2Key: media.r2Key,
            thumbR2Key: media.thumbR2Key,
            kind: media.kind,
            contentType: media.contentType,
            fileName: media.fileName,
            size: media.size,
            width: media.width,
            height: media.height,
            thumbSize: media.thumbSize,
            thumbWidth: media.thumbWidth,
            thumbHeight: media.thumbHeight,
          });
          assetId = resolvedAssetId;
        } else {
          const createResult = (await ctx.runMutation(api.assets.createAsset, {
            ownerUserId,
            kind: media.kind,
            storageId: media.storageId,
            thumbStorageId: media.thumbStorageId,
            r2Key: media.r2Key,
            thumbR2Key: media.thumbR2Key,
            sourceUrl: args.url,
            fileName: media.fileName,
            description: hasOwn(args, "description")
              ? normalizeOptionalString(args.description)
              : undefined,
            contentType: media.contentType,
            size: media.size,
            width: media.width,
            height: media.height,
            thumbSize: media.thumbSize,
            thumbWidth: media.thumbWidth,
            thumbHeight: media.thumbHeight,
            promptId: updatedPromptId,
            tagIds,
            folderId:
              hasOwn(args, "folderId") ? (args.folderId ?? undefined) : existing.folderId,
            ingestKey: assetIngestKey,
            modelName:
              hasOwn(args, "modelName")
                ? normalizeOptionalString(args.modelName)
                : existing.modelName,
            pillar: nextPillar as Pillar | undefined,
            generationType:
              hasOwn(args, "generationType")
                ? ((args.generationType ?? undefined) as GenerationType)
                : (existing.promptType as GenerationType | undefined),
            assetRole:
              hasOwn(args, "assetRole")
                ? ((args.assetRole ?? undefined) as AssetRole)
                : ("generated_output" as AssetRole),
            ingestSource:
              hasOwn(args, "ingestSource")
                ? ((args.ingestSource ?? undefined) as IngestSource)
                : ("api" as IngestSource),
          })) as { assetId: Id<"assets">; created: boolean };
          assetId = createResult.assetId;
        }

        return {
          target: "prompt" as const,
          promptId: updatedPromptId,
          assetId,
        };
      }

      return {
        target: "prompt" as const,
        promptId: updatedPromptId,
      };
    }

    if (args.target === "asset") {
      const assetId = await resolveAssetId(ctx, ownerUserId, {
        id: args.id as Id<"assets"> | undefined,
        ingestKey: args.ingestKey,
      });
      if (!assetId) {
        throw new ConvexError("Asset not found.");
      }

      const existing = await ctx.runQuery(api.assets.getAsset, {
        id: assetId,
        ownerUserId,
      });
      if (!existing) {
        throw new ConvexError("Asset not found.");
      }

      const nextPillar =
        hasOwn(args, "pillar") ? (args.pillar ?? undefined) : existing.pillar;
      const shouldReplaceTags = args.tagNames !== undefined || args.typedTags !== undefined;
      const tagIds = shouldReplaceTags
        ? await resolveTagIds(ctx, {
            ownerUserId,
            pillar: nextPillar as Pillar | undefined,
            tagNames: args.tagNames ?? [],
            typedTags: args.typedTags,
          })
        : existing.tagIds;

      const updatedAssetId = (await ctx.runMutation(api.assets.updateAssetMetadata, {
        ownerUserId,
        assetId,
        tagIds,
        folderId:
          hasOwn(args, "folderId") ? (args.folderId ?? undefined) : existing.folderId,
        promptId:
          hasOwn(args, "promptId") ? (args.promptId ?? undefined) : existing.promptId,
        sourceUrl:
          hasOwn(args, "sourceUrl")
            ? normalizeOptionalString(args.sourceUrl)
            : existing.sourceUrl,
        fileName:
          hasOwn(args, "fileName")
            ? normalizeOptionalString(args.fileName)
            : existing.fileName,
        contentType:
          hasOwn(args, "contentType")
            ? normalizeOptionalString(args.contentType)
            : existing.contentType,
        description:
          hasOwn(args, "description")
            ? normalizeOptionalString(args.description)
            : existing.description,
        modelName:
          hasOwn(args, "modelName")
            ? normalizeOptionalString(args.modelName)
            : existing.modelName,
        pillar: nextPillar as Pillar | undefined,
        generationType:
          hasOwn(args, "generationType")
            ? ((args.generationType ?? undefined) as GenerationType)
            : existing.generationType,
        assetRole:
          hasOwn(args, "assetRole")
            ? ((args.assetRole ?? undefined) as AssetRole)
            : existing.assetRole,
        ingestSource:
          hasOwn(args, "ingestSource")
            ? ((args.ingestSource ?? undefined) as IngestSource)
            : existing.ingestSource,
      })) as Id<"assets">;

      const hasMediaInput = Boolean(args.file || args.url);
      if (hasMediaInput) {
        const media = await processMediaInput(ctx, { file: args.file, url: args.url });
        await ctx.runMutation(api.assets.replaceAssetMedia, {
          ownerUserId,
          assetId,
          storageId: media.storageId,
          thumbStorageId: media.thumbStorageId,
          r2Key: media.r2Key,
          thumbR2Key: media.thumbR2Key,
          kind: media.kind,
          contentType: media.contentType,
          fileName: media.fileName,
          size: media.size,
          width: media.width,
          height: media.height,
          thumbSize: media.thumbSize,
          thumbWidth: media.thumbWidth,
          thumbHeight: media.thumbHeight,
        });
      }

      return {
        target: "asset" as const,
        assetId: updatedAssetId,
      };
    }

    const designInspirationId = await resolveDesignInspirationId(ctx, ownerUserId, {
      id: args.id as Id<"designInspirations"> | undefined,
      ingestKey: args.ingestKey,
    });
    if (!designInspirationId) {
      throw new ConvexError("Design inspiration not found.");
    }

    const existing = await ctx.runQuery(api.designInspirations.getDesignInspiration, {
      id: designInspirationId,
      ownerUserId,
    });
    if (!existing) {
      throw new ConvexError("Design inspiration not found.");
    }

    const shouldReplaceTags = args.tagNames !== undefined || args.typedTags !== undefined;
    const tagIds = shouldReplaceTags
      ? await resolveTagIds(ctx, {
          ownerUserId,
          pillar: "designs",
          tagNames: args.tagNames ?? [],
          typedTags: args.typedTags,
        })
      : existing.tagIds;

    const updatedDesignInspirationId = (await ctx.runMutation(
      api.designInspirations.updateDesignInspiration,
      {
        ownerUserId,
        id: designInspirationId,
        title: hasOwn(args, "title") ? normalizeOptionalString(args.title) : existing.title,
        summary: hasOwn(args, "summary")
          ? normalizeOptionalString(args.summary)
          : existing.summary,
        sourceUrl: hasOwn(args, "sourceUrl")
          ? normalizeOptionalString(args.sourceUrl)
          : existing.sourceUrl,
        sourceTitle: hasOwn(args, "sourceTitle")
          ? normalizeOptionalString(args.sourceTitle)
          : existing.sourceTitle,
        userNote: hasOwn(args, "userNote")
          ? normalizeOptionalString(args.userNote)
          : existing.userNote,
        inspirationType:
          hasOwn(args, "inspirationType")
            ? ((args.inspirationType ?? existing.inspirationType) as DesignInspirationType)
            : existing.inspirationType,
        platform:
          hasOwn(args, "platform")
            ? ((args.platform ?? undefined) as DesignPlatform)
            : existing.platform,
        workflowType:
          hasOwn(args, "workflowType")
            ? ((args.workflowType ?? undefined) as WorkflowType)
            : existing.workflowType,
        captureKind:
          hasOwn(args, "captureKind")
            ? ((args.captureKind ?? undefined) as DesignCaptureKind)
            : existing.captureKind,
        saveIntent:
          hasOwn(args, "saveIntent")
            ? ((args.saveIntent ?? undefined) as DesignSaveIntent)
            : existing.saveIntent,
        templateKey: hasOwn(args, "templateKey")
          ? normalizeOptionalString(args.templateKey)
          : existing.templateKey,
        sourceFingerprint: hasOwn(args, "sourceFingerprint")
          ? normalizeOptionalString(args.sourceFingerprint)
          : existing.sourceFingerprint,
        status: hasOwn(args, "status")
          ? ((args.status ?? undefined) as DesignInspirationStatus)
          : existing.status,
        tagIds,
        folderId:
          hasOwn(args, "folderId") ? (args.folderId ?? undefined) : existing.folderId,
        assetId: hasOwn(args, "assetId") ? (args.assetId ?? undefined) : existing.assetId,
        promptId:
          hasOwn(args, "promptId") ? (args.promptId ?? undefined) : existing.promptId,
      },
    )) as Id<"designInspirations">;

    return {
      target: "designInspiration" as const,
      designInspirationId: updatedDesignInspirationId,
    };
  },
});

export const deleteFromApi: ReturnType<typeof action> = action({
  args: deleteArgsValidator,
  returns: v.object({
    target: targetValidator,
    deleted: v.boolean(),
    promptId: v.optional(v.id("prompts")),
    assetId: v.optional(v.id("assets")),
    designInspirationId: v.optional(v.id("designInspirations")),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    if (args.target === "prompt") {
      const promptId = await resolvePromptId(ctx, ownerUserId, {
        id: args.id as Id<"prompts"> | undefined,
        ingestKey: args.ingestKey,
      });
      if (!promptId) {
        return { target: "prompt" as const, deleted: false };
      }

      await ctx.runMutation(internal.prompts.deletePrompt, { id: promptId });
      return {
        target: "prompt" as const,
        deleted: true,
        promptId,
      };
    }

    if (args.target === "asset") {
      const assetId = await resolveAssetId(ctx, ownerUserId, {
        id: args.id as Id<"assets"> | undefined,
        ingestKey: args.ingestKey,
      });
      if (!assetId) {
        return { target: "asset" as const, deleted: false };
      }

      await ctx.runMutation(internal.assets.internalDeleteAsset, {
        id: assetId,
      });
      return {
        target: "asset" as const,
        deleted: true,
        assetId,
      };
    }

    const designInspirationId = await resolveDesignInspirationId(ctx, ownerUserId, {
      id: args.id as Id<"designInspirations"> | undefined,
      ingestKey: args.ingestKey,
    });
    if (!designInspirationId) {
      return { target: "designInspiration" as const, deleted: false };
    }

    await ctx.runMutation(api.designInspirations.deleteDesignInspiration, {
      id: designInspirationId,
      ownerUserId,
    });
    return {
      target: "designInspiration" as const,
      deleted: true,
      designInspirationId,
    };
  },
});
