import { beforeEach, describe, expect, test } from "bun:test";

import { listGalleryAssets, listPublicGalleryAssets } from "../convex/assets";
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
});
