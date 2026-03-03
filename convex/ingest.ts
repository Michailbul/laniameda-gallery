"use node";

import { Jimp, JimpMime } from "jimp";
import { action } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

const pillarValidator = v.optional(v.union(
  v.literal("creators"),
  v.literal("cars"),
  v.literal("designs"),
  v.literal("dump"),
));

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
    folderId: v.optional(v.id("folders")),
    ingestKey: v.optional(v.string()),
    promptIngestKey: v.optional(v.string()),
    modelName: v.optional(v.string()),
    pillar: pillarValidator,
    generationType: v.optional(v.union(
      v.literal("image_gen"),
      v.literal("video_gen"),
      v.literal("ui_design"),
      v.literal("other"),
    )),
    promptType: v.optional(v.union(
      v.literal("image_gen"),
      v.literal("video_gen"),
      v.literal("ui_design"),
      v.literal("cinematic"),
      v.literal("ugc_ad"),
      v.literal("other"),
    )),
    domain: v.optional(v.string()),
  },
  returns: v.object({
    assetId: v.optional(v.id("assets")),
    promptId: v.optional(v.id("prompts")),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ assetId?: Id<"assets">; promptId?: Id<"prompts"> }> => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    if (!args.promptText && !args.url && !args.file) {
      throw new ConvexError("Provide a prompt, URL, or file.");
    }

    const tagNames = normalizeTags([
      ...(args.tagNames ?? []),
      ...guessTags(args.promptText, args.file?.fileName, args.url),
    ]);
    const tagIds: Id<"tags">[] = tagNames.length
      ? ((await ctx.runMutation(api.tags.getOrCreateTags, {
          names: tagNames,
        })) as Id<"tags">[])
      : [];

    let promptCreated = true;
    const promptResult: { promptId: Id<"prompts">; created: boolean } | undefined = args.promptText
      ? ((await ctx.runMutation(api.prompts.createPrompt, {
          ownerUserId,
          text: args.promptText,
          tagIds,
          folderId: args.folderId,
          ingestKey: args.promptIngestKey ?? args.ingestKey,
          pillar: args.pillar,
          promptType: args.promptType,
          domain: args.domain,
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
      })) as { assetId: Id<"assets">; created: boolean };
      assetId = result.assetId;
      assetCreated = result.created;
    }

    const ingestKeyDuplicate = Boolean(args.ingestKey && !assetCreated);
    const promptIngestKeyDuplicate = Boolean((args.promptIngestKey ?? args.ingestKey) && !promptCreated);
    await ctx.scheduler.runAfter(0, internal.notifications.notifyKBIngest, {
      ownerUserId,
      pillar: args.pillar ?? "dump",
      promptText: args.promptText,
      modelName: args.modelName,
      tagNames: args.tagNames,
      assetId,
      promptId,
      isDuplicate: ingestKeyDuplicate || promptIngestKeyDuplicate,
    });

    return {
      assetId,
      promptId,
    };
  },
});
