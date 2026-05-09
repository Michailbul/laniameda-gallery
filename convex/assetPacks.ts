import { ConvexError, v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
  reconcileAssetPackMembership,
  syncPromptAssetPack,
} from "./assetPackHelpers";
import { canActorAccessOwnerUserId } from "./authz";
import {
  galleryAssetResultValidator,
  hydrateGalleryAssetResults,
} from "./galleryAssetResults";
import { resolveAssetThumbUrl, resolveAssetUrl } from "./r2_url";
import {
  assetRoleValidator,
  generationTypeValidator,
  ingestSourceValidator,
  optionalPillarValidator,
} from "./validators";

export const createAssetPack = mutation({
  args: {
    ownerUserId: v.optional(v.string()),
    title: v.string(),
    description: v.optional(v.string()),
    pillar: optionalPillarValidator,
    tagIds: v.optional(v.array(v.id("tags"))),
    ingestKey: v.optional(v.string()),
    coverAssetId: v.optional(v.id("assets")),
    modelName: v.optional(v.string()),
    domain: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
  },
  returns: v.id("assetPacks"),
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("assetPacks", {
      ownerUserId: args.ownerUserId,
      title: args.title,
      description: args.description,
      pillar: args.pillar ?? undefined,
      tagIds: args.tagIds ?? [],
      ingestKey: args.ingestKey,
      coverAssetId: args.coverAssetId,
      modelName: args.modelName,
      domain: args.domain,
      isPublic: args.isPublic ?? false,
      itemCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const addAssetToPack = mutation({
  args: {
    packId: v.id("assetPacks"),
    assetId: v.id("assets"),
    packSlotIndex: v.optional(v.number()),
    setCover: v.optional(v.boolean()),
  },
  returns: v.object({
    packId: v.id("assetPacks"),
    assetId: v.id("assets"),
    slotIndex: v.number(),
  }),
  handler: async (ctx, args) => {
    const pack = await ctx.db.get(args.packId);
    if (!pack) {
      throw new ConvexError("Asset pack not found.");
    }

    let slotIndex = args.packSlotIndex;
    if (slotIndex === undefined) {
      const existing = await ctx.db
        .query("assets")
        .withIndex("by_assetPack_packSlotIndex", (q) =>
          q.eq("assetPackId", args.packId),
        )
        .collect();
      const maxSlot = existing.reduce(
        (max, a) => Math.max(max, a.packSlotIndex ?? 0),
        -1,
      );
      slotIndex = maxSlot + 1;
    }

    await ctx.db.patch(args.assetId, {
      assetPackId: args.packId,
      packSlotIndex: slotIndex,
    });

    // Update pack metadata
    const patch: Record<string, unknown> = {
      itemCount: (pack.itemCount ?? 0) + 1,
      updatedAt: Date.now(),
    };
    if (args.setCover) {
      patch.coverAssetId = args.assetId;
    }
    await ctx.db.patch(args.packId, patch);

    return { packId: args.packId, assetId: args.assetId, slotIndex };
  },
});

export const removeAssetFromPack = mutation({
  args: {
    assetId: v.id("assets"),
  },
  returns: v.object({
    packId: v.optional(v.id("assetPacks")),
    removed: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset?.assetPackId) {
      return {
        packId: undefined,
        removed: false,
      };
    }

    const packId = asset.assetPackId;
    await ctx.db.patch(args.assetId, {
      assetPackId: undefined,
      packSlotIndex: undefined,
    });

    const result = await reconcileAssetPackMembership(ctx, packId);
    return {
      packId,
      removed: result.removed,
    };
  },
});

export const getAssetPack = query({
  args: { packId: v.id("assetPacks") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("assetPacks"),
      _creationTime: v.number(),
      ownerUserId: v.optional(v.string()),
      title: v.string(),
      description: v.optional(v.string()),
      pillar: optionalPillarValidator,
      tagIds: v.array(v.id("tags")),
      ingestKey: v.optional(v.string()),
      coverAssetId: v.optional(v.id("assets")),
      modelName: v.optional(v.string()),
      domain: v.optional(v.string()),
      isPublic: v.optional(v.boolean()),
      isFeatured: v.optional(v.boolean()),
      itemCount: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.packId);
  },
});

export const getAssetPackWithAssets = query({
  args: { packId: v.id("assetPacks") },
  returns: v.union(
    v.null(),
    v.object({
      pack: v.object({
        _id: v.id("assetPacks"),
        _creationTime: v.number(),
        ownerUserId: v.optional(v.string()),
        title: v.string(),
        description: v.optional(v.string()),
        pillar: optionalPillarValidator,
        tagIds: v.array(v.id("tags")),
        ingestKey: v.optional(v.string()),
        coverAssetId: v.optional(v.id("assets")),
        modelName: v.optional(v.string()),
        domain: v.optional(v.string()),
        isPublic: v.optional(v.boolean()),
        isFeatured: v.optional(v.boolean()),
        itemCount: v.optional(v.number()),
        createdAt: v.number(),
        updatedAt: v.number(),
      }),
      items: v.array(
        v.object({
          asset: v.object({
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
            pillar: optionalPillarValidator,
            generationType: generationTypeValidator,
            assetRole: assetRoleValidator,
            ingestSource: ingestSourceValidator,
            assetPackId: v.optional(v.id("assetPacks")),
            packSlotIndex: v.optional(v.number()),
            createdAt: v.number(),
          }),
          promptText: v.union(v.null(), v.string()),
          assetUrl: v.union(v.null(), v.string()),
          thumbUrl: v.union(v.null(), v.string()),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const pack = await ctx.db.get(args.packId);
    if (!pack) return null;

    const assets = await ctx.db
      .query("assets")
      .withIndex("by_assetPack_packSlotIndex", (q) =>
        q.eq("assetPackId", args.packId),
      )
      .collect();

    // Sort by packSlotIndex
    assets.sort((a, b) => (a.packSlotIndex ?? 0) - (b.packSlotIndex ?? 0));

    const items = await Promise.all(
      assets.map(async (asset) => {
        let promptText: string | null = null;
        if (asset.promptId) {
          const prompt = await ctx.db.get(asset.promptId);
          promptText = prompt?.text ?? null;
        }

        const assetUrl = (await resolveAssetUrl(ctx, asset)) ?? null;

        const thumbUrl = (await resolveAssetThumbUrl(ctx, asset)) ?? assetUrl;

        return { asset, promptText, assetUrl, thumbUrl };
      }),
    );

    return { pack, items };
  },
});

export const getGalleryAssetPack = query({
  args: {
    packId: v.id("assetPacks"),
    ownerUserId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      pack: v.object({
        _id: v.id("assetPacks"),
        _creationTime: v.number(),
        ownerUserId: v.optional(v.string()),
        title: v.string(),
        description: v.optional(v.string()),
        pillar: optionalPillarValidator,
        tagIds: v.array(v.id("tags")),
        ingestKey: v.optional(v.string()),
        coverAssetId: v.optional(v.id("assets")),
        modelName: v.optional(v.string()),
        domain: v.optional(v.string()),
        isPublic: v.optional(v.boolean()),
        isFeatured: v.optional(v.boolean()),
        itemCount: v.optional(v.number()),
        createdAt: v.number(),
        updatedAt: v.number(),
      }),
      assets: v.array(galleryAssetResultValidator),
    }),
  ),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const pack = await ctx.db.get(args.packId);
    if (!pack || !canActorAccessOwnerUserId(ownerUserId, pack.ownerUserId)) {
      return null;
    }

    const assets = await ctx.db
      .query("assets")
      .withIndex("by_assetPack_packSlotIndex", (q) =>
        q.eq("assetPackId", args.packId),
      )
      .collect();

    assets.sort((a, b) => (a.packSlotIndex ?? 0) - (b.packSlotIndex ?? 0));
    const hydratedAssets = await hydrateGalleryAssetResults(ctx, assets);

    return {
      pack,
      assets: hydratedAssets,
    };
  },
});

export const listAssetPacks = query({
  args: {
    ownerUserId: v.string(),
    pillar: v.optional(optionalPillarValidator),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("assetPacks"),
      _creationTime: v.number(),
      ownerUserId: v.optional(v.string()),
      title: v.string(),
      description: v.optional(v.string()),
      pillar: optionalPillarValidator,
      tagIds: v.array(v.id("tags")),
      ingestKey: v.optional(v.string()),
      coverAssetId: v.optional(v.id("assets")),
      modelName: v.optional(v.string()),
      domain: v.optional(v.string()),
      isPublic: v.optional(v.boolean()),
      isFeatured: v.optional(v.boolean()),
      itemCount: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    const q = ctx.db
      .query("assetPacks")
      .withIndex("by_owner_createdAt", (q) =>
        q.eq("ownerUserId", args.ownerUserId),
      )
      .order("desc");

    const packs = await q.take(limit);

    // Optionally filter by pillar (done in-memory since compound index may not exist)
    if (args.pillar) {
      return packs.filter((p) => p.pillar === args.pillar);
    }
    return packs;
  },
});

export const listAssetPacksWithCovers = query({
  args: {
    ownerUserId: v.string(),
    pillar: v.optional(optionalPillarValidator),
    tagIds: v.optional(v.array(v.id("tags"))),
    modelName: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("assetPacks"),
      title: v.string(),
      description: v.optional(v.string()),
      pillar: optionalPillarValidator,
      modelName: v.optional(v.string()),
      itemCount: v.optional(v.number()),
      isPublic: v.optional(v.boolean()),
      isFeatured: v.optional(v.boolean()),
      createdAt: v.number(),
      updatedAt: v.number(),
      coverUrl: v.union(v.null(), v.string()),
      coverThumbUrl: v.union(v.null(), v.string()),
      coverWidth: v.optional(v.number()),
      coverHeight: v.optional(v.number()),
      previewUrls: v.array(v.string()),
      hasWorkflowAssets: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    const q = ctx.db
      .query("assetPacks")
      .withIndex("by_owner_createdAt", (q) =>
        q.eq("ownerUserId", args.ownerUserId),
      )
      .order("desc");

    let packs = await q.take(limit);

    if (args.pillar) {
      packs = packs.filter((p) => p.pillar === args.pillar);
    }

    const tagFilterSet =
      args.tagIds && args.tagIds.length > 0 ? new Set(args.tagIds) : null;
    const modelFilter = args.modelName ?? null;

    const hydrated = await Promise.all(
      packs.map(async (pack) => {
        let coverUrl: string | null = null;
        let coverThumbUrl: string | null = null;
        let coverWidth: number | undefined;
        let coverHeight: number | undefined;

        if (pack.coverAssetId) {
          const coverAsset = await ctx.db.get(pack.coverAssetId);
          if (coverAsset) {
            coverUrl = (await resolveAssetUrl(ctx, coverAsset)) ?? null;
            coverThumbUrl = (await resolveAssetThumbUrl(ctx, coverAsset)) ?? coverUrl;
            coverWidth = coverAsset.thumbWidth ?? coverAsset.width;
            coverHeight = coverAsset.thumbHeight ?? coverAsset.height;
          }
        }

        // Pull member assets to resolve preview thumbs, tags, models, kind.
        const members = await ctx.db
          .query("assets")
          .withIndex("by_assetPack_packSlotIndex", (q) =>
            q.eq("assetPackId", pack._id),
          )
          .collect();

        const previewUrls: string[] = [];
        for (const member of members.slice(0, 12)) {
          const url = (await resolveAssetThumbUrl(ctx, member)) ?? null;
          if (url) previewUrls.push(url);
        }

        if (!coverUrl && previewUrls.length > 0) {
          coverUrl = previewUrls[0];
          coverThumbUrl = previewUrls[0];
          if (members[0]) {
            coverWidth = members[0].thumbWidth ?? members[0].width;
            coverHeight = members[0].thumbHeight ?? members[0].height;
          }
        }

        // Aggregate member-asset tagIds and modelNames for filtering.
        const memberTagIds = new Set<string>();
        const memberModels = new Set<string>();
        let hasWorkflowAssets = false;
        for (const member of members) {
          for (const tid of member.tagIds ?? []) memberTagIds.add(tid);
          if (member.modelName) memberModels.add(member.modelName);
          if (member.generationType === "workflow") hasWorkflowAssets = true;
        }
        if (pack.modelName) memberModels.add(pack.modelName);
        for (const tid of pack.tagIds ?? []) memberTagIds.add(tid);

        return {
          pack,
          hasWorkflowAssets,
          memberTagIds,
          memberModels,
          result: {
            _id: pack._id,
            title: pack.title,
            description: pack.description,
            pillar: pack.pillar,
            modelName: pack.modelName,
            itemCount: pack.itemCount,
            isPublic: pack.isPublic,
            isFeatured: pack.isFeatured,
            createdAt: pack.createdAt,
            updatedAt: pack.updatedAt,
            coverUrl,
            coverThumbUrl,
            coverWidth,
            coverHeight,
            previewUrls,
            hasWorkflowAssets,
          },
        };
      }),
    );

    return hydrated
      .filter(({ memberTagIds, memberModels }) => {
        if (tagFilterSet) {
          let any = false;
          for (const id of tagFilterSet) {
            if (memberTagIds.has(id as string)) {
              any = true;
              break;
            }
          }
          if (!any) return false;
        }
        if (modelFilter && !memberModels.has(modelFilter)) return false;
        return true;
      })
      .map(({ result }) => result);
  },
});

export const getAssetPackByIngestKey = query({
  args: {
    ownerUserId: v.optional(v.string()),
    ingestKey: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("assetPacks"),
      _creationTime: v.number(),
      ownerUserId: v.optional(v.string()),
      title: v.string(),
      description: v.optional(v.string()),
      pillar: optionalPillarValidator,
      tagIds: v.array(v.id("tags")),
      ingestKey: v.optional(v.string()),
      coverAssetId: v.optional(v.id("assets")),
      modelName: v.optional(v.string()),
      domain: v.optional(v.string()),
      isPublic: v.optional(v.boolean()),
      isFeatured: v.optional(v.boolean()),
      itemCount: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    if (args.ownerUserId) {
      return await ctx.db
        .query("assetPacks")
        .withIndex("by_owner_ingestKey", (q) =>
          q.eq("ownerUserId", args.ownerUserId).eq("ingestKey", args.ingestKey),
        )
        .first();
    }
    return await ctx.db
      .query("assetPacks")
      .withIndex("by_ingestKey", (q) => q.eq("ingestKey", args.ingestKey))
      .first();
  },
});

export const updateAssetPack = mutation({
  args: {
    packId: v.id("assetPacks"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    coverAssetId: v.optional(v.id("assets")),
    isPublic: v.optional(v.boolean()),
    isFeatured: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { packId, ...rest } = args;
    const patch = Object.fromEntries(
      Object.entries(rest).filter(([, v]) => v !== undefined),
    );
    await ctx.db.patch(packId, { ...patch, updatedAt: Date.now() });
    return null;
  },
});

export const deleteAssetPack = mutation({
  args: { packId: v.id("assetPacks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const members = await ctx.db
      .query("assets")
      .withIndex("by_assetPack_packSlotIndex", (q) =>
        q.eq("assetPackId", args.packId),
      )
      .collect();

    for (const asset of members) {
      await ctx.db.patch(asset._id, {
        assetPackId: undefined,
        packSlotIndex: undefined,
      });
    }

    await ctx.db.delete(args.packId);
    return null;
  },
});

export const syncPromptPack = mutation({
  args: {
    ownerUserId: v.string(),
    promptId: v.id("prompts"),
  },
  returns: v.object({
    packId: v.optional(v.id("assetPacks")),
    itemCount: v.number(),
    createdPack: v.boolean(),
    removedPackCount: v.number(),
    updatedAssetCount: v.number(),
  }),
  handler: async (ctx, args) => {
    return await syncPromptAssetPack(ctx, args);
  },
});

export const consolidateOwnerPromptPacks = mutation({
  args: {
    ownerUserId: v.string(),
    limit: v.optional(v.number()),
    createdBefore: v.optional(v.number()),
  },
  returns: v.object({
    processedPromptCount: v.number(),
    syncedPromptCount: v.number(),
    packIds: v.array(v.id("assetPacks")),
    createdPackCount: v.number(),
    removedPackCount: v.number(),
    updatedAssetCount: v.number(),
    hasMore: v.boolean(),
    nextCreatedBefore: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const limit = Math.min(args.limit ?? 200, 500);
    const promptWindow = await ctx.db
      .query("prompts")
      .withIndex("by_owner_createdAt", (q) =>
        args.createdBefore !== undefined
          ? q.eq("ownerUserId", ownerUserId).lt("createdAt", args.createdBefore)
          : q.eq("ownerUserId", ownerUserId).gte("createdAt", 0),
      )
      .order("desc")
      .take(limit + 1);
    const hasMore = promptWindow.length > limit;
    const prompts = promptWindow.slice(0, limit);

    const packIds = new Set<Id<"assetPacks">>();
    let syncedPromptCount = 0;
    let createdPackCount = 0;
    let removedPackCount = 0;
    let updatedAssetCount = 0;

    for (const prompt of prompts) {
      const linkedAssets = await ctx.db
        .query("assets")
        .withIndex("by_owner_prompt_createdAt", (q) =>
          q.eq("ownerUserId", ownerUserId).eq("promptId", prompt._id).gte("createdAt", 0),
        )
        .take(3);

      const needsPackSync =
        linkedAssets.length > 1 ||
        linkedAssets.some((asset) => Boolean(asset.assetPackId));
      if (!needsPackSync) {
        continue;
      }

      syncedPromptCount += 1;
      const result = await syncPromptAssetPack(ctx, {
        ownerUserId,
        promptId: prompt._id,
      });

      if (result.packId) {
        packIds.add(result.packId);
      }
      if (result.createdPack) {
        createdPackCount += 1;
      }
      removedPackCount += result.removedPackCount;
      updatedAssetCount += result.updatedAssetCount;
    }

    return {
      processedPromptCount: prompts.length,
      syncedPromptCount,
      packIds: [...packIds],
      createdPackCount,
      removedPackCount,
      updatedAssetCount,
      hasMore,
      nextCreatedBefore: hasMore ? prompts[prompts.length - 1]?.createdAt : undefined,
    };
  },
});
