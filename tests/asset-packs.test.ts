import { beforeEach, describe, expect, test } from "bun:test";

import {
  consolidateOwnerPromptPacks,
  getGalleryAssetPack,
} from "../convex/assetPacks";
import {
  bulkDeleteGalleryItems,
  bulkSetGalleryItemCuration,
} from "../convex/assets";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

describe("asset pack consolidation", () => {
  let harness: ReturnType<typeof createMockConvexMutationCtx>;

  beforeEach(() => {
    harness = createMockConvexMutationCtx();
    process.env.CURATION_ADMIN_SECRET = "test-secret";
    process.env.CURATION_ADMIN_USER_IDS = "278674008";
  });

  test("consolidates legacy prompt-linked assets into an explicit pack", async () => {
    const tagId = await harness.db.insert("tags", {
      name: "Editorial",
      normalized: "editorial",
      usageCount: 1,
    });
    const promptId = await harness.db.insert("prompts", {
      ownerUserId: "278674008",
      text: "Editorial portrait under window light",
      tagIds: [tagId],
      pillar: "creators",
      modelName: "gpt-image-1",
      domain: "automotive",
      createdAt: 10,
    });

    const olderAssetId = await harness.db.insert("assets", {
      ownerUserId: "278674008",
      kind: "image",
      sourceUrl: "https://example.com/older.jpg",
      promptId,
      tagIds: [tagId],
      pillar: "creators",
      createdAt: 100,
    });
    const newerAssetId = await harness.db.insert("assets", {
      ownerUserId: "278674008",
      kind: "image",
      sourceUrl: "https://example.com/newer.jpg",
      promptId,
      tagIds: [tagId],
      pillar: "creators",
      createdAt: 200,
    });

    const result = await consolidateOwnerPromptPacks._handler(
      harness.ctx as never,
      {
        ownerUserId: "278674008",
      },
    );

    expect(result.syncedPromptCount).toBe(1);
    expect(result.createdPackCount).toBe(1);
    expect(result.packIds).toHaveLength(1);

    const packId = result.packIds[0]!;
    const pack = await harness.db.get<{
      title: string;
      coverAssetId?: string;
      itemCount?: number;
      modelName?: string;
      pillar?: string;
    }>(packId);
    const newerAsset = await harness.db.get<{
      assetPackId?: string;
      packSlotIndex?: number;
    }>(newerAssetId);
    const olderAsset = await harness.db.get<{
      assetPackId?: string;
      packSlotIndex?: number;
    }>(olderAssetId);

    expect(pack?.title).toContain("Editorial");
    expect(pack?.coverAssetId).toBe(newerAssetId);
    expect(pack?.itemCount).toBe(2);
    expect(pack?.modelName).toBe("gpt-image-1");
    expect(pack?.pillar).toBe("creators");
    expect(newerAsset?.assetPackId).toBe(packId);
    expect(newerAsset?.packSlotIndex).toBe(0);
    expect(olderAsset?.assetPackId).toBe(packId);
    expect(olderAsset?.packSlotIndex).toBe(1);
  });

  test("supports paginated prompt consolidation for older prompt history", async () => {
    const tagId = await harness.db.insert("tags", {
      name: "Designs",
      normalized: "designs",
      usageCount: 1,
    });

    const newestPromptId = await harness.db.insert("prompts", {
      ownerUserId: "278674008",
      text: "Newest prompt",
      tagIds: [tagId],
      pillar: "designs",
      createdAt: 300,
    });
    const olderPromptId = await harness.db.insert("prompts", {
      ownerUserId: "278674008",
      text: "Older prompt",
      tagIds: [tagId],
      pillar: "designs",
      createdAt: 200,
    });

    await harness.db.insert("assets", {
      ownerUserId: "278674008",
      kind: "image",
      sourceUrl: "https://example.com/new-1.jpg",
      promptId: newestPromptId,
      tagIds: [tagId],
      pillar: "designs",
      createdAt: 310,
    });
    await harness.db.insert("assets", {
      ownerUserId: "278674008",
      kind: "image",
      sourceUrl: "https://example.com/new-2.jpg",
      promptId: newestPromptId,
      tagIds: [tagId],
      pillar: "designs",
      createdAt: 320,
    });
    await harness.db.insert("assets", {
      ownerUserId: "278674008",
      kind: "image",
      sourceUrl: "https://example.com/old-1.jpg",
      promptId: olderPromptId,
      tagIds: [tagId],
      pillar: "designs",
      createdAt: 210,
    });
    await harness.db.insert("assets", {
      ownerUserId: "278674008",
      kind: "image",
      sourceUrl: "https://example.com/old-2.jpg",
      promptId: olderPromptId,
      tagIds: [tagId],
      pillar: "designs",
      createdAt: 220,
    });

    const firstPage = await consolidateOwnerPromptPacks._handler(
      harness.ctx as never,
      {
        ownerUserId: "278674008",
        limit: 1,
      },
    );

    expect(firstPage.processedPromptCount).toBe(1);
    expect(firstPage.hasMore).toBeTrue();
    expect(firstPage.nextCreatedBefore).toBe(300);

    const secondPage = await consolidateOwnerPromptPacks._handler(
      harness.ctx as never,
      {
        ownerUserId: "278674008",
        limit: 1,
        createdBefore: firstPage.nextCreatedBefore,
      },
    );

    expect(secondPage.processedPromptCount).toBe(1);
    expect(secondPage.syncedPromptCount).toBe(1);
    expect(secondPage.createdPackCount).toBe(1);
  });

  test("getGalleryAssetPack returns owner-scoped pack assets", async () => {
    const tagId = await harness.db.insert("tags", {
      name: "Creators",
      normalized: "creators",
      usageCount: 1,
    });
    const promptId = await harness.db.insert("prompts", {
      ownerUserId: "278674008",
      text: "Editorial portrait pack",
      tagIds: [tagId],
      pillar: "creators",
      createdAt: 10,
    });
    const packId = await harness.db.insert("assetPacks", {
      ownerUserId: "278674008",
      title: "Editorial pack",
      tagIds: [tagId],
      pillar: "creators",
      itemCount: 1,
      createdAt: 20,
      updatedAt: 20,
    });
    await harness.db.insert("assets", {
      ownerUserId: "278674008",
      kind: "image",
      sourceUrl: "https://example.com/portrait.jpg",
      promptId,
      tagIds: [tagId],
      pillar: "creators",
      assetPackId: packId,
      packSlotIndex: 0,
      createdAt: 30,
    });

    const ctx = {
      ...harness.ctx,
      storage: {
        getUrl: async (_storageId: string) => null,
      },
    };

    const result = await getGalleryAssetPack._handler(ctx as never, {
      packId,
      ownerUserId: "telegram:278674008",
    });

    expect(result?.pack._id).toBe(packId);
    expect(result?.assets).toHaveLength(1);
    expect(result?.assets[0]?.promptText).toBe("Editorial portrait pack");
    expect(result?.assets[0]?.tagNames).toEqual(["Creators"]);

    const denied = await getGalleryAssetPack._handler(ctx as never, {
      packId,
      ownerUserId: "telegram:999",
    });
    expect(denied).toBeNull();
  });

  test("bulk curation promotes an explicit pack and all members", async () => {
    const packId = await harness.db.insert("assetPacks", {
      ownerUserId: "278674008",
      title: "Pack",
      tagIds: [],
      pillar: "creators",
      isPublic: false,
      itemCount: 2,
      createdAt: 10,
      updatedAt: 10,
    });
    const firstAssetId = await harness.db.insert("assets", {
      ownerUserId: "278674008",
      kind: "image",
      sourceUrl: "https://example.com/one.jpg",
      tagIds: [],
      pillar: "creators",
      assetPackId: packId,
      packSlotIndex: 0,
      isPublic: false,
      createdAt: 20,
    });
    const secondAssetId = await harness.db.insert("assets", {
      ownerUserId: "278674008",
      kind: "image",
      sourceUrl: "https://example.com/two.jpg",
      tagIds: [],
      pillar: "creators",
      assetPackId: packId,
      packSlotIndex: 1,
      isPublic: false,
      createdAt: 30,
    });

    const result = await bulkSetGalleryItemCuration._handler(
      harness.ctx as never,
      {
        assetPackIds: [packId as never],
        actorUserId: "278674008",
        isPublic: true,
        adminSecret: "test-secret",
      },
    );

    const pack = await harness.db.get<{ isPublic?: boolean }>(packId);
    const firstAsset = await harness.db.get<{ isPublic?: boolean }>(
      firstAssetId,
    );
    const secondAsset = await harness.db.get<{ isPublic?: boolean }>(
      secondAssetId,
    );

    expect(result.updatedPackIds).toEqual([packId]);
    expect([...result.updatedAssetIds].sort()).toEqual(
      [firstAssetId, secondAssetId].sort(),
    );
    expect(pack?.isPublic).toBeTrue();
    expect(firstAsset?.isPublic).toBeTrue();
    expect(secondAsset?.isPublic).toBeTrue();
  });

  test("bulk delete removes a selected pack and all member assets", async () => {
    const tagId = await harness.db.insert("tags", {
      name: "Creators",
      normalized: "creators",
      usageCount: 2,
    });
    const packId = await harness.db.insert("assetPacks", {
      ownerUserId: "278674008",
      title: "Pack",
      tagIds: [tagId],
      pillar: "creators",
      itemCount: 2,
      createdAt: 10,
      updatedAt: 10,
    });
    const firstAssetId = await harness.db.insert("assets", {
      ownerUserId: "278674008",
      kind: "image",
      sourceUrl: "https://example.com/one.jpg",
      tagIds: [tagId],
      pillar: "creators",
      assetPackId: packId,
      packSlotIndex: 0,
      createdAt: 20,
    });
    const secondAssetId = await harness.db.insert("assets", {
      ownerUserId: "278674008",
      kind: "image",
      sourceUrl: "https://example.com/two.jpg",
      tagIds: [tagId],
      pillar: "creators",
      assetPackId: packId,
      packSlotIndex: 1,
      createdAt: 30,
    });

    const result = await bulkDeleteGalleryItems._handler(
      harness.ctx as never,
      {
        assetPackIds: [packId as never],
        actorUserId: "278674008",
        adminSecret: "test-secret",
      },
    );

    const tag = await harness.db.get<{ usageCount: number }>(tagId);

    expect(result.deletedPackIds).toEqual([packId]);
    expect([...result.deletedAssetIds].sort()).toEqual(
      [firstAssetId, secondAssetId].sort(),
    );
    expect(await harness.db.get(packId)).toBeNull();
    expect(await harness.db.get(firstAssetId)).toBeNull();
    expect(await harness.db.get(secondAssetId)).toBeNull();
    expect(tag?.usageCount).toBe(0);
  });
});
