import { internalQuery, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { dedupeIds } from "./helpers";
import { resolveAssetUrl } from "./r2_url";
import {
  assetRoleValidator,
  generationTypeValidator,
  ingestSourceValidator,
  optionalPillarValidator,
} from "./validators";

export const galleryAssetResultValidator = v.object({
  _id: v.id("assets"),
  _creationTime: v.number(),
  ownerUserId: v.optional(v.string()),
  kind: v.union(v.literal("image"), v.literal("video")),
  storageId: v.optional(v.id("_storage")),
  thumbStorageId: v.optional(v.id("_storage")),
  r2Key: v.optional(v.string()),
  r2Bucket: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  fileName: v.optional(v.string()),
  contentType: v.optional(v.string()),
  size: v.optional(v.number()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  thumbSize: v.optional(v.number()),
  thumbWidth: v.optional(v.number()),
  thumbHeight: v.optional(v.number()),
  promptId: v.optional(v.id("prompts")),
  designInspirationId: v.optional(v.id("designInspirations")),
  promptText: v.optional(v.string()),
  tagIds: v.array(v.id("tags")),
  tagNames: v.array(v.string()),
  folderId: v.optional(v.id("folders")),
  modelName: v.optional(v.string()),
  isPublic: v.optional(v.boolean()),
  isFeatured: v.optional(v.boolean()),
  curatedByUserId: v.optional(v.string()),
  curatedAt: v.optional(v.number()),
  pillar: optionalPillarValidator,
  generationType: generationTypeValidator,
  assetRole: assetRoleValidator,
  ingestSource: ingestSourceValidator,
  assetPackId: v.optional(v.id("assetPacks")),
  packSlotIndex: v.optional(v.number()),
  createdAt: v.number(),
  url: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
});

export const scoredGalleryAssetResultValidator = v.object({
  ...galleryAssetResultValidator.fields,
  score: v.number(),
});

const resolvePromptTextMap = async (ctx: QueryCtx, assets: Doc<"assets">[]) => {
  const promptIds = dedupeIds(
    assets
      .map((asset) => asset.promptId)
      .filter((promptId): promptId is Id<"prompts"> => Boolean(promptId)),
  );

  if (promptIds.length === 0) {
    return new Map<Id<"prompts">, string>();
  }

  const promptEntries = await Promise.all(
    promptIds.map(async (promptId) => {
      const prompt = await ctx.db.get(promptId);
      return [promptId, prompt?.text] as const;
    }),
  );

  const promptTextById = new Map<Id<"prompts">, string>();
  for (const [promptId, promptText] of promptEntries) {
    if (promptText) {
      promptTextById.set(promptId, promptText);
    }
  }

  return promptTextById;
};

const resolveTagNameMap = async (ctx: QueryCtx, assets: Doc<"assets">[]) => {
  const tagIds = dedupeIds(assets.flatMap((asset) => asset.tagIds));

  if (tagIds.length === 0) {
    return new Map<Id<"tags">, string>();
  }

  const tagEntries = await Promise.all(
    tagIds.map(async (tagId) => {
      const tag = await ctx.db.get(tagId);
      return [tagId, tag?.name] as const;
    }),
  );

  const tagNameById = new Map<Id<"tags">, string>();
  for (const [tagId, tagName] of tagEntries) {
    if (tagName) {
      tagNameById.set(tagId, tagName);
    }
  }

  return tagNameById;
};

export const hydrateGalleryAssetResults = async (
  ctx: QueryCtx,
  assets: Doc<"assets">[],
) => {
  if (assets.length === 0) {
    return [];
  }

  const [promptTextById, tagNameById] = await Promise.all([
    resolvePromptTextMap(ctx, assets),
    resolveTagNameMap(ctx, assets),
  ]);

  return await Promise.all(
    assets.map(async (asset) => {
      const promptText = asset.promptId
        ? promptTextById.get(asset.promptId)
        : undefined;
      const tagNames = asset.tagIds
        .map((tagId) => tagNameById.get(tagId))
        .filter((tagName): tagName is string => Boolean(tagName));

      const [url, thumbUrl] = await Promise.all([
        resolveAssetUrl(ctx, asset),
        asset.thumbStorageId
          ? ctx.storage.getUrl(asset.thumbStorageId).then((value) => value ?? undefined)
          : Promise.resolve(undefined),
      ]);

      return {
        _id: asset._id,
        _creationTime: asset._creationTime,
        ownerUserId: asset.ownerUserId,
        kind: asset.kind,
        storageId: asset.storageId,
        thumbStorageId: asset.thumbStorageId,
        r2Key: asset.r2Key,
        r2Bucket: asset.r2Bucket,
        sourceUrl: asset.sourceUrl,
        fileName: asset.fileName,
        contentType: asset.contentType,
        size: asset.size,
        width: asset.width,
        height: asset.height,
        thumbSize: asset.thumbSize,
        thumbWidth: asset.thumbWidth,
        thumbHeight: asset.thumbHeight,
        promptId: asset.promptId,
        designInspirationId: asset.designInspirationId,
        promptText,
        tagIds: asset.tagIds,
        tagNames,
        folderId: asset.folderId,
        modelName: asset.modelName,
        isPublic: asset.isPublic,
        isFeatured: asset.isFeatured,
        curatedByUserId: asset.curatedByUserId,
        curatedAt: asset.curatedAt,
        pillar: asset.pillar,
        generationType: asset.generationType,
        assetRole: asset.assetRole,
        ingestSource: asset.ingestSource,
        assetPackId: asset.assetPackId,
        packSlotIndex: asset.packSlotIndex,
        createdAt: asset.createdAt,
        url,
        thumbUrl,
      };
    }),
  );
};

export const listScoredGalleryAssetsByIds = internalQuery({
  args: {
    items: v.array(v.object({ assetId: v.id("assets"), score: v.number() })),
  },
  returns: v.array(scoredGalleryAssetResultValidator),
  handler: async (ctx, args) => {
    if (args.items.length === 0) {
      return [];
    }

    const uniqueIds = dedupeIds(args.items.map((item) => item.assetId));
    const assets = await Promise.all(uniqueIds.map(async (assetId) => await ctx.db.get(assetId)));
    const assetById = new Map(
      assets
        .filter((asset): asset is Doc<"assets"> => Boolean(asset))
        .map((asset) => [asset._id, asset] as const),
    );
    const orderedAssets = uniqueIds
      .map((assetId) => assetById.get(assetId))
      .filter((asset): asset is Doc<"assets"> => Boolean(asset));

    const hydrated = await hydrateGalleryAssetResults(ctx, orderedAssets);
    const scoreById = new Map(args.items.map((item) => [item.assetId, item.score] as const));

    return hydrated
      .map((asset) => ({
        ...asset,
        score: scoreById.get(asset._id) ?? 0,
      }))
      .sort((left, right) => right.score - left.score);
  },
});
