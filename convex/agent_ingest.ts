"use node";

import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { makeFunctionReference } from "convex/server";
import {
  designInspirationTypeValidator,
  designPlatformValidator,
  modelProviderValidator,
  optionalPillarValidator,
  promptProfileValidator,
  promptTypeValidator,
  workflowTypeValidator,
} from "./validators";

type Pillar = "creators" | "cars" | "designs" | "dump";
type PromptType =
  | "image_gen"
  | "video_gen"
  | "ui_design"
  | "cinematic"
  | "ugc_ad"
  | "workflow"
  | "component_prompt"
  | "page_prompt"
  | "other";
type WorkflowType =
  | "component_prompt"
  | "page_prompt"
  | "system_prompt"
  | "asset_recipe"
  | "other";
type ModelProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "meta"
  | "flux"
  | "midjourney"
  | "runway"
  | "other";
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
const createDesignInspirationMutation = makeFunctionReference<"mutation">(
  "designInspirations:createDesignInspiration",
);
const getOrCreateTagsWithMetadataMutation = makeFunctionReference<"mutation">(
  "tags:getOrCreateTagsWithMetadata",
);

const ingestPromptValidator = v.object({
  final_prompt: v.string(),
  negative_prompt: v.optional(v.string()),
  generation_notes: v.optional(v.string()),
  tags: v.array(v.string()),
  pillar: optionalPillarValidator,
  promptType: promptTypeValidator,
  workflowType: workflowTypeValidator,
  domain: v.optional(v.string()),
  modelName: v.optional(v.string()),
  modelProvider: modelProviderValidator,
  promptProfile: promptProfileValidator,
});

const ingestMediaValidator = v.object({
  mediaId: v.string(),
  kind: v.union(
    v.literal("image"),
    v.literal("video"),
    v.literal("audio"),
    v.literal("voice"),
    v.literal("document"),
  ),
  mimeType: v.optional(v.string()),
  fileName: v.optional(v.string()),
  base64: v.string(),
  linkedPromptIndex: v.optional(v.number()),
});

const ingestDesignInspirationValidator = v.object({
  title: v.optional(v.string()),
  summary: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  inspirationType: designInspirationTypeValidator,
  platform: designPlatformValidator,
  workflowType: workflowTypeValidator,
  tags: v.array(v.string()),
  linkedPromptIndex: v.optional(v.number()),
  linkedMediaId: v.optional(v.string()),
});

const normalizeUniqueStrings = (values: string[]) => {
  const cleaned = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return Array.from(new Set(cleaned));
};

const normalizePrompt = (prompt: {
  final_prompt: string;
  negative_prompt?: string;
  generation_notes?: string;
  tags: string[];
  pillar?: Pillar;
  promptType?: PromptType;
  workflowType?: WorkflowType;
  domain?: string;
  modelName?: string;
  modelProvider?: ModelProvider;
  promptProfile?: {
    pillar: Pillar;
  };
}) => {
  const pillar = prompt.pillar ?? "dump";
  if (prompt.promptProfile && prompt.promptProfile.pillar !== pillar) {
    throw new ConvexError("prompt_profile_pillar_mismatch");
  }
  return {
    finalPrompt: prompt.final_prompt.trim(),
    negativePrompt: prompt.negative_prompt?.trim() || undefined,
    generationNotes: prompt.generation_notes?.trim() || undefined,
    tags: normalizeUniqueStrings(prompt.tags),
    pillar,
    promptType: prompt.promptType,
    workflowType: prompt.workflowType,
    domain: prompt.domain?.trim() || undefined,
    modelName: prompt.modelName?.trim() || undefined,
    modelProvider: prompt.modelProvider,
    promptProfile: prompt.promptProfile,
  };
};

const normalizeTagInputs = (
  tags: Array<{
    name: string;
    category?: TagCategory;
    pillar?: Pillar;
    source?: TagSource;
  }>,
) => {
  const deduped = new Map<string, (typeof tags)[number]>();
  for (const tag of tags) {
    const name = tag.name.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (deduped.has(key)) continue;
    deduped.set(key, {
      name,
      category: tag.category,
      pillar: tag.pillar,
      source: tag.source,
    });
  }
  return [...deduped.values()];
};

const toStorageBlob = (base64: string, mimeType?: string) => {
  const buffer = Buffer.from(base64, "base64");
  if (buffer.byteLength === 0) {
    throw new ConvexError("Empty media payload.");
  }
  return new Blob([buffer], { type: mimeType || "application/octet-stream" });
};

const buildPromptArtifactText = (prompt: {
  finalPrompt: string;
  negativePrompt?: string;
  generationNotes?: string;
}) => {
  return [
    `final_prompt: ${prompt.finalPrompt}`,
    prompt.negativePrompt ? `negative_prompt: ${prompt.negativePrompt}` : undefined,
    prompt.generationNotes ? `generation_notes: ${prompt.generationNotes}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
};

const resolvePromptIdByIndex = (
  promptIds: Id<"prompts">[],
  index?: number,
) => {
  if (index === undefined) {
    return promptIds[0];
  }
  const normalized = Math.trunc(index);
  if (normalized < 1 || normalized > promptIds.length) {
    return undefined;
  }
  return promptIds[normalized - 1];
};

export const ingestFromAgentPayload = action({
  args: {
    runId: v.id("runs"),
    ownerUserId: v.string(),
    payload: v.object({
      prompts: v.array(ingestPromptValidator),
      designInspirations: v.optional(v.array(ingestDesignInspirationValidator)),
      selectedTelegramMediaIds: v.array(v.string()),
      selectedUrls: v.array(v.string()),
      notes: v.optional(v.string()),
    }),
    mediaFiles: v.array(ingestMediaValidator),
  },
  returns: v.object({
    promptIds: v.array(v.id("prompts")),
    assetIds: v.array(v.id("assets")),
    designInspirationIds: v.array(v.id("designInspirations")),
    skippedMediaIds: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const normalizedPrompts = args.payload.prompts
      .map(normalizePrompt)
      .filter((prompt) => prompt.finalPrompt.length > 0);
    if (normalizedPrompts.length === 0) {
      throw new ConvexError("no_usable_prompt");
    }

    const selectedMediaIds = normalizeUniqueStrings(args.payload.selectedTelegramMediaIds);
    const selectedUrls = normalizeUniqueStrings(args.payload.selectedUrls);
    const normalizedDesignInspirations = (args.payload.designInspirations ?? []).map((item) => ({
      title: item.title?.trim() || undefined,
      summary: item.summary?.trim() || undefined,
      sourceUrl: item.sourceUrl?.trim() || undefined,
      inspirationType: item.inspirationType,
      platform: item.platform,
      workflowType: item.workflowType,
      tags: normalizeUniqueStrings(item.tags),
      linkedPromptIndex: item.linkedPromptIndex,
      linkedMediaId: item.linkedMediaId?.trim() || undefined,
    }));

    const tagInputs = normalizeTagInputs([
      ...normalizedPrompts.flatMap((prompt) =>
        prompt.tags.map((name) => ({
          name,
          category: "custom" as const,
          pillar: prompt.pillar,
          source: "agent" as const,
        })),
      ),
      ...normalizedDesignInspirations.flatMap((item) =>
        item.tags.map((name) => ({
          name,
          category: "design_type" as const,
          pillar: "designs" as const,
          source: "agent" as const,
        })),
      ),
      { name: "agent-ingest", category: "custom", pillar: "dump", source: "system" },
      { name: "telegram", category: "platform", pillar: "dump", source: "system" },
    ]);

    const tagIds =
      tagInputs.length > 0
        ? ((await ctx.runMutation(getOrCreateTagsWithMetadataMutation, {
            tags: tagInputs,
          })) as Id<"tags">[])
        : [];
    const tagIdByName = new Map<string, Id<"tags">>();
    for (const [index, tag] of tagInputs.entries()) {
      tagIdByName.set(tag.name.toLowerCase(), tagIds[index]);
    }

    const promptIds: Id<"prompts">[] = [];
    for (const [index, prompt] of normalizedPrompts.entries()) {
      const perPromptTagIds = prompt.tags
        .map((name) => tagIdByName.get(name.toLowerCase()))
        .filter((id): id is Id<"tags"> => Boolean(id));
      const promptRecord = await ctx.runMutation(api.prompts.createPrompt, {
        ownerUserId,
        text: buildPromptArtifactText(prompt),
        tagIds: perPromptTagIds,
        ingestKey: `run:${args.runId}:prompt:${index + 1}`,
        pillar: prompt.pillar,
        promptType: prompt.promptType,
        workflowType: prompt.workflowType,
        domain: prompt.domain,
        modelName: prompt.modelName,
        modelProvider: prompt.modelProvider,
        promptSections: {
          finalPrompt: prompt.finalPrompt,
          negativePrompt: prompt.negativePrompt,
          generationNotes: prompt.generationNotes,
        },
        promptProfile: prompt.promptProfile,
      });
      promptIds.push(promptRecord.promptId);
    }

    const mediaById = new Map<string, (typeof args.mediaFiles)[number]>();
    for (const media of args.mediaFiles) {
      const mediaId = media.mediaId.trim();
      if (!mediaId) {
        continue;
      }
      mediaById.set(mediaId, media);
    }

    const assetByMediaId = new Map<string, Id<"assets">>();
    const skippedMediaIds: string[] = [];
    const assetIds: Id<"assets">[] = [];

    for (const mediaId of selectedMediaIds) {
      const media = mediaById.get(mediaId);
      if (!media) {
        skippedMediaIds.push(mediaId);
        continue;
      }
      if (media.kind !== "image" && media.kind !== "video") {
        skippedMediaIds.push(mediaId);
        continue;
      }

      const linkedPromptId = resolvePromptIdByIndex(promptIds, media.linkedPromptIndex);
      const linkedPrompt = media.linkedPromptIndex
        ? normalizedPrompts[Math.trunc(media.linkedPromptIndex) - 1]
        : normalizedPrompts[0];

      const blob = toStorageBlob(media.base64, media.mimeType);
      const storageId = await ctx.storage.store(blob);
      const assetRecord = await ctx.runMutation(api.assets.createAsset, {
        ownerUserId,
        kind: media.kind,
        storageId,
        fileName: media.fileName,
        contentType: media.mimeType,
        size: blob.size,
        promptId: linkedPromptId,
        tagIds,
        ingestKey: `run:${args.runId}:media:${mediaId}`,
        pillar: linkedPrompt?.pillar ?? "dump",
        generationType:
          linkedPrompt?.promptType === "video_gen"
            ? "video_gen"
            : linkedPrompt?.promptType === "ui_design"
              ? "ui_design"
              : "image_gen",
        assetRole: "generated_output",
        ingestSource: "agent",
      });
      assetByMediaId.set(mediaId, assetRecord.assetId);
      assetIds.push(assetRecord.assetId);
    }

    const designInspirationIds: Id<"designInspirations">[] = [];
    for (const [index, inspiration] of normalizedDesignInspirations.entries()) {
      const linkedPromptId = resolvePromptIdByIndex(promptIds, inspiration.linkedPromptIndex);
      const linkedAssetId = inspiration.linkedMediaId
        ? assetByMediaId.get(inspiration.linkedMediaId)
        : undefined;
      const inspirationTagIds = inspiration.tags
        .map((name) => tagIdByName.get(name.toLowerCase()))
        .filter((id): id is Id<"tags"> => Boolean(id));

      const record = (await ctx.runMutation(createDesignInspirationMutation, {
        ownerUserId,
        title: inspiration.title,
        summary: inspiration.summary,
        sourceUrl: inspiration.sourceUrl,
        inspirationType: inspiration.inspirationType,
        platform: inspiration.platform,
        workflowType: inspiration.workflowType,
        tagIds: inspirationTagIds,
        ingestKey: `run:${args.runId}:inspiration:${index + 1}`,
        assetId: linkedAssetId,
        promptId: linkedPromptId,
      })) as { designInspirationId: Id<"designInspirations">; created: boolean };
      designInspirationIds.push(record.designInspirationId);
    }

    if (selectedUrls.length > 0) {
      await ctx.runMutation(api.runs.appendRunEvent, {
        runId: args.runId,
        type: "system",
        payload: {
          phase: "agent_ingest_selected_urls",
          selectedUrls,
          notes: args.payload.notes?.trim() || undefined,
        },
      });
    }

    await ctx.scheduler.runAfter(0, internal.notifications.notifyKBIngest, {
      ownerUserId,
      pillar: normalizedPrompts[0]?.pillar ?? "dump",
      promptText: normalizedPrompts[0]?.finalPrompt,
      tagNames: tagInputs.map((tag) => tag.name),
      assetId: assetIds[0],
      promptId: promptIds[0],
      isDuplicate: false,
    });

    return {
      promptIds,
      assetIds,
      designInspirationIds,
      skippedMediaIds,
    };
  },
});
