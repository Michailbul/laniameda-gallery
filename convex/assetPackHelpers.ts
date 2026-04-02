import { ConvexError } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const PACK_TITLE_LIMIT = 96;

const dedupeTagIds = (assets: Doc<"assets">[], prompt: Doc<"prompts">) => {
  return Array.from(
    new Set([
      ...prompt.tagIds,
      ...assets.flatMap((asset) => asset.tagIds),
    ]),
  ) as Id<"tags">[];
};

const buildPackTitle = (
  prompt: Doc<"prompts">,
  coverAsset?: Doc<"assets">,
) => {
  const source =
    prompt.text.trim() ||
    coverAsset?.fileName?.trim() ||
    "Untitled pack";
  return source.length > PACK_TITLE_LIMIT
    ? `${source.slice(0, PACK_TITLE_LIMIT - 3).trimEnd()}...`
    : source;
};

const sortAssetsForPack = (left: Doc<"assets">, right: Doc<"assets">) => {
  if ((left.packSlotIndex ?? -1) !== (right.packSlotIndex ?? -1)) {
    return (left.packSlotIndex ?? Number.MAX_SAFE_INTEGER) -
      (right.packSlotIndex ?? Number.MAX_SAFE_INTEGER);
  }
  if (left.createdAt !== right.createdAt) {
    return right.createdAt - left.createdAt;
  }
  return right._creationTime - left._creationTime;
};

const sortAssetsForPromptPack = (left: Doc<"assets">, right: Doc<"assets">) => {
  if (left.createdAt !== right.createdAt) {
    return right.createdAt - left.createdAt;
  }
  return right._creationTime - left._creationTime;
};

const collectPackMembers = async (
  ctx: MutationCtx,
  packId: Id<"assetPacks">,
) => {
  const members = await ctx.db
    .query("assets")
    .withIndex("by_assetPack_packSlotIndex", (q) =>
      q.eq("assetPackId", packId),
    )
    .collect();

  return [...members].sort(sortAssetsForPack);
};

export const reconcileAssetPackMembership = async (
  ctx: MutationCtx,
  packId: Id<"assetPacks">,
) => {
  const pack = await ctx.db.get(packId);
  if (!pack) {
    return {
      packId,
      itemCount: 0,
      removed: false,
    };
  }

  const members = await collectPackMembers(ctx, packId);
  if (members.length < 2) {
    for (const member of members) {
      await ctx.db.patch(member._id, {
        assetPackId: undefined,
        packSlotIndex: undefined,
      });
    }
    await ctx.db.delete(packId);
    return {
      packId,
      itemCount: members.length,
      removed: true,
    };
  }

  for (const [index, member] of members.entries()) {
    if (member.packSlotIndex !== index) {
      await ctx.db.patch(member._id, {
        packSlotIndex: index,
      });
    }
  }

  const coverAsset = members[0];
  await ctx.db.patch(packId, {
    coverAssetId: coverAsset?._id,
    itemCount: members.length,
    updatedAt: Date.now(),
  });

  return {
    packId,
    itemCount: members.length,
    removed: false,
  };
};

export const syncPromptAssetPack = async (
  ctx: MutationCtx,
  args: {
    ownerUserId: string;
    promptId: Id<"prompts">;
  },
) => {
  const ownerUserId = args.ownerUserId.trim();
  if (!ownerUserId) {
    throw new ConvexError("ownerUserId is required.");
  }

  const prompt = await ctx.db.get(args.promptId);
  if (!prompt) {
    throw new ConvexError("Prompt not found.");
  }
  if (prompt.ownerUserId !== ownerUserId) {
    throw new ConvexError("Prompt does not belong to this user.");
  }

  const linkedAssets = await ctx.db
    .query("assets")
    .withIndex("by_owner_prompt_createdAt", (q) =>
      q.eq("ownerUserId", ownerUserId).eq("promptId", args.promptId).gte("createdAt", 0),
    )
    .collect();

  const orderedAssets = [...linkedAssets].sort(sortAssetsForPromptPack);
  const existingPackIds = Array.from(
    new Set(
      orderedAssets
        .map((asset) => asset.assetPackId)
        .filter((packId): packId is Id<"assetPacks"> => Boolean(packId)),
    ),
  );

  if (orderedAssets.length < 2) {
    for (const asset of orderedAssets) {
      if (!asset.assetPackId) {
        continue;
      }
      await ctx.db.patch(asset._id, {
        assetPackId: undefined,
        packSlotIndex: undefined,
      });
    }

    let removedPackCount = 0;
    for (const packId of existingPackIds) {
      const result = await reconcileAssetPackMembership(ctx, packId);
      if (result.removed) {
        removedPackCount += 1;
      }
    }

    return {
      packId: undefined,
      itemCount: orderedAssets.length,
      createdPack: false,
      removedPackCount,
      updatedAssetCount: 0,
    };
  }

  const coverAsset = orderedAssets[0];
  let packId = existingPackIds[0];
  let createdPack = false;

  if (!packId) {
    packId = await ctx.db.insert("assetPacks", {
      ownerUserId,
      title: buildPackTitle(prompt, coverAsset),
      description: undefined,
      pillar: prompt.pillar ?? coverAsset?.pillar,
      tagIds: dedupeTagIds(orderedAssets, prompt),
      ingestKey: undefined,
      coverAssetId: coverAsset._id,
      modelName: prompt.modelName ?? coverAsset?.modelName,
      domain: prompt.domain,
      isPublic: coverAsset?.isPublic ?? false,
      isFeatured: coverAsset?.isFeatured ?? false,
      itemCount: orderedAssets.length,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    createdPack = true;
  }

  const chosenPackId = packId;
  const chosenPackMembers = await collectPackMembers(ctx, chosenPackId);
  const chosenMemberIds = new Set(orderedAssets.map((asset) => asset._id));
  for (const member of chosenPackMembers) {
    if (chosenMemberIds.has(member._id)) {
      continue;
    }
    await ctx.db.patch(member._id, {
      assetPackId: undefined,
      packSlotIndex: undefined,
    });
  }

  let updatedAssetCount = 0;
  for (const [index, asset] of orderedAssets.entries()) {
    if (
      asset.assetPackId === chosenPackId &&
      asset.packSlotIndex === index
    ) {
      continue;
    }
    await ctx.db.patch(asset._id, {
      assetPackId: chosenPackId,
      packSlotIndex: index,
    });
    updatedAssetCount += 1;
  }

  await ctx.db.patch(chosenPackId, {
    title: buildPackTitle(prompt, coverAsset),
    pillar: prompt.pillar ?? coverAsset?.pillar,
    tagIds: dedupeTagIds(orderedAssets, prompt),
    coverAssetId: coverAsset._id,
    modelName: prompt.modelName ?? coverAsset?.modelName,
    domain: prompt.domain,
    isPublic: coverAsset?.isPublic ?? false,
    isFeatured: coverAsset?.isFeatured ?? false,
    itemCount: orderedAssets.length,
    updatedAt: Date.now(),
  });

  let removedPackCount = 0;
  for (const stalePackId of existingPackIds.slice(1)) {
    const result = await reconcileAssetPackMembership(ctx, stalePackId);
    if (result.removed) {
      removedPackCount += 1;
    }
  }

  return {
    packId: chosenPackId,
    itemCount: orderedAssets.length,
    createdPack,
    removedPackCount,
    updatedAssetCount,
  };
};
