import { beforeEach, describe, expect, test } from "bun:test";

import { consolidateOwnerPromptPacks } from "../convex/assetPacks";
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
});
