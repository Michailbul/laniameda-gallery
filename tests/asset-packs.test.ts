import { beforeEach, describe, expect, test } from "bun:test";

import {
  consolidateOwnerPromptPacks,
  getGalleryAssetPack,
} from "../convex/assetPacks";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

describe("asset pack consolidation", () => {
  let harness: ReturnType<typeof createMockConvexMutationCtx>;

  beforeEach(() => {
    harness = createMockConvexMutationCtx();
  });

  test("consolidates legacy prompt-linked assets into an explicit pack", async () => {
    const tagId = await harness.db.insert("tags", {
      name: "Cars",
      normalized: "cars",
      usageCount: 1,
    });
    const promptId = await harness.db.insert("prompts", {
      ownerUserId: "278674008",
      text: "Low-angle porsche rolling shot at sunset",
      tagIds: [tagId],
      pillar: "cars",
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
      pillar: "cars",
      createdAt: 100,
    });
    const newerAssetId = await harness.db.insert("assets", {
      ownerUserId: "278674008",
      kind: "image",
      sourceUrl: "https://example.com/newer.jpg",
      promptId,
      tagIds: [tagId],
      pillar: "cars",
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

    expect(pack?.title).toContain("porsche");
    expect(pack?.coverAssetId).toBe(newerAssetId);
    expect(pack?.itemCount).toBe(2);
    expect(pack?.modelName).toBe("gpt-image-1");
    expect(pack?.pillar).toBe("cars");
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
});
