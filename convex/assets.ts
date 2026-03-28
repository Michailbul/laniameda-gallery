import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { Id } from "./_generated/dataModel";
import { bumpTagUsage, dedupeIds } from "./helpers";
import { ensureFolderOwnership } from "./folderHelpers";
import {
  galleryAssetResultValidator,
  hydrateGalleryAssetResults,
} from "./galleryAssetResults";
import {
  canActorAccessByUserId,
  canActorAccessOwnerUserId,
  parseUserIdList,
  resolveUserIdCandidates,
} from "./authz";
import {
  assetRoleValidator,
  generationTypeValidator,
  ingestSourceValidator,
  optionalPillarValidator,
} from "./validators";

const pillarValidator = optionalPillarValidator;
const reindexAssetAction = makeFunctionReference<"action">(
  "semanticIndex:reindexAsset",
);

const getCuratorUserIdsFromEnv = () => {
  return parseUserIdList(
    process.env.CURATION_ADMIN_USER_IDS ?? process.env.KB_OWNER_USER_ID,
  );
};

const dedupeAssetIds = <T extends { _id: string }>(rows: T[]) => {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row._id)) return false;
    seen.add(row._id);
    return true;
  });
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
    designInspirationId: v.optional(v.id("designInspirations")),
    tagIds: v.array(v.id("tags")),
    folderId: v.optional(v.id("folders")),
    ingestKey: v.optional(v.string()),
    modelName: v.optional(v.string()),
    pillar: pillarValidator,
    generationType: generationTypeValidator,
    assetRole: assetRoleValidator,
    ingestSource: ingestSourceValidator,
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
      designInspirationId: args.designInspirationId,
      tagIds,
      folderId: args.folderId,
      ingestKey: args.ingestKey,
      modelName: args.modelName,
      isPublic: false,
      isFeatured: false,
      pillar: args.pillar,
      generationType: args.generationType,
      assetRole: args.assetRole,
      ingestSource: args.ingestSource,
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
    await ctx.scheduler.runAfter(0, reindexAssetAction, { assetId });

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
    if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
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

export const setAssetDesignInspiration = mutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    designInspirationId: v.optional(v.id("designInspirations")),
  },
  returns: v.object({
    assetId: v.id("assets"),
    designInspirationId: v.optional(v.id("designInspirations")),
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
    if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
      throw new ConvexError("Asset does not belong to this user.");
    }

    if (args.designInspirationId) {
      const inspiration = await ctx.db.get(args.designInspirationId);
      if (!inspiration) {
        throw new ConvexError("Design inspiration not found.");
      }
      if (!canActorAccessOwnerUserId(ownerUserId, inspiration.ownerUserId)) {
        throw new ConvexError("Design inspiration does not belong to this user.");
      }
    }

    if (asset.designInspirationId === args.designInspirationId) {
      return {
        assetId: args.assetId,
        designInspirationId: asset.designInspirationId,
      };
    }

    await ctx.db.patch(args.assetId, {
      designInspirationId: args.designInspirationId,
    });
    await ctx.scheduler.runAfter(0, reindexAssetAction, {
      assetId: args.assetId,
    });

    return {
      assetId: args.assetId,
      designInspirationId: args.designInspirationId,
    };
  },
});

export const updateAssetMetadata = mutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    tagIds: v.array(v.id("tags")),
    folderId: v.optional(v.id("folders")),
    promptId: v.optional(v.id("prompts")),
    sourceUrl: v.optional(v.string()),
    fileName: v.optional(v.string()),
    contentType: v.optional(v.string()),
    modelName: v.optional(v.string()),
    pillar: pillarValidator,
    generationType: generationTypeValidator,
    assetRole: assetRoleValidator,
    ingestSource: ingestSourceValidator,
  },
  returns: v.id("assets"),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      throw new ConvexError("Asset not found.");
    }
    if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
      throw new ConvexError("Asset does not belong to this user.");
    }

    await ensureFolderOwnership(ctx, ownerUserId, args.folderId);
    if (args.promptId) {
      const prompt = await ctx.db.get(args.promptId);
      if (!prompt) {
        throw new ConvexError("Linked prompt not found.");
      }
      if (!canActorAccessOwnerUserId(ownerUserId, prompt.ownerUserId)) {
        throw new ConvexError("Linked prompt does not belong to this user.");
      }
    }

    const tagIds = dedupeIds(args.tagIds);
    await ctx.db.patch(args.assetId, {
      tagIds,
      folderId: args.folderId,
      promptId: args.promptId,
      sourceUrl: args.sourceUrl,
      fileName: args.fileName,
      contentType: args.contentType,
      modelName: args.modelName,
      pillar: args.pillar,
      generationType: args.generationType,
      assetRole: args.assetRole,
      ingestSource: args.ingestSource,
    });

    await bumpTagUsage(ctx, asset.tagIds, -1);
    await bumpTagUsage(ctx, tagIds, 1);

    const links = await ctx.db
      .query("assetTags")
      .withIndex("by_asset", (q) => q.eq("assetId", args.assetId))
      .collect();
    for (const link of links) {
      await ctx.db.delete(link._id);
    }
    for (const tagId of tagIds) {
      await ctx.db.insert("assetTags", {
        assetId: args.assetId,
        tagId,
        createdAt: asset.createdAt,
      });
    }

    await ctx.scheduler.runAfter(0, reindexAssetAction, {
      assetId: args.assetId,
    });

    return args.assetId;
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
      designInspirationId: v.optional(v.id("designInspirations")),
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
      assetRole: assetRoleValidator,
      ingestSource: ingestSourceValidator,
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.id);
    if (!asset) {
      return null;
    }
    if (args.ownerUserId && !canActorAccessOwnerUserId(args.ownerUserId, asset.ownerUserId)) {
      return null;
    }
    return asset;
  },
});

export const getGalleryAsset = query({
  args: {
    id: v.id("assets"),
    ownerUserId: v.optional(v.string()),
  },
  returns: v.union(v.null(), galleryAssetResultValidator),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.id);
    if (!asset) {
      return null;
    }
    if (args.ownerUserId && !canActorAccessOwnerUserId(args.ownerUserId, asset.ownerUserId)) {
      return null;
    }
    const [hydrated] = await hydrateGalleryAssetResults(ctx, [asset]);
    return hydrated ?? null;
  },
});

export const getAssetIdForIngestKey = internalQuery({
  args: {
    ownerUserId: v.string(),
    ingestKey: v.string(),
  },
  returns: v.union(v.null(), v.id("assets")),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    const ingestKey = args.ingestKey.trim();
    if (!ownerUserId || !ingestKey) {
      return null;
    }

    const existing = await ctx.db
      .query("assets")
      .withIndex("by_owner_ingestKey", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("ingestKey", ingestKey),
      )
      .unique();

    return existing?._id ?? null;
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
      designInspirationId: v.optional(v.id("designInspirations")),
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
      assetRole: assetRoleValidator,
      ingestSource: ingestSourceValidator,
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const ownerUserIds = resolveUserIdCandidates(ownerUserId);

    const limit = Math.min(args.limit ?? 50, 200);
    if (args.promptId) {
      const results = [];
      for (const ownerCandidate of ownerUserIds) {
        const rows = await ctx.db
          .query("assets")
          .withIndex("by_owner_prompt_createdAt", (q) =>
            q.eq("ownerUserId", ownerCandidate).eq("promptId", args.promptId).gte("createdAt", 0),
          )
          .order("desc")
          .take(limit);
        results.push(...rows);
      }
      return dedupeAssetIds(results)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
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
        if (asset && canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
          results.push(asset);
        }
      }
      return results;
    }
    if (args.folderId) {
      const results = [];
      for (const ownerCandidate of ownerUserIds) {
        const rows = await ctx.db
          .query("assets")
          .withIndex("by_owner_folder_createdAt", (q) =>
            q.eq("ownerUserId", ownerCandidate).eq("folderId", args.folderId).gte("createdAt", 0),
          )
          .order("desc")
          .take(limit);
        results.push(...rows);
      }
      return dedupeAssetIds(results)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
    }
    const kind = args.kind;
    if (kind) {
      const results = [];
      for (const ownerCandidate of ownerUserIds) {
        const rows = await ctx.db
          .query("assets")
          .withIndex("by_owner_kind_createdAt", (q) =>
            q.eq("ownerUserId", ownerCandidate).eq("kind", kind).gte("createdAt", 0),
          )
          .order("desc")
          .take(limit);
        results.push(...rows);
      }
      return dedupeAssetIds(results)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
    }

    const results = [];
    for (const ownerCandidate of ownerUserIds) {
      const rows = await ctx.db
        .query("assets")
        .withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", ownerCandidate).gte("createdAt", 0))
        .order("desc")
        .take(limit);
      results.push(...rows);
    }

    return dedupeAssetIds(results)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  },
});

const buildSearchHaystack = (
  promptText: string | undefined,
  fileName: string | undefined,
  sourceUrl: string | undefined,
) =>
  [promptText, fileName, sourceUrl]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

export const listGalleryAssets = query({
  args: {
    ownerUserId: v.string(),
    kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
    tagIds: v.optional(v.array(v.id("tags"))),
    folderId: v.optional(v.id("folders")),
    modelName: v.optional(v.string()),
    pillar: pillarValidator,
    assetRole: assetRoleValidator,
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
    const ownerUserIds = resolveUserIdCandidates(ownerUserId);
    const tagFilter =
      args.tagIds && args.tagIds.length > 0 ? new Set(args.tagIds) : null;
    const search = args.search?.trim().toLowerCase();
    const modelNameFilter = args.modelName?.trim() || null;
    const pillar = args.pillar;
    const assetRole = args.assetRole;
    const kind = args.kind;
    const ownerScopedAssets = (
      await Promise.all(
        ownerUserIds.map(async (ownerCandidate) =>
          await (pillar
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
            .take(limit),
        ),
      )
    ).flat();

    ownerScopedAssets.sort((a, b) => b.createdAt - a.createdAt);
    const seenAssetIds = new Set<Id<"assets">>();
    const assets = ownerScopedAssets.filter((asset) => {
      if (seenAssetIds.has(asset._id)) {
        return false;
      }
      seenAssetIds.add(asset._id);
      return true;
    });
    const filteredAssets = assets.filter((asset) => {
      if (tagFilter && !asset.tagIds.some((tagId) => tagFilter.has(tagId))) {
        return false;
      }
      if (args.folderId && asset.folderId !== args.folderId) {
        return false;
      }
      if (modelNameFilter && asset.modelName !== modelNameFilter) {
        return false;
      }
      if (assetRole && asset.assetRole !== assetRole) {
        return false;
      }
      if (kind && asset.kind !== kind) {
        return false;
      }
      return true;
    });

    if (filteredAssets.length === 0) {
      return [];
    }

    let selectedAssets = filteredAssets;
    let promptTextById: Map<Id<"prompts">, string>;
    if (search) {
      const promptIds = dedupeIds(
        filteredAssets
          .map((asset) => asset.promptId)
          .filter((promptId): promptId is Id<"prompts"> => Boolean(promptId)),
      );
      const promptEntries = await Promise.all(
        promptIds.map(async (promptId) => {
          const prompt = await ctx.db.get(promptId);
          return [promptId, prompt?.text] as const;
        }),
      );
      promptTextById = new Map(
        promptEntries.filter((entry): entry is [Id<"prompts">, string] => Boolean(entry[1])),
      );
      selectedAssets = filteredAssets.filter((asset) => {
        const promptText = asset.promptId
          ? promptTextById.get(asset.promptId)
          : undefined;
        return buildSearchHaystack(promptText, asset.fileName, asset.sourceUrl)
          .includes(search);
      });
    } else {
      selectedAssets = filteredAssets.slice(0, limit);
      promptTextById = new Map();
    }

    selectedAssets = selectedAssets.slice(0, limit);
    if (selectedAssets.length === 0) {
      return [];
    }

    return await hydrateGalleryAssetResults(ctx, selectedAssets);
  },
});

export const listPublicGalleryAssets = query({
  args: {
    kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
    tagIds: v.optional(v.array(v.id("tags"))),
    folderId: v.optional(v.id("folders")),
    modelName: v.optional(v.string()),
    pillar: pillarValidator,
    assetRole: assetRoleValidator,
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
    const assetRole = args.assetRole;
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

    const filteredAssets = baseAssets.filter((asset) => {
      if (tagFilter && !asset.tagIds.some((tagId) => tagFilter.has(tagId))) {
        return false;
      }
      if (args.folderId && asset.folderId !== args.folderId) {
        return false;
      }
      if (modelNameFilter && asset.modelName !== modelNameFilter) {
        return false;
      }
      if (assetRole && asset.assetRole !== assetRole) {
        return false;
      }
      return true;
    });

    if (filteredAssets.length === 0) {
      return [];
    }

    let selectedAssets = filteredAssets;
    let promptTextById: Map<Id<"prompts">, string>;
    if (search) {
      const promptIds = dedupeIds(
        filteredAssets
          .map((asset) => asset.promptId)
          .filter((promptId): promptId is Id<"prompts"> => Boolean(promptId)),
      );
      const promptEntries = await Promise.all(
        promptIds.map(async (promptId) => {
          const prompt = await ctx.db.get(promptId);
          return [promptId, prompt?.text] as const;
        }),
      );
      promptTextById = new Map(
        promptEntries.filter((entry): entry is [Id<"prompts">, string] => Boolean(entry[1])),
      );
      selectedAssets = filteredAssets.filter((asset) => {
        const promptText = asset.promptId
          ? promptTextById.get(asset.promptId)
          : undefined;
        return buildSearchHaystack(promptText, asset.fileName, asset.sourceUrl)
          .includes(search);
      });
    } else {
      selectedAssets = filteredAssets.slice(0, limit);
      promptTextById = new Map();
    }

    selectedAssets = selectedAssets.slice(0, limit);
    if (selectedAssets.length === 0) {
      return [];
    }

    return await hydrateGalleryAssetResults(ctx, selectedAssets);
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

    const canCurate = canActorAccessByUserId(actorUserId, allowedUserIds);
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
    await ctx.scheduler.runAfter(0, reindexAssetAction, {
      assetId: args.assetId,
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
    if (existing) {
      return true;
    }
    const ownerCandidates = resolveUserIdCandidates(ownerUserId).filter(
      (candidate) => candidate !== ownerUserId,
    );
    for (const ownerCandidate of ownerCandidates) {
      const existingByCandidate = await ctx.db
        .query("assets")
        .withIndex("by_owner_ingestKey", (q) =>
          q.eq("ownerUserId", ownerCandidate).eq("ingestKey", args.ingestKey),
        )
        .unique();
      if (existingByCandidate) {
        return true;
      }
    }
    return false;
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
      const ownerUserIds = resolveUserIdCandidates(ownerUserId);
      const rows = [];
      for (const ownerCandidate of ownerUserIds) {
        const rowsForOwner = await ctx.db
          .query("assets")
          .withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", ownerCandidate).gte("createdAt", 0))
          .collect();
        rows.push(...rowsForOwner);
      }
      return dedupeAssetIds(rows).length;
    }
    return await ctx.db.query("assets").collect().then((rows) => rows.length);
  },
});

export const tagAssetCounts = query({
  args: {
    ownerUserId: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
  },
  returns: v.array(v.object({ tagId: v.id("tags"), count: v.number() })),
  handler: async (ctx, args) => {
    let assets;
    if (args.isPublic) {
      assets = await ctx.db
        .query("assets")
        .withIndex("by_isPublic_createdAt", (q) => q.eq("isPublic", true))
        .collect();
    } else if (args.ownerUserId) {
      const ownerUserId = args.ownerUserId.trim();
      if (!ownerUserId) {
        throw new ConvexError("ownerUserId is required when provided.");
      }
      const ownerUserIds = resolveUserIdCandidates(ownerUserId);
      const rows = [];
      for (const ownerCandidate of ownerUserIds) {
        const rowsForOwner = await ctx.db
          .query("assets")
          .withIndex("by_owner_createdAt", (q) =>
            q.eq("ownerUserId", ownerCandidate).gte("createdAt", 0),
          )
          .collect();
        rows.push(...rowsForOwner);
      }
      assets = dedupeAssetIds(rows);
    } else {
      assets = await ctx.db.query("assets").collect();
    }

    const counts = new Map<Id<"tags">, number>();
    for (const asset of assets) {
      const seen = new Set<Id<"tags">>();
      for (const tagId of asset.tagIds) {
        if (seen.has(tagId)) continue;
        seen.add(tagId);
        counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries()).map(([tagId, count]) => ({
      tagId,
      count,
    }));
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

    if (!canActorAccessOwnerUserId(ownerUserId, asset.ownerUserId)) {
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
    await ctx.scheduler.runAfter(0, reindexAssetAction, {
      assetId: args.id,
    });

    return null;
  },
});

export const bulkDeleteAssets = internalMutation({
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

export const wipeAllAssets = internalMutation({
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
