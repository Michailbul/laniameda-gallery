import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { optionalPillarValidator } from "./validators";

// ── Create a new asset pack ──────────────────────────────────────────────────

export const createAssetPack = mutation({
  args: {
    ownerUserId: v.optional(v.string()),
    title: v.string(),
    description: v.optional(v.string()),
    pillar: v.optional(optionalPillarValidator),
    tagIds: v.optional(v.array(v.id("tags"))),
    ingestKey: v.optional(v.string()),
    coverAssetId: v.optional(v.id("assets")),
    modelName: v.optional(v.string()),
    domain: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const packId = await ctx.db.insert("assetPacks", {
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
    return packId;
  },
});

// ── Add an existing asset to a pack ─────────────────────────────────────────

export const addAssetToPack = mutation({
  args: {
    packId: v.id("assetPacks"),
    assetId: v.id("assets"),
    packSlotIndex: v.optional(v.number()),
    setCover: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const pack = await ctx.db.get(args.packId);
    if (!pack) throw new Error(`Asset pack ${args.packId} not found`);

    // Determine slot index — append at end if not specified
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

// ── Remove an asset from a pack ─────────────────────────────────────────────

export const removeAssetFromPack = mutation({
  args: {
    assetId: v.id("assets"),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset?.assetPackId) return;

    const packId = asset.assetPackId;
    await ctx.db.patch(args.assetId, {
      assetPackId: undefined,
      packSlotIndex: undefined,
    });

    const pack = await ctx.db.get(packId);
    if (pack) {
      await ctx.db.patch(packId, {
        itemCount: Math.max(0, (pack.itemCount ?? 1) - 1),
        updatedAt: Date.now(),
        coverAssetId:
          pack.coverAssetId === args.assetId
            ? undefined
            : pack.coverAssetId,
      });
    }
  },
});

// ── Get a pack by ID ────────────────────────────────────────────────────────

export const getAssetPack = query({
  args: { packId: v.id("assetPacks") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.packId);
  },
});

// ── Get a pack with all its assets + prompt text ────────────────────────────

export const getAssetPackWithAssets = query({
  args: { packId: v.id("assetPacks") },
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

// ── List packs for an owner ─────────────────────────────────────────────────

export const listAssetPacks = query({
  args: {
    ownerUserId: v.string(),
    pillar: v.optional(optionalPillarValidator),
    limit: v.optional(v.number()),
  },
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

// ── Get a pack by ingestKey ─────────────────────────────────────────────────

export const getAssetPackByIngestKey = query({
  args: {
    ownerUserId: v.optional(v.string()),
    ingestKey: v.string(),
  },
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

// ── Update pack metadata ────────────────────────────────────────────────────

export const updateAssetPack = mutation({
  args: {
    packId: v.id("assetPacks"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    coverAssetId: v.optional(v.id("assets")),
    isPublic: v.optional(v.boolean()),
    isFeatured: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { packId, ...rest } = args;
    const patch = Object.fromEntries(
      Object.entries(rest).filter(([, v]) => v !== undefined),
    );
    await ctx.db.patch(packId, { ...patch, updatedAt: Date.now() });
  },
});

// ── Delete a pack (unlinks all member assets, does NOT delete them) ─────────

export const deleteAssetPack = mutation({
  args: { packId: v.id("assetPacks") },
  handler: async (ctx, args) => {
    // Unlink all member assets
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
  },
});
