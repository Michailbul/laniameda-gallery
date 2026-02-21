"use node";

import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";

const ingestPromptValidator = v.object({
  final_prompt: v.string(),
  negative_prompt: v.optional(v.string()),
  generation_notes: v.optional(v.string()),
  tags: v.array(v.string()),
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
}) => {
  return {
    finalPrompt: prompt.final_prompt.trim(),
    negativePrompt: prompt.negative_prompt?.trim() || undefined,
    generationNotes: prompt.generation_notes?.trim() || undefined,
    tags: normalizeUniqueStrings(prompt.tags),
  };
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

export const ingestFromAgentPayload = action({
  args: {
    runId: v.id("runs"),
    ownerUserId: v.string(),
    payload: v.object({
      prompts: v.array(ingestPromptValidator),
      selectedTelegramMediaIds: v.array(v.string()),
      selectedUrls: v.array(v.string()),
      notes: v.optional(v.string()),
    }),
    mediaFiles: v.array(ingestMediaValidator),
  },
  returns: v.object({
    promptIds: v.array(v.id("prompts")),
    assetIds: v.array(v.id("assets")),
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

    const promptTagNames = normalizeUniqueStrings(
      normalizedPrompts.flatMap((prompt) => prompt.tags).concat(["agent-ingest", "telegram"]),
    );
    const promptTagIds: Id<"tags">[] =
      promptTagNames.length > 0
        ? await ctx.runMutation(api.tags.getOrCreateTags, { names: promptTagNames })
        : [];
    const promptTagMap = new Map(promptTagNames.map((name, index) => [name, promptTagIds[index]]));

    const promptIds: Id<"prompts">[] = [];
    for (const [index, prompt] of normalizedPrompts.entries()) {
      const perPromptTagIds = prompt.tags
        .map((name) => promptTagMap.get(name))
        .filter((id): id is Id<"tags"> => Boolean(id));
      const promptRecord = await ctx.runMutation(api.prompts.createPrompt, {
        ownerUserId,
        text: buildPromptArtifactText(prompt),
        tagIds: perPromptTagIds,
        ingestKey: `run:${args.runId}:prompt:${index + 1}`,
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

      const blob = toStorageBlob(media.base64, media.mimeType);
      const storageId = await ctx.storage.store(blob);
      const assetRecord = await ctx.runMutation(api.assets.createAsset, {
        ownerUserId,
        kind: media.kind,
        storageId,
        fileName: media.fileName,
        contentType: media.mimeType,
        size: blob.size,
        promptId: promptIds[0],
        tagIds: promptTagIds,
        ingestKey: `run:${args.runId}:media:${mediaId}`,
      });
      assetIds.push(assetRecord.assetId);
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

    return {
      promptIds,
      assetIds,
      skippedMediaIds,
    };
  },
});
