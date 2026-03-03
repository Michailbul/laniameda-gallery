import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { bumpTagUsage, dedupeIds } from "./helpers";
import { ensureFolderOwnership } from "./folderHelpers";

const generationTypeValidator = v.optional(v.union(
  v.literal("image_gen"),
  v.literal("video_gen"),
  v.literal("ui_design"),
  v.literal("other"),
));

const pillarValidator = v.optional(v.union(
  v.literal("creators"),
  v.literal("cars"),
  v.literal("designs"),
  v.literal("dump"),
));

const resolveOwnerUserIdCandidates = (ownerUserId: string) => {
  const normalized = ownerUserId.trim();
  if (!normalized) {
    return [];
  }

  const candidates = [normalized];
  if (normalized.startsWith("telegram:")) {
    const unprefixed = normalized.slice("telegram:".length).trim();
    if (unprefixed) {
      candidates.push(unprefixed);
    }
  } else if (/^\d+$/.test(normalized)) {
    candidates.push(`telegram:${normalized}`);
  }

  return Array.from(new Set(candidates));
};

const resolveAdminCandidates = (actorUserId: string) => {
  const normalized = actorUserId.trim();
  if (!normalized) return [];
  const candidates = [normalized];
  if (normalized.startsWith("telegram:")) {
    const unprefixed = normalized.slice("telegram:".length).trim();
    if (unprefixed) candidates.push(unprefixed);
  } else if (/^\d+$/.test(normalized)) {
    candidates.push(`telegram:${normalized}`);
  }
  return Array.from(new Set(candidates));
};

const getCuratorUserIdsFromEnv = () => {
  const raw = process.env.CURATION_ADMIN_USER_IDS ?? process.env.KB_OWNER_USER_ID ?? "";
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

export const createAsset = mutation({
  args: {
    ownerUserId: v.string(),
    kind: v.union(v.literal("image"), v.literal("video")),
    storageId: v.optional(v.id("_storage")),
    thumbStorageId: v.optional(v.id("_storage")),
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
    tagIds: v.array(v.id("tags")),
    folderId: v.optional(v.id("folders")),
    ingestKey: v.optional(v.string()),
    modelName: v.optional(v.string()),
    pillar: pillarValidator,
    generationType: generationTypeValidator,
  },
  returns: v.object({
    assetId: v.id("assets"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    await ensureFolderOwnership(ctx, ownerUserId, args.folderId);

    if (args.ingestKey) {
      const existing = await ctx.db
        .query("assets")
        .withIndex("by_owner_ingestKey", (q) =>
          q.eq("ownerUserId", ownerUserId).eq("ingestKey", args.ingestKey),
        )
        .unique();
      if (existing) {
        return { assetId: existing._id, created: false };
      }
    }

    const createdAt = Date.now();
    const tagIds = dedupeIds(args.tagIds);
    const assetId = await ctx.db.insert("assets", {
      ownerUserId,
      kind: args.kind,
      storageId: args.storageId,
      thumbStorageId: args.thumbStorageId,
      sourceUrl: args.sourceUrl,
      fileName: args.fileName,
      contentType: args.contentType,
      size: args.size,
      width: args.width,
      height: args.height,
      thumbSize: args.thumbSize,
      thumbWidth: args.thumbWidth,
      thumbHeight: args.thumbHeight,
      promptId: args.promptId,
      tagIds,
      folderId: args.folderId,
      ingestKey: args.ingestKey,
      modelName: args.modelName,
      isPublic: false,
      isFeatured: false,
      pillar: args.pillar,
      generationType: args.generationType,
      createdAt,
    });

    for (const tagId of tagIds) {
      await ctx.db.insert("assetTags", {
        assetId,
        tagId,
        createdAt,
      });
    }

    await bumpTagUsage(ctx, tagIds, 1);

    return { assetId, created: true };
  },
});

export const setAssetFolder = mutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    folderId: v.optional(v.id("folders")),
  },
  returns: v.object({
    assetId: v.id("assets"),
    folderId: v.optional(v.id("folders")),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      throw new ConvexError("Asset not found.");
    }
    if (asset.ownerUserId !== ownerUserId) {
      throw new ConvexError("Asset does not belong to this user.");
    }

    await ensureFolderOwnership(ctx, ownerUserId, args.folderId);
    if (asset.folderId === args.folderId) {
      return {
        assetId: args.assetId,
        folderId: asset.folderId,
      };
    }

    await ctx.db.patch(args.assetId, {
      folderId: args.folderId,
    });

    return {
      assetId: args.assetId,
      folderId: args.folderId,
    };
  },
});

export const getAsset = query({
  args: {
    id: v.id("assets"),
    ownerUserId: v.optional(v.string()),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("assets"),
      _creationTime: v.number(),
      ownerUserId: v.optional(v.string()),
      kind: v.union(v.literal("image"), v.literal("video")),
      storageId: v.optional(v.id("_storage")),
      thumbStorageId: v.optional(v.id("_storage")),
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
      tagIds: v.array(v.id("tags")),
      folderId: v.optional(v.id("folders")),
      ingestKey: v.optional(v.string()),
      modelName: v.optional(v.string()),
      isPublic: v.optional(v.boolean()),
      isFeatured: v.optional(v.boolean()),
      curatedByUserId: v.optional(v.string()),
      curatedAt: v.optional(v.number()),
      pillar: pillarValidator,
      generationType: generationTypeValidator,
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.id);
    if (!asset) {
      return null;
    }
    if (args.ownerUserId && asset.ownerUserId !== args.ownerUserId) {
      return null;
    }
    return asset;
  },
});

export const listAssets = query({
  args: {
    ownerUserId: v.string(),
    tagId: v.optional(v.id("tags")),
    folderId: v.optional(v.id("folders")),
    kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
    promptId: v.optional(v.id("prompts")),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("assets"),
      _creationTime: v.number(),
      ownerUserId: v.optional(v.string()),
      kind: v.union(v.literal("image"), v.literal("video")),
      storageId: v.optional(v.id("_storage")),
      thumbStorageId: v.optional(v.id("_storage")),
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
      tagIds: v.array(v.id("tags")),
      folderId: v.optional(v.id("folders")),
      ingestKey: v.optional(v.string()),
      modelName: v.optional(v.string()),
      isPublic: v.optional(v.boolean()),
      isFeatured: v.optional(v.boolean()),
      curatedByUserId: v.optional(v.string()),
      curatedAt: v.optional(v.number()),
      pillar: pillarValidator,
      generationType: generationTypeValidator,
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const limit = Math.min(args.limit ?? 50, 200);
    if (args.promptId) {
      return await ctx.db
        .query("assets")
        .withIndex("by_owner_prompt_createdAt", (q) =>
          q.eq("ownerUserId", ownerUserId).eq("promptId", args.promptId).gte("createdAt", 0),
        )
        .order("desc")
        .take(limit);
    }
    const tagId = args.tagId;
    if (tagId) {
      const links = await ctx.db
        .query("assetTags")
        .withIndex("by_tag_createdAt", (q) =>
          q.eq("tagId", tagId).gte("createdAt", 0),
        )
        .order("desc")
        .take(limit);
      const results = [];
      for (const link of links) {
        const asset = await ctx.db.get(link.assetId);
        if (asset && asset.ownerUserId === ownerUserId) {
          results.push(asset);
        }
      }
      return results;
    }
    if (args.folderId) {
      return await ctx.db
        .query("assets")
        .withIndex("by_owner_folder_createdAt", (q) =>
          q.eq("ownerUserId", ownerUserId).eq("folderId", args.folderId).gte("createdAt", 0),
        )
        .order("desc")
        .take(limit);
    }
    const kind = args.kind;
    if (kind) {
      return await ctx.db
        .query("assets")
        .withIndex("by_owner_kind_createdAt", (q) =>
          q.eq("ownerUserId", ownerUserId).eq("kind", kind).gte("createdAt", 0),
        )
        .order("desc")
        .take(limit);
    }

    return await ctx.db
      .query("assets")
      .withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", ownerUserId).gte("createdAt", 0))
      .order("desc")
      .take(limit);
  },
});

const galleryAssetResultValidator = v.object({
  _id: v.id("assets"),
  _creationTime: v.number(),
  ownerUserId: v.optional(v.string()),
  kind: v.union(v.literal("image"), v.literal("video")),
  storageId: v.optional(v.id("_storage")),
  thumbStorageId: v.optional(v.id("_storage")),
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
  promptText: v.optional(v.string()),
  tagIds: v.array(v.id("tags")),
  tagNames: v.array(v.string()),
  folderId: v.optional(v.id("folders")),
  modelName: v.optional(v.string()),
  isPublic: v.optional(v.boolean()),
  isFeatured: v.optional(v.boolean()),
  curatedByUserId: v.optional(v.string()),
  curatedAt: v.optional(v.number()),
  pillar: pillarValidator,
  createdAt: v.number(),
  url: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
});

export const listGalleryAssets = query({
  args: {
    ownerUserId: v.string(),
    kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
    tagIds: v.optional(v.array(v.id("tags"))),
    folderId: v.optional(v.id("folders")),
    modelName: v.optional(v.string()),
    pillar: pillarValidator,
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(galleryAssetResultValidator),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const limit = Math.min(args.limit ?? 100, 200);
    const ownerUserIds = resolveOwnerUserIdCandidates(ownerUserId);
    const tagFilter =
      args.tagIds && args.tagIds.length > 0 ? new Set(args.tagIds) : null;
    const search = args.search?.trim().toLowerCase();
    const modelNameFilter = args.modelName?.trim() || null;
    const pillar = args.pillar;
    const kind = args.kind;
    const ownerScopedAssets = [];
    for (const ownerCandidate of ownerUserIds) {
      const assetsForOwner = await (pillar
        ? ctx.db
            .query("assets")
            .withIndex("by_owner_pillar_createdAt", (q) =>
              q.eq("ownerUserId", ownerCandidate).eq("pillar", pillar).gte("createdAt", 0),
            )
        : kind
          ? ctx.db
              .query("assets")
              .withIndex("by_owner_kind_createdAt", (q) =>
                q.eq("ownerUserId", ownerCandidate).eq("kind", kind).gte("createdAt", 0),
              )
          : ctx.db
              .query("assets")
              .withIndex("by_owner_createdAt", (q) =>
                q.eq("ownerUserId", ownerCandidate).gte("createdAt", 0),
              )
      )
        .order("desc")
        .take(limit);
      ownerScopedAssets.push(...assetsForOwner);
    }

    ownerScopedAssets.sort((a, b) => b.createdAt - a.createdAt);
    const seenAssetIds = new Set<Id<"assets">>();
    const assets = ownerScopedAssets.filter((asset) => {
      if (seenAssetIds.has(asset._id)) {
        return false;
      }
      seenAssetIds.add(asset._id);
      return true;
    });
    const tagNameCache = new Map<Id<"tags">, string>();
    const promptCache = new Map<Id<"prompts">, string>();

    const getTagName = async (tagId: Id<"tags">) => {
      const cached = tagNameCache.get(tagId);
      if (cached) return cached;
      const tag = await ctx.db.get(tagId);
      if (!tag) return undefined;
      tagNameCache.set(tagId, tag.name);
      return tag.name;
    };

    const getPromptText = async (promptId: Id<"prompts">) => {
      const cached = promptCache.get(promptId);
      if (cached) return cached;
      const prompt = await ctx.db.get(promptId);
      if (!prompt) return undefined;
      promptCache.set(promptId, prompt.text);
      return prompt.text;
    };

    const results = [];
    for (const asset of assets) {
      if (tagFilter && !asset.tagIds.some((tagId) => tagFilter.has(tagId))) {
        continue;
      }
      if (args.folderId && asset.folderId !== args.folderId) {
        continue;
      }
      if (modelNameFilter && asset.modelName !== modelNameFilter) {
        continue;
      }
      if (kind && asset.kind !== kind) {
        continue;
      }

      const promptText = asset.promptId
        ? await getPromptText(asset.promptId)
        : undefined;

      if (search) {
        const haystack = [promptText, asset.fileName, asset.sourceUrl]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(search)) {
          continue;
        }
      }

      const tagNames: string[] = [];
      for (const tagId of asset.tagIds) {
        const name = await getTagName(tagId);
        if (name) tagNames.push(name);
      }

      const url = asset.storageId
        ? (await ctx.storage.getUrl(asset.storageId)) ?? undefined
        : asset.sourceUrl;
      const thumbUrl = asset.thumbStorageId
        ? (await ctx.storage.getUrl(asset.thumbStorageId)) ?? undefined
        : undefined;

      results.push({
        _id: asset._id,
        _creationTime: asset._creationTime,
        ownerUserId: asset.ownerUserId,
        kind: asset.kind,
        storageId: asset.storageId,
        thumbStorageId: asset.thumbStorageId,
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
        createdAt: asset.createdAt,
        url,
        thumbUrl,
      });
      if (results.length >= limit) {
        break;
      }
    }

    return results;
  },
});

export const listPublicGalleryAssets = query({
  args: {
    kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
    tagIds: v.optional(v.array(v.id("tags"))),
    folderId: v.optional(v.id("folders")),
    modelName: v.optional(v.string()),
    pillar: pillarValidator,
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(galleryAssetResultValidator),
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 100, 200);
    const queryTake = Math.min(limit * 3, 600);
    const tagFilter =
      args.tagIds && args.tagIds.length > 0 ? new Set(args.tagIds) : null;
    const search = args.search?.trim().toLowerCase();
    const modelNameFilter = args.modelName?.trim() || null;
    const pillar = args.pillar;
    const kind = args.kind;

    const baseAssets = await (pillar
      ? ctx.db
          .query("assets")
          .withIndex("by_isPublic_pillar_createdAt", (q) =>
            q.eq("isPublic", true).eq("pillar", pillar).gte("createdAt", 0),
          )
      : kind
        ? ctx.db
            .query("assets")
            .withIndex("by_isPublic_kind_createdAt", (q) =>
              q.eq("isPublic", true).eq("kind", kind).gte("createdAt", 0),
            )
        : ctx.db
            .query("assets")
            .withIndex("by_isPublic_createdAt", (q) =>
              q.eq("isPublic", true).gte("createdAt", 0),
            )
    )
      .order("desc")
      .take(queryTake);

    const tagNameCache = new Map<Id<"tags">, string>();
    const promptCache = new Map<Id<"prompts">, string>();

    const getTagName = async (tagId: Id<"tags">) => {
      const cached = tagNameCache.get(tagId);
      if (cached) return cached;
      const tag = await ctx.db.get(tagId);
      if (!tag) return undefined;
      tagNameCache.set(tagId, tag.name);
      return tag.name;
    };

    const getPromptText = async (promptId: Id<"prompts">) => {
      const cached = promptCache.get(promptId);
      if (cached) return cached;
      const prompt = await ctx.db.get(promptId);
      if (!prompt) return undefined;
      promptCache.set(promptId, prompt.text);
      return prompt.text;
    };

    const results = [];
    for (const asset of baseAssets) {
      if (tagFilter && !asset.tagIds.some((tagId) => tagFilter.has(tagId))) {
        continue;
      }
      if (args.folderId && asset.folderId !== args.folderId) {
        continue;
      }
      if (modelNameFilter && asset.modelName !== modelNameFilter) {
        continue;
      }

      const promptText = asset.promptId
        ? await getPromptText(asset.promptId)
        : undefined;

      if (search) {
        const haystack = [promptText, asset.fileName, asset.sourceUrl]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(search)) {
          continue;
        }
      }

      const tagNames: string[] = [];
      for (const tagId of asset.tagIds) {
        const name = await getTagName(tagId);
        if (name) tagNames.push(name);
      }

      const url = asset.storageId
        ? (await ctx.storage.getUrl(asset.storageId)) ?? undefined
        : asset.sourceUrl;
      const thumbUrl = asset.thumbStorageId
        ? (await ctx.storage.getUrl(asset.thumbStorageId)) ?? undefined
        : undefined;

      results.push({
        _id: asset._id,
        _creationTime: asset._creationTime,
        ownerUserId: asset.ownerUserId,
        kind: asset.kind,
        storageId: asset.storageId,
        thumbStorageId: asset.thumbStorageId,
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
        createdAt: asset.createdAt,
        url,
        thumbUrl,
      });
      if (results.length >= limit) {
        break;
      }
    }

    return results;
  },
});

export const setAssetCuration = mutation({
  args: {
    assetId: v.id("assets"),
    actorUserId: v.string(),
    isPublic: v.boolean(),
    isFeatured: v.optional(v.boolean()),
    adminSecret: v.string(),
  },
  returns: v.object({
    assetId: v.id("assets"),
    isPublic: v.boolean(),
    isFeatured: v.boolean(),
    curatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const expectedSecret = process.env.CURATION_ADMIN_SECRET;
    if (!expectedSecret || args.adminSecret !== expectedSecret) {
      throw new ConvexError("Unauthorized curator request.");
    }

    const actorUserId = args.actorUserId.trim();
    if (!actorUserId) {
      throw new ConvexError("actorUserId is required.");
    }

    const allowedUserIds = getCuratorUserIdsFromEnv();
    if (allowedUserIds.length === 0) {
      throw new ConvexError("Curator user list is not configured.");
    }

    const actorCandidates = resolveAdminCandidates(actorUserId);
    const canCurate = allowedUserIds.some((allowed) => actorCandidates.includes(allowed));
    if (!canCurate) {
      throw new ConvexError("Forbidden curator.");
    }

    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      throw new ConvexError("Asset not found.");
    }

    const curatedAt = Date.now();
    const nextIsPublic = args.isPublic;
    const nextIsFeatured =
      args.isFeatured !== undefined ? args.isFeatured && nextIsPublic : Boolean(asset.isFeatured && nextIsPublic);

    await ctx.db.patch(args.assetId, {
      isPublic: nextIsPublic,
      isFeatured: nextIsFeatured,
      curatedByUserId: actorUserId,
      curatedAt,
    });

    return {
      assetId: args.assetId,
      isPublic: nextIsPublic,
      isFeatured: nextIsFeatured,
      curatedAt,
    };
  },
});

export const hasAssetForIngestKey = query({
  args: {
    ownerUserId: v.string(),
    ingestKey: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const existing = await ctx.db
      .query("assets")
      .withIndex("by_owner_ingestKey", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("ingestKey", args.ingestKey),
      )
      .unique();
    return Boolean(existing);
  },
});

export const countAssets = query({
  args: {
    ownerUserId: v.optional(v.string()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    if (args.ownerUserId) {
      const ownerUserId = args.ownerUserId.trim();
      if (!ownerUserId) {
        throw new ConvexError("ownerUserId is required when provided.");
      }
      return await ctx.db
        .query("assets")
        .withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", ownerUserId).gte("createdAt", 0))
        .collect()
        .then((rows) => rows.length);
    }
    return await ctx.db.query("assets").collect().then((rows) => rows.length);
  },
});

export const deleteAsset = mutation({
  args: {
    id: v.id("assets"),
    ownerUserId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const asset = await ctx.db.get(args.id);
    if (!asset) {
      throw new ConvexError("Asset not found.");
    }

    const ownerCandidates = resolveOwnerUserIdCandidates(ownerUserId);
    if (!asset.ownerUserId || !ownerCandidates.includes(asset.ownerUserId)) {
      throw new ConvexError("Asset does not belong to ownerUserId.");
    }

    const links = await ctx.db
      .query("assetTags")
      .withIndex("by_asset", (q) => q.eq("assetId", args.id))
      .collect();
    for (const link of links) {
      await ctx.db.delete(link._id);
    }

    const storageIds = dedupeIds(
      [asset.storageId, asset.thumbStorageId].filter(
        (id): id is Id<"_storage"> => Boolean(id),
      ),
    );
    for (const storageId of storageIds) {
      await ctx.storage.delete(storageId);
    }

    await ctx.db.delete(args.id);
    await bumpTagUsage(ctx, dedupeIds(asset.tagIds), -1);

    return null;
  },
});

export const bulkDeleteAssets = mutation({
  args: { ids: v.array(v.id("assets")) },
  returns: v.number(),
  handler: async (ctx, args) => {
    let count = 0;
    for (const id of args.ids) {
      const links = await ctx.db
        .query("assetTags")
        .withIndex("by_asset", (q) => q.eq("assetId", id))
        .collect();
      for (const link of links) {
        await ctx.db.delete(link._id);
      }
      await ctx.db.delete(id);
      count++;
    }
    return count;
  },
});

export const wipeAllAssets = mutation({
  args: {
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    dryRun: v.boolean(),
    assetsDeleted: v.number(),
    assetTagLinksDeleted: v.number(),
    storageObjectsDeleted: v.number(),
    tagsAdjusted: v.number(),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    const assets = await ctx.db.query("assets").collect();
    const assetTagLinks = await ctx.db.query("assetTags").collect();

    const tagUsageToSubtract = new Map<Id<"tags">, number>();
    for (const asset of assets) {
      for (const tagId of asset.tagIds) {
        tagUsageToSubtract.set(tagId, (tagUsageToSubtract.get(tagId) ?? 0) + 1);
      }
    }

    const uniqueStorageIds = new Set<Id<"_storage">>();
    for (const asset of assets) {
      if (asset.storageId) uniqueStorageIds.add(asset.storageId);
      if (asset.thumbStorageId) uniqueStorageIds.add(asset.thumbStorageId);
    }

    let storageObjectsDeleted = 0;

    if (!dryRun) {
      for (const link of assetTagLinks) {
        await ctx.db.delete(link._id);
      }

      for (const storageId of uniqueStorageIds) {
        await ctx.storage.delete(storageId);
        storageObjectsDeleted += 1;
      }

      for (const asset of assets) {
        await ctx.db.delete(asset._id);
      }

      for (const [tagId, decrementBy] of tagUsageToSubtract) {
        const tag = await ctx.db.get(tagId);
        if (!tag) continue;
        await ctx.db.patch(tagId, {
          usageCount: Math.max(0, tag.usageCount - decrementBy),
        });
      }
    }

    return {
      dryRun,
      assetsDeleted: assets.length,
      assetTagLinksDeleted: assetTagLinks.length,
      storageObjectsDeleted: dryRun ? uniqueStorageIds.size : storageObjectsDeleted,
      tagsAdjusted: tagUsageToSubtract.size,
    };
  },
});
