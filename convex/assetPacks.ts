import { ConvexError, v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
  reconcileAssetPackMembership,
  syncPromptAssetPack,
} from "./assetPackHelpers";
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

        const assetUrl = asset.storageId
          ? await ctx.storage.getUrl(asset.storageId)
          : asset.sourceUrl ?? null;

        const thumbUrl = asset.thumbStorageId
          ? await ctx.storage.getUrl(asset.thumbStorageId)
          : assetUrl;

        return { asset, promptText, assetUrl, thumbUrl };
      }),
    );

    return { pack, items };
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
  },
  returns: v.object({
    processedPromptCount: v.number(),
    syncedPromptCount: v.number(),
    packIds: v.array(v.id("assetPacks")),
    createdPackCount: v.number(),
    removedPackCount: v.number(),
    updatedAssetCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const prompts = await ctx.db
      .query("prompts")
      .withIndex("by_owner_createdAt", (q) =>
        q.eq("ownerUserId", ownerUserId).gte("createdAt", 0),
      )
      .order("desc")
      .take(Math.min(args.limit ?? 200, 500));

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
    };
  },
});
