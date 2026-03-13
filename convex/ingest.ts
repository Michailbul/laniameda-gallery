"use node";

import { Jimp, JimpMime } from "jimp";
import { action } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { makeFunctionReference } from "convex/server";
import {
  assetRoleValidator,
  designInspirationTypeValidator,
  designPlatformValidator,
  generationTypeValidator,
  ingestSourceValidator,
  modelProviderValidator,
  optionalPillarValidator,
  promptProfileValidator,
  promptSectionsValidator,
  promptTypeValidator,
  typedTagInputValidator,
  workflowTypeValidator,
} from "./validators";

type Pillar = "creators" | "cars" | "designs" | "dump";
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

const designInspirationInputValidator = v.object({
  title: v.optional(v.string()),
  summary: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  inspirationType: designInspirationTypeValidator,
  platform: designPlatformValidator,
  workflowType: workflowTypeValidator,
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

export const ingestFromApi: ReturnType<typeof action> = action({
  args: {
    ownerUserId: v.string(),
    promptText: v.optional(v.string()),
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
    if (!resolvedPromptText && !args.url && !args.file && !args.designInspiration) {
      throw new ConvexError("Provide prompt content, URL, file, or design inspiration.");
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
    const promptId: Id<"prompts"> | undefined = promptResult?.promptId;
    if (promptResult) {
      promptCreated = promptResult.created;
    }

    let assetCreated = true;
    let assetId: Id<"assets"> | undefined;
    if (args.url || args.file) {
      let blob: Blob | null = null;
      const fileName = args.file?.fileName;
      let contentType = args.file?.contentType;
      const sourceUrl = args.url;

      if (args.file) {
        blob = blobFromBase64(args.file.base64, contentType);
      } else if (args.url) {
        const response = await fetch(args.url);
        if (!response.ok) {
          throw new ConvexError("Failed to fetch remote media.");
        }
        contentType = response.headers.get("content-type") || undefined;
        blob = await response.blob();
      }

      if (!blob) {
        throw new ConvexError("No media available for ingestion.");
      }

      const arrayBuffer = await blob.arrayBuffer();
      const fileBuffer = Buffer.from(arrayBuffer);
      const normalizedContentType = contentType ?? "application/octet-stream";

      let thumbStorageId: Id<"_storage"> | undefined;
      let thumbSize: number | undefined;
      let thumbWidth: number | undefined;
      let thumbHeight: number | undefined;
      let width: number | undefined;
      let height: number | undefined;

      const shouldGenerateThumb = normalizedContentType.startsWith("image/");
      if (shouldGenerateThumb) {
        try {
          const originalImage = await Jimp.read(fileBuffer);
          const originalWidth = originalImage.bitmap.width;
          const originalHeight = originalImage.bitmap.height;
          width = originalWidth ?? undefined;
          height = originalHeight ?? undefined;

          const generatedThumbHeight =
            originalWidth && originalHeight
              ? Math.max(1, Math.round((520 * originalHeight) / originalWidth))
              : 520;
          const thumb = originalImage
            .clone()
            .resize({ w: 520, h: generatedThumbHeight });
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
          thumbStorageId = await ctx.storage.store(thumbBlob);
        } catch (error) {
          console.warn("Thumbnail generation failed during ingest:", error);
        }
      }

      const storageBlob = new Blob([fileBuffer], { type: normalizedContentType });
      const storageId = await ctx.storage.store(storageBlob);
      const result = (await ctx.runMutation(api.assets.createAsset, {
        ownerUserId,
        kind: normalizedContentType.startsWith("video/") ? "video" : "image",
        storageId,
        thumbStorageId,
        sourceUrl,
        fileName,
        contentType: normalizedContentType,
        size: storageBlob.size,
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

    let designInspirationCreated = true;
    let designInspirationId: Id<"designInspirations"> | undefined;
    if (args.designInspiration) {
      const result = (await ctx.runMutation(createDesignInspirationMutation, {
        ownerUserId,
        title: args.designInspiration.title,
        summary: args.designInspiration.summary,
        sourceUrl: args.designInspiration.sourceUrl ?? args.url,
        inspirationType: args.designInspiration.inspirationType,
        platform: args.designInspiration.platform,
        workflowType: args.designInspiration.workflowType ?? args.workflowType,
        tagIds,
        folderId: args.folderId,
        ingestKey: args.designInspiration.ingestKey ?? args.ingestKey,
        assetId,
        promptId,
      })) as { designInspirationId: Id<"designInspirations">; created: boolean };
      designInspirationId = result.designInspirationId;
      designInspirationCreated = result.created;
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
