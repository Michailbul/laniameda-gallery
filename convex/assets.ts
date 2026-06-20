import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  reconcileAssetPackMembership,
  syncPromptAssetPack,
} from "./assetPackHelpers";
import { bumpTagUsage, canonicalTagKey, dedupeIds, normalizeTagName } from "./helpers";
import { ensureFolderOwnership } from "./folderHelpers";
import { r2 } from "./r2";
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
  cinemaMetadataValidator,
  generationTypeValidator,
  ingestSourceValidator,
  optionalPillarValidator,
} from "./validators";

const pillarValidator = optionalPillarValidator;
const reindexAssetAction = makeFunctionReference<"action">(
  "semanticIndex:reindexAsset",
);
const reindexPromptAction = makeFunctionReference<"action">(
  "semanticIndex:reindexPrompt",
);

const nullableStringValidator = v.optional(v.union(v.null(), v.string()));
const assetKindValidator = v.union(v.literal("image"), v.literal("video"));
const optionalAssetKindValidator = v.optional(assetKindValidator);
const nullableGenerationTypeValidator = v.optional(v.union(
  v.null(),
  v.literal("image_gen"),
  v.literal("video_gen"),
  v.literal("ui_design"),
  v.literal("workflow"),
  v.literal("other"),
));
const nullableAssetRoleValidator = v.optional(v.union(
  v.null(),
  v.literal("generated_output"),
  v.literal("reference"),
  v.literal("inspiration_capture"),
  v.literal("workflow_asset"),
  v.literal("cinema_frame"),
  v.literal("other"),
));
const nullableIngestSourceValidator = v.optional(v.union(
  v.null(),
  v.literal("api"),
  v.literal("agent"),
  v.literal("telegram"),
  v.literal("manual"),
  v.literal("import"),
));

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

const getCuratorUserIdsFromEnv = () => {
  return parseUserIdList(
    process.env.CURATION_ADMIN_USER_IDS ?? process.env.KB_OWNER_USER_ID,
  );
};

const assertCurationAdmin = (actorUserId: string, adminSecret: string) => {
  const expectedSecret = process.env.CURATION_ADMIN_SECRET;
  if (!expectedSecret || adminSecret !== expectedSecret) {
    throw new ConvexError("Unauthorized admin request.");
  }
  const trimmedActor = actorUserId.trim();
  if (!trimmedActor) {
    throw new ConvexError("actorUserId is required.");
  }
  const allowedUserIds = getCuratorUserIdsFromEnv();
  if (allowedUserIds.length === 0) {
    throw new ConvexError("Admin user list is not configured.");
  }
  if (!canActorAccessByUserId(trimmedActor, allowedUserIds)) {
    throw new ConvexError("Forbidden admin actor.");
  }
};

const hasOwn = <T extends object>(value: T, key: PropertyKey) =>
  Object.prototype.hasOwnProperty.call(value, key);

const resolveTagIdsForNames = async (
  ctx: MutationCtx,
  names: string[],
  pillar: string | undefined,
) => {
  const cleanedNames = Array.from(
    new Set(names.map((name) => name.trim()).filter(Boolean)),
  );
  if (cleanedNames.length === 0) {
    return [] as Id<"tags">[];
  }

  const allTags = await ctx.db
    .query("tags")
    .withIndex("by_normalized", (q) => q.gte("normalized", ""))
    .collect();
  const byNormalized = new Map(allTags.map((tag) => [tag.normalized, tag]));
  const byCanonical = new Map<string, Doc<"tags">>();
  for (const tag of allTags) {
    const canonical = canonicalTagKey(tag.name);
    if (canonical) byCanonical.set(canonical, tag);
  }

  const tagIds: Id<"tags">[] = [];
  for (const name of cleanedNames) {
    const normalized = normalizeTagName(name);
    const canonical = canonicalTagKey(name);
    const existing =
      byNormalized.get(normalized) ||
      (canonical ? byCanonical.get(canonical) : undefined);
    if (existing) {
      tagIds.push(existing._id);
      continue;
    }

    const tagId = await ctx.db.insert("tags", {
      name,
      normalized,
      usageCount: 0,
      pillar,
      source: "user",
    });
    const inserted = {
      _id: tagId,
      _creationTime: Date.now(),
      name,
      normalized,
      usageCount: 0,
      pillar,
      source: "user" as const,
    } as Doc<"tags">;
    byNormalized.set(normalized, inserted);
    if (canonical) byCanonical.set(canonical, inserted);
    tagIds.push(tagId);
  }

  return dedupeIds(tagIds);
};

const replaceAssetTagLinks = async (
  ctx: MutationCtx,
  asset: Doc<"assets">,
  tagIds: Id<"tags">[],
) => {
  const nextTagIds = dedupeIds(tagIds);
  await bumpTagUsage(ctx, asset.tagIds, -1);
  await bumpTagUsage(ctx, nextTagIds, 1);

  const links = await ctx.db
    .query("assetTags")
    .withIndex("by_asset", (q) => q.eq("assetId", asset._id))
    .collect();
  for (const link of links) {
    await ctx.db.delete(link._id);
  }
  for (const tagId of nextTagIds) {
    await ctx.db.insert("assetTags", {
      assetId: asset._id,
      tagId,
      createdAt: asset.createdAt,
    });
  }
};

const replacePromptTagLinks = async (
  ctx: MutationCtx,
  prompt: Doc<"prompts">,
  tagIds: Id<"tags">[],
) => {
  const nextTagIds = dedupeIds(tagIds);
  await bumpTagUsage(ctx, prompt.tagIds, -1);
  await bumpTagUsage(ctx, nextTagIds, 1);

  const links = await ctx.db
    .query("promptTags")
    .withIndex("by_prompt", (q) => q.eq("promptId", prompt._id))
    .collect();
  for (const link of links) {
    await ctx.db.delete(link._id);
  }
  for (const tagId of nextTagIds) {
    await ctx.db.insert("promptTags", {
      promptId: prompt._id,
      tagId,
      createdAt: prompt.createdAt,
    });
  }
};

const dedupeAssetIds = <T extends { _id: string }>(rows: T[]) => {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row._id)) return false;
    seen.add(row._id);
    return true;
  });
};

const dedupeFolderIds = (folderIds: Array<Id<"folders"> | undefined>) =>
  dedupeIds(
    folderIds.filter((folderId): folderId is Id<"folders"> =>
      Boolean(folderId),
    ),
  );

const getAssetFolderLinks = async (
  ctx: QueryCtx | MutationCtx,
  assetId: Id<"assets">,
) =>
  await ctx.db
    .query("assetFolders")
    .withIndex("by_asset", (q) => q.eq("assetId", assetId))
    .collect();

const addAssetFolderLink = async (
  ctx: MutationCtx,
  ownerUserId: string,
  assetId: Id<"assets">,
  folderId: Id<"folders">,
) => {
  const existing = await ctx.db
    .query("assetFolders")
    .withIndex("by_asset_folder", (q) =>
      q.eq("assetId", assetId).eq("folderId", folderId),
    )
    .unique();
  if (existing) {
    return;
  }

  await ctx.db.insert("assetFolders", {
    ownerUserId,
    assetId,
    folderId,
    createdAt: Date.now(),
  });
};

const replaceAssetFolderLinks = async (
  ctx: MutationCtx,
  ownerUserId: string,
  asset: Doc<"assets">,
  folderIds: Id<"folders">[],
) => {
  const nextFolderIds = dedupeFolderIds(folderIds);
  for (const folderId of nextFolderIds) {
    await ensureFolderOwnership(ctx, ownerUserId, folderId);
  }

  const existingLinks = await getAssetFolderLinks(ctx, asset._id);
  const nextSet = new Set(nextFolderIds);

  for (const link of existingLinks) {
    if (!nextSet.has(link.folderId)) {
      await ctx.db.delete(link._id);
    }
  }

  const existingSet = new Set(existingLinks.map((link) => link.folderId));
  for (const folderId of nextFolderIds) {
    if (!existingSet.has(folderId)) {
      await addAssetFolderLink(ctx, ownerUserId, asset._id, folderId);
    }
  }

  const primaryFolderId = nextFolderIds[0];
  if (asset.folderId !== primaryFolderId) {
    await ctx.db.patch(asset._id, {
      folderId: primaryFolderId,
    });
  }

  return {
    folderId: primaryFolderId,
    folderIds: nextFolderIds,
  };
};

const collectAssetsForFolder = async (
  ctx: QueryCtx,
  ownerUserIds: string[],
  folderId: Id<"folders">,
  limit: number,
) => {
  const primaryAssets = [];
  const linkedAssets = [];
  for (const ownerCandidate of ownerUserIds) {
    const primaryRows = await ctx.db
      .query("assets")
      .withIndex("by_owner_folder_createdAt", (q) =>
        q.eq("ownerUserId", ownerCandidate).eq("folderId", folderId).gte("createdAt", 0),
      )
      .order("desc")
      .take(limit);
    primaryAssets.push(...primaryRows);

    const links = await ctx.db
      .query("assetFolders")
      .withIndex("by_owner_folder_createdAt", (q) =>
        q.eq("ownerUserId", ownerCandidate).eq("folderId", folderId).gte("createdAt", 0),
      )
      .order("desc")
      .take(limit);
    for (const link of links) {
      const asset = await ctx.db.get(link.assetId);
      if (asset && canActorAccessOwnerUserId(ownerCandidate, asset.ownerUserId)) {
        linkedAssets.push(asset);
      }
    }
  }

  return dedupeAssetIds([...primaryAssets, ...linkedAssets])
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
};

const collectAssetIdsForFolder = async (
  ctx: QueryCtx,
  folderId: Id<"folders">,
  limit: number,
) => {
  const primaryAssets = await ctx.db
    .query("assets")
    .withIndex("by_folder_createdAt", (q) =>
      q.eq("folderId", folderId).gte("createdAt", 0),
    )
    .order("desc")
    .take(limit);
  const links = await ctx.db
    .query("assetFolders")
    .withIndex("by_folder_createdAt", (q) =>
      q.eq("folderId", folderId).gte("createdAt", 0),
    )
    .order("desc")
    .take(limit);

  return new Set<Id<"assets">>([
    ...primaryAssets.map((asset) => asset._id),
    ...links.map((link) => link.assetId),
  ]);
};

export const createAsset = mutation({
  args: {
    ownerUserId: v.string(),
    kind: v.union(v.literal("image"), v.literal("video")),
    storageId: v.optional(v.id("_storage")),
    thumbStorageId: v.optional(v.id("_storage")),
    r2Key: v.optional(v.string()),
    r2Bucket: v.optional(v.string()),
    thumbR2Key: v.optional(v.string()),
    thumbR2Bucket: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    fileName: v.optional(v.string()),
    description: v.optional(v.string()),
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
    cinemaMetadata: cinemaMetadataValidator,
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
        if (args.folderId) {
          await addAssetFolderLink(ctx, ownerUserId, existing._id, args.folderId);
          if (!existing.folderId) {
            await ctx.db.patch(existing._id, { folderId: args.folderId });
          }
        }
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
      r2Key: args.r2Key,
      r2Bucket: args.r2Bucket,
      thumbR2Key: args.thumbR2Key,
      thumbR2Bucket: args.thumbR2Bucket,
      sourceUrl: args.sourceUrl,
      fileName: args.fileName,
      description: args.description,
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
      cinemaMetadata: args.cinemaMetadata,
      createdAt,
    });

    for (const tagId of tagIds) {
      await ctx.db.insert("assetTags", {
        assetId,
        tagId,
        createdAt,
      });
    }
    if (args.folderId) {
      await addAssetFolderLink(ctx, ownerUserId, assetId, args.folderId);
    }

    await bumpTagUsage(ctx, tagIds, 1);
    if (args.promptId) {
      await syncPromptAssetPack(ctx, {
        ownerUserId,
        promptId: args.promptId,
      });
    }
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
    folderIds: v.array(v.id("folders")),
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
    const result = await replaceAssetFolderLinks(
      ctx,
      ownerUserId,
      asset,
      args.folderId ? [args.folderId] : [],
    );

    return {
      assetId: args.assetId,
      folderId: result.folderId,
      folderIds: result.folderIds,
    };
  },
});

export const setAssetFolders = mutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    folderIds: v.array(v.id("folders")),
  },
  returns: v.object({
    assetId: v.id("assets"),
    folderId: v.optional(v.id("folders")),
    folderIds: v.array(v.id("folders")),
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

    const result = await replaceAssetFolderLinks(
      ctx,
      ownerUserId,
      asset,
      args.folderIds,
    );

    return {
      assetId: args.assetId,
      folderId: result.folderId,
      folderIds: result.folderIds,
    };
  },
});

export const addAssetFolders = mutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    folderIds: v.array(v.id("folders")),
  },
  returns: v.object({
    assetId: v.id("assets"),
    folderId: v.optional(v.id("folders")),
    folderIds: v.array(v.id("folders")),
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

    const requestedFolderIds = dedupeFolderIds(args.folderIds);
    for (const folderId of requestedFolderIds) {
      await ensureFolderOwnership(ctx, ownerUserId, folderId);
    }

    const existingLinks = await getAssetFolderLinks(ctx, args.assetId);
    const folderIds = dedupeFolderIds([
      asset.folderId,
      ...existingLinks.map((link) => link.folderId),
      ...requestedFolderIds,
    ]);

    for (const folderId of folderIds) {
      await addAssetFolderLink(ctx, ownerUserId, args.assetId, folderId);
    }

    const primaryFolderId = asset.folderId ?? folderIds[0];
    if (primaryFolderId && asset.folderId !== primaryFolderId) {
      await ctx.db.patch(args.assetId, {
        folderId: primaryFolderId,
      });
    }

    return {
      assetId: args.assetId,
      folderId: primaryFolderId,
      folderIds,
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
    description: v.optional(v.string()),
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
    const previousPromptId = asset.promptId;
    await ctx.db.patch(args.assetId, {
      tagIds,
      folderId: args.folderId,
      promptId: args.promptId,
      sourceUrl: args.sourceUrl,
      fileName: args.fileName,
      description: args.description,
      contentType: args.contentType,
      modelName: args.modelName,
      pillar: args.pillar,
      generationType: args.generationType,
      assetRole: args.assetRole,
      ingestSource: args.ingestSource,
    });
    if (args.folderId) {
      await addAssetFolderLink(ctx, ownerUserId, args.assetId, args.folderId);
    }

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

    const promptIdsToSync = Array.from(
      new Set(
        [previousPromptId, args.promptId].filter(
          (promptId): promptId is Id<"prompts"> => Boolean(promptId),
        ),
      ),
    );
    for (const promptId of promptIdsToSync) {
      await syncPromptAssetPack(ctx, {
        ownerUserId,
        promptId,
      });
    }

    return args.assetId;
  },
});

export const adminUpdateAsset = mutation({
  args: {
    assetId: v.id("assets"),
    actorUserId: v.string(),
    adminSecret: v.string(),
    description: nullableStringValidator,
    promptText: nullableStringValidator,
    tagNames: v.optional(v.array(v.string())),
    folderId: v.optional(v.union(v.null(), v.id("folders"))),
    kind: optionalAssetKindValidator,
    sourceUrl: nullableStringValidator,
    fileName: nullableStringValidator,
    contentType: nullableStringValidator,
    modelName: nullableStringValidator,
    pillar: nullableStringValidator,
    generationType: nullableGenerationTypeValidator,
    assetRole: nullableAssetRoleValidator,
    ingestSource: nullableIngestSourceValidator,
  },
  returns: v.object({
    assetId: v.id("assets"),
    promptId: v.optional(v.id("prompts")),
    promptText: v.optional(v.string()),
    kind: assetKindValidator,
    description: v.optional(v.string()),
    tagIds: v.array(v.id("tags")),
    tagNames: v.array(v.string()),
    folderId: v.optional(v.id("folders")),
    sourceUrl: v.optional(v.string()),
    fileName: v.optional(v.string()),
    contentType: v.optional(v.string()),
    modelName: v.optional(v.string()),
    pillar: pillarValidator,
    generationType: generationTypeValidator,
    assetRole: assetRoleValidator,
    ingestSource: ingestSourceValidator,
  }),
  handler: async (ctx, args) => {
    assertCurationAdmin(args.actorUserId, args.adminSecret);

    const asset = await ctx.db.get(args.assetId);
    if (!asset) {
      throw new ConvexError("Asset not found.");
    }

    const ownerUserId = asset.ownerUserId?.trim() || args.actorUserId.trim();
    const nextPillar = hasOwn(args, "pillar")
      ? normalizeOptionalString(args.pillar)
      : asset.pillar;
    const nextFolderId = hasOwn(args, "folderId")
      ? (args.folderId ?? undefined)
      : asset.folderId;
    await ensureFolderOwnership(ctx, ownerUserId, nextFolderId);

    const nextTagIds = hasOwn(args, "tagNames")
      ? await resolveTagIdsForNames(ctx, args.tagNames ?? [], nextPillar)
      : asset.tagIds;
    if (hasOwn(args, "tagNames")) {
      await replaceAssetTagLinks(ctx, asset, nextTagIds);
    }

    const previousPromptId = asset.promptId;
    let nextPromptId = asset.promptId;
    let nextPromptText: string | undefined;
    const shouldEditPrompt = hasOwn(args, "promptText");
    if (shouldEditPrompt) {
      nextPromptText = normalizeOptionalString(args.promptText);
      if (!nextPromptText) {
        nextPromptId = undefined;
      } else if (asset.promptId) {
        const prompt = await ctx.db.get(asset.promptId);
        if (prompt) {
          const promptPatch = {
            text: nextPromptText,
            tagIds: hasOwn(args, "tagNames") ? nextTagIds : prompt.tagIds,
            folderId: nextFolderId,
            pillar: nextPillar,
            modelName: hasOwn(args, "modelName")
              ? normalizeOptionalString(args.modelName)
              : prompt.modelName,
          };
          await ctx.db.patch(prompt._id, promptPatch);
          if (hasOwn(args, "tagNames")) {
            await replacePromptTagLinks(ctx, prompt, nextTagIds);
          }
          await ctx.scheduler.runAfter(0, reindexPromptAction, {
            promptId: prompt._id,
          });
          nextPromptId = prompt._id;
        } else {
          nextPromptId = undefined;
        }
      }

      if (nextPromptText && !nextPromptId) {
        const createdAt = Date.now();
        nextPromptId = await ctx.db.insert("prompts", {
          ownerUserId,
          text: nextPromptText,
          tagIds: nextTagIds,
          folderId: nextFolderId,
          pillar: nextPillar,
          modelName: hasOwn(args, "modelName")
            ? normalizeOptionalString(args.modelName)
            : asset.modelName,
          createdAt,
        });
        for (const tagId of nextTagIds) {
          await ctx.db.insert("promptTags", {
            promptId: nextPromptId,
            tagId,
            createdAt,
          });
        }
        await bumpTagUsage(ctx, nextTagIds, 1);
        await ctx.scheduler.runAfter(0, reindexPromptAction, {
          promptId: nextPromptId,
        });
      }
    } else if (asset.promptId) {
      const prompt = await ctx.db.get(asset.promptId);
      nextPromptText = prompt?.text;
    }

    await ctx.db.patch(args.assetId, {
      tagIds: nextTagIds,
      folderId: nextFolderId,
      promptId: nextPromptId,
      kind: hasOwn(args, "kind") ? args.kind : asset.kind,
      description: hasOwn(args, "description")
        ? normalizeOptionalString(args.description)
        : asset.description,
      sourceUrl: hasOwn(args, "sourceUrl")
        ? normalizeOptionalString(args.sourceUrl)
        : asset.sourceUrl,
      fileName: hasOwn(args, "fileName")
        ? normalizeOptionalString(args.fileName)
        : asset.fileName,
      contentType: hasOwn(args, "contentType")
        ? normalizeOptionalString(args.contentType)
        : asset.contentType,
      modelName: hasOwn(args, "modelName")
        ? normalizeOptionalString(args.modelName)
        : asset.modelName,
      pillar: nextPillar,
      generationType: hasOwn(args, "generationType")
        ? (args.generationType ?? undefined)
        : asset.generationType,
      assetRole: hasOwn(args, "assetRole")
        ? (args.assetRole ?? undefined)
        : asset.assetRole,
      ingestSource: hasOwn(args, "ingestSource")
        ? (args.ingestSource ?? undefined)
        : asset.ingestSource,
    });
    if (hasOwn(args, "folderId")) {
      await replaceAssetFolderLinks(
        ctx,
        ownerUserId,
        { ...asset, folderId: nextFolderId },
        nextFolderId ? [nextFolderId] : [],
      );
    }

    await ctx.scheduler.runAfter(0, reindexAssetAction, {
      assetId: args.assetId,
    });

    const promptIdsToSync = Array.from(
      new Set(
        [previousPromptId, nextPromptId].filter(
          (promptId): promptId is Id<"prompts"> => Boolean(promptId),
        ),
      ),
    );
    for (const promptId of promptIdsToSync) {
      await syncPromptAssetPack(ctx, {
        ownerUserId,
        promptId,
      });
    }

    const finalAsset = await ctx.db.get(args.assetId);
    if (!finalAsset) {
      throw new ConvexError("Asset not found after update.");
    }
    const tags = await Promise.all(
      finalAsset.tagIds.map(async (tagId) => await ctx.db.get(tagId)),
    );
    const prompt = finalAsset.promptId
      ? await ctx.db.get(finalAsset.promptId)
      : null;

    return {
      assetId: finalAsset._id,
      promptId: finalAsset.promptId,
      promptText: prompt?.text,
      kind: finalAsset.kind,
      description: finalAsset.description,
      tagIds: finalAsset.tagIds,
      tagNames: tags
        .map((tag) => tag?.name)
        .filter((name): name is string => Boolean(name)),
      folderId: finalAsset.folderId,
      sourceUrl: finalAsset.sourceUrl,
      fileName: finalAsset.fileName,
      contentType: finalAsset.contentType,
      modelName: finalAsset.modelName,
      pillar: finalAsset.pillar,
      generationType: finalAsset.generationType,
      assetRole: finalAsset.assetRole,
      ingestSource: finalAsset.ingestSource,
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
      r2Key: v.optional(v.string()),
      r2Bucket: v.optional(v.string()),
      thumbR2Key: v.optional(v.string()),
      thumbR2Bucket: v.optional(v.string()),
      sourceUrl: v.optional(v.string()),
      fileName: v.optional(v.string()),
      description: v.optional(v.string()),
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
      assetPackId: v.optional(v.id("assetPacks")),
      packSlotIndex: v.optional(v.number()),
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
      r2Key: v.optional(v.string()),
      r2Bucket: v.optional(v.string()),
      thumbR2Key: v.optional(v.string()),
      thumbR2Bucket: v.optional(v.string()),
      sourceUrl: v.optional(v.string()),
      fileName: v.optional(v.string()),
      description: v.optional(v.string()),
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
      assetPackId: v.optional(v.id("assetPacks")),
      packSlotIndex: v.optional(v.number()),
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
      return await collectAssetsForFolder(
        ctx,
        ownerUserIds,
        args.folderId,
        limit,
      );
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

const galleryAssetFacetsValidator = v.object({
  totalCount: v.number(),
  modelCounts: v.array(v.object({ name: v.string(), count: v.number() })),
});

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
    const hasPostQueryFilters = Boolean(
      (args.tagIds && args.tagIds.length > 0) ||
        (args.folderId && (args.pillar || args.modelName || args.assetRole || args.kind)) ||
        (args.modelName && (args.pillar || args.folderId || args.assetRole || args.kind)) ||
        (args.pillar && (args.folderId || args.modelName || args.kind)) ||
        (args.assetRole && (args.folderId || args.modelName || args.kind)) ||
        args.search,
    );
    const queryTake = hasPostQueryFilters ? Math.min(limit * 4, 600) : limit;
    const ownerUserIds = resolveUserIdCandidates(ownerUserId);
    const tagFilter =
      args.tagIds && args.tagIds.length > 0 ? new Set(args.tagIds) : null;
    const search = args.search?.trim().toLowerCase();
    const modelNameFilter = args.modelName?.trim() || null;
    const pillar = args.pillar;
    const assetRole = args.assetRole;
    const kind = args.kind;
    const ownerScopedAssets = args.folderId
      ? await collectAssetsForFolder(ctx, ownerUserIds, args.folderId, queryTake)
      : (
          await Promise.all(
            ownerUserIds.map(async (ownerCandidate) => {
              if (modelNameFilter) {
                return await ctx.db
                  .query("assets")
                  .withIndex("by_owner_modelName_createdAt", (q) =>
                    q.eq("ownerUserId", ownerCandidate).eq("modelName", modelNameFilter).gte("createdAt", 0),
                  )
                  .order("desc")
                  .take(queryTake);
              }
              if (pillar && assetRole) {
                return await ctx.db
                  .query("assets")
                  .withIndex("by_owner_pillar_assetRole_createdAt", (q) =>
                    q.eq("ownerUserId", ownerCandidate).eq("pillar", pillar).eq("assetRole", assetRole).gte("createdAt", 0),
                  )
                  .order("desc")
                  .take(queryTake);
              }
              if (pillar) {
                return await ctx.db
                  .query("assets")
                  .withIndex("by_owner_pillar_createdAt", (q) =>
                    q.eq("ownerUserId", ownerCandidate).eq("pillar", pillar).gte("createdAt", 0),
                  )
                  .order("desc")
                  .take(queryTake);
              }
              if (assetRole) {
                return await ctx.db
                  .query("assets")
                  .withIndex("by_owner_assetRole_createdAt", (q) =>
                    q.eq("ownerUserId", ownerCandidate).eq("assetRole", assetRole).gte("createdAt", 0),
                  )
                  .order("desc")
                  .take(queryTake);
              }
              if (kind) {
                return await ctx.db
                  .query("assets")
                  .withIndex("by_owner_kind_createdAt", (q) =>
                    q.eq("ownerUserId", ownerCandidate).eq("kind", kind).gte("createdAt", 0),
                  )
                  .order("desc")
                  .take(queryTake);
              }
              return await ctx.db
                .query("assets")
                .withIndex("by_owner_createdAt", (q) =>
                  q.eq("ownerUserId", ownerCandidate).gte("createdAt", 0),
                )
                .order("desc")
                .take(queryTake);
            }),
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

export const galleryAssetFacets = query({
  args: {
    ownerUserId: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
  },
  returns: galleryAssetFacetsValidator,
  handler: async (ctx, args) => {
    let assets: Doc<"assets">[];
    if (args.ownerUserId) {
      const ownerUserId = args.ownerUserId.trim();
      if (!ownerUserId) {
        throw new ConvexError("ownerUserId is required when provided.");
      }
      const rows: Doc<"assets">[] = [];
      for (const ownerCandidate of resolveUserIdCandidates(ownerUserId)) {
        const rowsForOwner = await ctx.db
          .query("assets")
          .withIndex("by_owner_createdAt", (q) =>
            q.eq("ownerUserId", ownerCandidate).gte("createdAt", 0),
          )
          .collect();
        rows.push(...rowsForOwner);
      }
      assets = dedupeAssetIds(rows);
    } else if (args.isPublic) {
      assets = await ctx.db
        .query("assets")
        .withIndex("by_isPublic_createdAt", (q) => q.eq("isPublic", true))
        .collect();
    } else {
      assets = await ctx.db.query("assets").collect();
    }

    const modelCountsByKey = new Map<string, { name: string; count: number }>();
    for (const asset of assets) {
      const trimmed = asset.modelName?.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      const existing = modelCountsByKey.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        modelCountsByKey.set(key, { name: trimmed, count: 1 });
      }
    }

    return {
      totalCount: assets.length,
      modelCounts: Array.from(modelCountsByKey.values()).sort((left, right) => {
        const countDiff = right.count - left.count;
        if (countDiff !== 0) return countDiff;
        return left.name.localeCompare(right.name);
      }),
    };
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

    const folderAssetIds = args.folderId
      ? await collectAssetIdsForFolder(ctx, args.folderId, queryTake)
      : null;

    const filteredAssets = baseAssets.filter((asset) => {
      if (tagFilter && !asset.tagIds.some((tagId) => tagFilter.has(tagId))) {
        return false;
      }
      if (folderAssetIds && !folderAssetIds.has(asset._id)) {
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

const BULK_CURATION_MAX = 200;

export const bulkSetAssetCuration = mutation({
  args: {
    assetIds: v.array(v.id("assets")),
    actorUserId: v.string(),
    isPublic: v.boolean(),
    isFeatured: v.optional(v.boolean()),
    adminSecret: v.string(),
  },
  returns: v.object({
    updatedCount: v.number(),
    skippedCount: v.number(),
    isPublic: v.boolean(),
    curatedAt: v.number(),
    updatedAssetIds: v.array(v.id("assets")),
    missingAssetIds: v.array(v.id("assets")),
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

    if (args.assetIds.length === 0) {
      throw new ConvexError("At least one assetId is required.");
    }
    if (args.assetIds.length > BULK_CURATION_MAX) {
      throw new ConvexError(
        `Bulk curation is limited to ${BULK_CURATION_MAX} assets per request.`,
      );
    }

    const uniqueAssetIds = Array.from(new Set(args.assetIds));
    const curatedAt = Date.now();
    const nextIsPublic = args.isPublic;
    const updatedAssetIds: Id<"assets">[] = [];
    const missingAssetIds: Id<"assets">[] = [];

    for (const assetId of uniqueAssetIds) {
      const asset = await ctx.db.get(assetId);
      if (!asset) {
        missingAssetIds.push(assetId);
        continue;
      }

      const nextIsFeatured =
        args.isFeatured !== undefined
          ? args.isFeatured && nextIsPublic
          : Boolean(asset.isFeatured && nextIsPublic);

      await ctx.db.patch(assetId, {
        isPublic: nextIsPublic,
        isFeatured: nextIsFeatured,
        curatedByUserId: actorUserId,
        curatedAt,
      });
      await ctx.scheduler.runAfter(0, reindexAssetAction, { assetId });
      updatedAssetIds.push(assetId);
    }

    return {
      updatedCount: updatedAssetIds.length,
      skippedCount: missingAssetIds.length,
      isPublic: nextIsPublic,
      curatedAt,
      updatedAssetIds,
      missingAssetIds,
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

export const replaceAssetThumbnail = mutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    newThumbStorageId: v.optional(v.id("_storage")),
    newThumbR2Key: v.optional(v.string()),
    newThumbR2Bucket: v.optional(v.string()),
    thumbWidth: v.optional(v.number()),
    thumbHeight: v.optional(v.number()),
    thumbSize: v.optional(v.number()),
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

    // Delete old thumbnail from storage
    if (asset.thumbStorageId && asset.thumbStorageId !== args.newThumbStorageId) {
      await ctx.storage.delete(asset.thumbStorageId);
    }
    if (asset.thumbR2Key && asset.thumbR2Key !== args.newThumbR2Key) {
      await r2.deleteObject(ctx, asset.thumbR2Key);
    }

    await ctx.db.patch(args.assetId, {
      thumbStorageId: args.newThumbStorageId,
      thumbR2Key: args.newThumbR2Key,
      thumbR2Bucket: args.newThumbR2Bucket,
      thumbWidth: args.thumbWidth,
      thumbHeight: args.thumbHeight,
      thumbSize: args.thumbSize,
    });

    return args.assetId;
  },
});

export const replaceAssetMedia = mutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    storageId: v.optional(v.id("_storage")),
    thumbStorageId: v.optional(v.id("_storage")),
    r2Key: v.optional(v.string()),
    r2Bucket: v.optional(v.string()),
    thumbR2Key: v.optional(v.string()),
    thumbR2Bucket: v.optional(v.string()),
    kind: v.union(v.literal("image"), v.literal("video")),
    contentType: v.optional(v.string()),
    fileName: v.optional(v.string()),
    size: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    thumbSize: v.optional(v.number()),
    thumbWidth: v.optional(v.number()),
    thumbHeight: v.optional(v.number()),
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

    if (asset.storageId && asset.storageId !== args.storageId) {
      await ctx.storage.delete(asset.storageId);
    }
    if (asset.thumbStorageId && asset.thumbStorageId !== args.thumbStorageId) {
      await ctx.storage.delete(asset.thumbStorageId);
    }
    if (asset.r2Key && asset.r2Key !== args.r2Key) {
      await r2.deleteObject(ctx, asset.r2Key);
    }
    if (asset.thumbR2Key && asset.thumbR2Key !== args.thumbR2Key) {
      await r2.deleteObject(ctx, asset.thumbR2Key);
    }

    await ctx.db.patch(args.assetId, {
      storageId: args.storageId,
      thumbStorageId: args.thumbStorageId,
      r2Key: args.r2Key,
      r2Bucket: args.r2Bucket,
      thumbR2Key: args.thumbR2Key,
      thumbR2Bucket: args.thumbR2Bucket,
      kind: args.kind,
      contentType: args.contentType,
      fileName: args.fileName,
      size: args.size,
      width: args.width,
      height: args.height,
      thumbSize: args.thumbSize,
      thumbWidth: args.thumbWidth,
      thumbHeight: args.thumbHeight,
    });

    await ctx.scheduler.runAfter(0, reindexAssetAction, {
      assetId: args.assetId,
    });

    return args.assetId;
  },
});

// Internal-only delete. Performs the actual storage + DB cleanup. Callers
// (public `deleteAsset`, ingest rollback paths, etc.) are responsible for
// authorization before invoking this.
export const internalDeleteAsset = internalMutation({
  args: {
    id: v.id("assets"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.id);
    if (!asset) {
      throw new ConvexError("Asset not found.");
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

    if (asset.r2Key) {
      await r2.deleteObject(ctx, asset.r2Key);
    }
    if (asset.thumbR2Key) {
      await r2.deleteObject(ctx, asset.thumbR2Key);
    }

    const lineageRows = [
      ...(await ctx.db
        .query("generationLineage")
        .withIndex("by_targetAsset", (q) => q.eq("targetAssetId", args.id))
        .collect()),
      ...(await ctx.db
        .query("generationLineage")
        .withIndex("by_sourceAsset", (q) => q.eq("sourceAssetId", args.id))
        .collect()),
    ];
    for (const row of lineageRows) {
      await ctx.db.delete(row._id);
    }

    const packId = asset.assetPackId;
    await ctx.db.delete(args.id);
    if (packId) {
      await reconcileAssetPackMembership(ctx, packId);
    }
    await bumpTagUsage(ctx, dedupeIds(asset.tagIds), -1);
    await ctx.scheduler.runAfter(0, reindexAssetAction, {
      assetId: args.id,
    });

    return null;
  },
});

const internalDeleteAssetMutation = makeFunctionReference<"mutation">(
  "assets:internalDeleteAsset",
);

// Public admin-only delete. Requires CURATION_ADMIN_SECRET + actor in
// CURATION_ADMIN_USER_IDS / KB_OWNER_USER_ID. Regular logged-in users cannot
// delete assets — only the configured admins/owner of the deployment can.
export const deleteAsset = mutation({
  args: {
    id: v.id("assets"),
    actorUserId: v.string(),
    adminSecret: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertCurationAdmin(args.actorUserId, args.adminSecret);
    await ctx.runMutation(internalDeleteAssetMutation, { id: args.id });
    return null;
  },
});

export const bulkDeleteAssets = internalMutation({
  args: { ids: v.array(v.id("assets")) },
  returns: v.number(),
  handler: async (ctx, args) => {
    let count = 0;
    for (const id of args.ids) {
      const asset = await ctx.db.get(id);
      const links = await ctx.db
        .query("assetTags")
        .withIndex("by_asset", (q) => q.eq("assetId", id))
        .collect();
      for (const link of links) {
        await ctx.db.delete(link._id);
      }
      const lineageRows = [
        ...(await ctx.db
          .query("generationLineage")
          .withIndex("by_targetAsset", (q) => q.eq("targetAssetId", id))
          .collect()),
        ...(await ctx.db
          .query("generationLineage")
          .withIndex("by_sourceAsset", (q) => q.eq("sourceAssetId", id))
          .collect()),
      ];
      for (const row of lineageRows) {
        await ctx.db.delete(row._id);
      }
      // Free the underlying bytes alongside the row. The single-asset
      // deleteAsset mutation already does this; bulk was previously
      // orphaning Convex blobs and would have orphaned R2 objects too.
      if (asset) {
        const storageIds = dedupeIds(
          [asset.storageId, asset.thumbStorageId].filter(
            (storageId): storageId is Id<"_storage"> => Boolean(storageId),
          ),
        );
        for (const storageId of storageIds) {
          await ctx.storage.delete(storageId);
        }
        if (asset.r2Key) {
          await r2.deleteObject(ctx, asset.r2Key);
        }
        if (asset.thumbR2Key) {
          await r2.deleteObject(ctx, asset.thumbR2Key);
        }
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
    const uniqueR2Keys = new Set<string>();
    for (const asset of assets) {
      if (asset.storageId) uniqueStorageIds.add(asset.storageId);
      if (asset.thumbStorageId) uniqueStorageIds.add(asset.thumbStorageId);
      if (asset.r2Key) uniqueR2Keys.add(asset.r2Key);
      if (asset.thumbR2Key) uniqueR2Keys.add(asset.thumbR2Key);
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

      for (const r2Key of uniqueR2Keys) {
        await r2.deleteObject(ctx, r2Key);
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
