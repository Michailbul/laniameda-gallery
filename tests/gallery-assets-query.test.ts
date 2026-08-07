import { beforeEach, describe, expect, test } from "bun:test";

import {
  galleryAssetFacets,
  listGalleryAssets,
  listPublicGalleryAssets,
} from "../convex/assets";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

describe("gallery asset queries", () => {
  let harness: ReturnType<typeof createMockConvexMutationCtx>;

  beforeEach(() => {
    harness = createMockConvexMutationCtx();
  });

  test("listGalleryAssets resolves prompt text/tag names and keeps filters stable", async () => {
    const carTagId = await harness.db.insert("tags", {
      name: "Car",
      normalized: "car",
      usageCount: 1,
    });
    const designTagId = await harness.db.insert("tags", {
      name: "Design",
      normalized: "design",
      usageCount: 1,
    });

    const carPromptId = await harness.db.insert("prompts", {
      ownerUserId: "278674008",
      text: "Fast cinematic car",
      tagIds: [carTagId],
      createdAt: 1,
    });
    const designPromptId = await harness.db.insert("prompts", {
      ownerUserId: "278674008",
      text: "Modern UI layout",
      tagIds: [designTagId],
      createdAt: 2,
    });

    await harness.db.insert("assets", {
      ownerUserId: "278674008",
      kind: "image",
      sourceUrl: "https://example.com/car.jpg",
      promptId: carPromptId,
      tagIds: [carTagId],
      modelName: "model-car",
      pillar: "creators",
      isPublic: false,
      createdAt: 200,
    });
    await harness.db.insert("assets", {
      ownerUserId: "278674008",
      kind: "image",
      sourceUrl: "https://example.com/design.jpg",
      promptId: designPromptId,
      tagIds: [designTagId],
      modelName: "model-design",
      pillar: "designs",
      isPublic: false,
      createdAt: 100,
    });

    const ctx = {
      ...harness.ctx,
      storage: {
        getUrl: async (_storageId: string) => null,
      },
    };

    const results = await listGalleryAssets._handler(ctx as never, {
      ownerUserId: "278674008",
      tagIds: [carTagId],
      search: "cinematic",
      limit: 20,
    });

    expect(results.length).toBe(1);
    expect(results[0]?.promptText).toBe("Fast cinematic car");
    expect(results[0]?.tagNames).toEqual(["Car"]);
    expect(results[0]?.modelName).toBe("model-car");
    expect(results[0]?.sourceUrl).toBe("https://example.com/car.jpg");
  });

  test("listPublicGalleryAssets returns only public rows with hydrated metadata", async () => {
    const tagId = await harness.db.insert("tags", {
      name: "PublicTag",
      normalized: "publictag",
      usageCount: 1,
    });
    const promptId = await harness.db.insert("prompts", {
      ownerUserId: "278674008",
      text: "Public prompt copy",
      tagIds: [tagId],
      createdAt: 3,
    });

    await harness.db.insert("assets", {
      ownerUserId: "278674008",
      kind: "image",
      sourceUrl: "https://example.com/public.jpg",
      promptId,
      tagIds: [tagId],
      modelName: "pub-model",
      pillar: "creators",
      isPublic: true,
      createdAt: 400,
    });
    await harness.db.insert("assets", {
      ownerUserId: "278674008",
      kind: "image",
      sourceUrl: "https://example.com/private.jpg",
      promptId,
      tagIds: [tagId],
      modelName: "pub-model",
      pillar: "creators",
      isPublic: false,
      createdAt: 300,
    });

    const ctx = {
      ...harness.ctx,
      storage: {
        getUrl: async (_storageId: string) => null,
      },
    };

    const results = await listPublicGalleryAssets._handler(ctx as never, {
      pillar: "creators",
      search: "public",
      limit: 10,
    });

    expect(results.length).toBe(1);
    expect(results[0]?.isPublic).toBeTrue();
    expect(results[0]?.promptText).toBe("Public prompt copy");
    expect(results[0]?.tagNames).toEqual(["PublicTag"]);
    expect(results[0]?.sourceUrl).toBe("https://example.com/public.jpg");
  });

  test("tagIdGroups ANDs the pills instead of unioning them", async () => {
    const locationTagId = await harness.db.insert("tags", {
      name: "Location",
      normalized: "location",
      usageCount: 2,
    });
    const liveActionTagId = await harness.db.insert("tags", {
      name: "Live Action",
      normalized: "live action",
      usageCount: 2,
    });
    const characterTagId = await harness.db.insert("tags", {
      name: "Character",
      normalized: "character",
      usageCount: 1,
    });

    const insertAsset = async (tagIds: string[], createdAt: number) =>
      await harness.db.insert("assets", {
        ownerUserId: "278674008",
        kind: "image",
        sourceUrl: `https://example.com/${createdAt}.jpg`,
        tagIds,
        isPublic: false,
        createdAt,
      });

    const bothId = await insertAsset([locationTagId, liveActionTagId], 300);
    await insertAsset([locationTagId], 200);
    await insertAsset([liveActionTagId, characterTagId], 100);

    const ctx = {
      ...harness.ctx,
      storage: { getUrl: async (_storageId: string) => null },
    };

    const results = await listGalleryAssets._handler(ctx as never, {
      ownerUserId: "278674008",
      tagIdGroups: [[locationTagId], [liveActionTagId]],
      limit: 20,
    });

    expect(results.map((asset) => asset._id)).toEqual([bothId]);
  });

  test("excludeTagIds and excludeFolderIds drop matching assets", async () => {
    const keepTagId = await harness.db.insert("tags", {
      name: "Cinematic",
      normalized: "cinematic",
      usageCount: 3,
    });
    const animationTagId = await harness.db.insert("tags", {
      name: "Animation",
      normalized: "animation",
      usageCount: 1,
    });
    const folderId = await harness.db.insert("folders", {
      ownerUserId: "278674008",
      name: "Characters",
      createdAt: 1,
    });

    const insertAsset = async (tagIds: string[], createdAt: number) =>
      await harness.db.insert("assets", {
        ownerUserId: "278674008",
        kind: "image",
        sourceUrl: `https://example.com/${createdAt}.jpg`,
        tagIds,
        isPublic: false,
        createdAt,
      });

    const keptId = await insertAsset([keepTagId], 300);
    await insertAsset([keepTagId, animationTagId], 200);
    const filedId = await insertAsset([keepTagId], 100);
    await harness.db.insert("assetFolders", {
      ownerUserId: "278674008",
      assetId: filedId,
      folderId,
      createdAt: 10,
    });

    const ctx = {
      ...harness.ctx,
      storage: { getUrl: async (_storageId: string) => null },
    };

    const results = await listGalleryAssets._handler(ctx as never, {
      ownerUserId: "278674008",
      tagIdGroups: [[keepTagId]],
      excludeTagIds: [animationTagId],
      excludeFolderIds: [folderId],
      limit: 20,
    });

    expect(results.map((asset) => asset._id)).toEqual([keptId]);
  });

  test("galleryAssetFacets returns counts without hydrated gallery payloads", async () => {
    await harness.db.insert("assets", {
      ownerUserId: "278674008",
      kind: "image",
      tagIds: [],
      modelName: "Midjourney",
      isPublic: true,
      createdAt: 300,
    });
    await harness.db.insert("assets", {
      ownerUserId: "telegram:278674008",
      kind: "image",
      tagIds: [],
      modelName: "midjourney",
      isPublic: false,
      createdAt: 200,
    });
    await harness.db.insert("assets", {
      ownerUserId: "other-user",
      kind: "image",
      tagIds: [],
      modelName: "Other Model",
      isPublic: true,
      createdAt: 100,
    });

    const mine = await galleryAssetFacets._handler(harness.ctx as never, {
      ownerUserId: "278674008",
    });
    expect(mine.totalCount).toBe(2);
    expect(mine.modelCounts).toEqual([{ name: "Midjourney", count: 2 }]);

    const publicFacets = await galleryAssetFacets._handler(
      harness.ctx as never,
      {
        isPublic: true,
      },
    );
    expect(publicFacets.totalCount).toBe(2);
    expect(publicFacets.modelCounts).toEqual([
      { name: "Midjourney", count: 1 },
      { name: "Other Model", count: 1 },
    ]);
  });
});
