import { beforeEach, describe, expect, test } from "bun:test";

import {
  getAssetSourceForReindex,
  recordSemanticIndexFailure,
  resolveSemanticIndexFailure,
  upsertSemanticDocument,
} from "../convex/semanticIndex";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

describe("semantic index backend", () => {
  let harness: ReturnType<typeof createMockConvexMutationCtx>;

  beforeEach(() => {
    harness = createMockConvexMutationCtx();
  });

  test("asset source query includes linked prompt/design content and storage url", async () => {
    const styleTagId = await harness.db.insert("tags", {
      name: "Editorial",
      normalized: "editorial",
      usageCount: 1,
    });
    const layoutTagId = await harness.db.insert("tags", {
      name: "Brutalist",
      normalized: "brutalist",
      usageCount: 1,
    });
    const promptId = await harness.db.insert("prompts", {
      ownerUserId: "278674008",
      text: "Editorial brutalist landing page",
      tagIds: [styleTagId],
      createdAt: 10,
    });
    const designInspirationId = await harness.db.insert("designInspirations", {
      ownerUserId: "278674008",
      pillar: "designs",
      title: "Reference hero",
      summary: "Magazine style split layout",
      sourceDomain: "example.com",
      sourceUrl: "https://example.com/reference",
      searchText: "reference hero magazine style split layout",
      inspirationType: "landing_page",
      tagIds: [layoutTagId],
      createdAt: 20,
      updatedAt: 25,
    });
    const assetId = await harness.db.insert("assets", {
      ownerUserId: "278674008",
      kind: "image",
      storageId: "_storage:asset-1",
      contentType: "image/png",
      fileName: "hero-shot.png",
      sourceUrl: "https://cdn.example.com/hero-shot.png",
      promptId,
      designInspirationId,
      tagIds: [styleTagId, layoutTagId],
      pillar: "designs",
      modelName: "imagen",
      isPublic: true,
      createdAt: 30,
    });

    const source = await getAssetSourceForReindex._handler(
      {
        ...harness.ctx,
        storage: {
          getUrl: async (storageId: string) =>
            storageId === "_storage:asset-1"
              ? "https://convex.example/storage/asset-1"
              : null,
        },
      } as never,
      { assetId: assetId as never },
    );

    expect(source).not.toBeNull();
    expect(source?.promptText).toBe("Editorial brutalist landing page");
    expect(source?.designTitle).toBe("Reference hero");
    expect(source?.designSummary).toBe("Magazine style split layout");
    expect(source?.designSourceDomain).toBe("example.com");
    expect(source?.storageUrl).toBe("https://convex.example/storage/asset-1");
    expect(source?.tagNames).toEqual(["Editorial", "Brutalist"]);
    expect(source?.isPublic).toBeTrue();
  });

  test("upsertSemanticDocument updates existing rows instead of duplicating", async () => {
    const firstId = await upsertSemanticDocument._handler(harness.ctx as never, {
      ownerUserId: "278674008",
      sourceType: "asset",
      sourceId: "assets:1",
      assetId: "assets:1" as never,
      isPublic: false,
      kind: "image",
      modality: "text_only",
      searchText: "first version",
      contentHash: "hash-1",
      embeddingModel: "gemini-embedding-2-preview",
      embeddingDimensions: 3,
      embedding: [0.1, 0.2, 0.3],
      scopeKey: "owner:278674008:asset",
      sourceUpdatedAt: 1,
    });

    const secondId = await upsertSemanticDocument._handler(harness.ctx as never, {
      ownerUserId: "278674008",
      sourceType: "asset",
      sourceId: "assets:1",
      assetId: "assets:1" as never,
      isPublic: true,
      kind: "image",
      modality: "text_only",
      searchText: "second version",
      contentHash: "hash-2",
      embeddingModel: "gemini-embedding-2-preview",
      embeddingDimensions: 3,
      embedding: [0.4, 0.5, 0.6],
      scopeKey: "owner:278674008:asset",
      publicScopeKey: "public:asset",
      sourceUpdatedAt: 2,
    });

    expect(secondId).toBe(firstId);

    const docs = harness.db.getTableDocs("semanticDocuments");
    expect(docs).toHaveLength(1);
    expect(docs[0]?.searchText).toBe("second version");
    expect(docs[0]?.contentHash).toBe("hash-2");
    expect(docs[0]?.isPublic).toBeTrue();
    expect(docs[0]?.embedding).toEqual([0.4, 0.5, 0.6]);
  });

  test("semantic failure rows increment attempts and resolve cleanly", async () => {
    const first = await recordSemanticIndexFailure._handler(harness.ctx as never, {
      ownerUserId: "278674008",
      sourceType: "asset",
      sourceId: "assets:1",
      errorMessage: "temporary failure",
    });
    const second = await recordSemanticIndexFailure._handler(harness.ctx as never, {
      ownerUserId: "278674008",
      sourceType: "asset",
      sourceId: "assets:1",
      errorMessage: "retry failure",
    });

    expect(first.attemptCount).toBe(1);
    expect(second.attemptCount).toBe(2);
    expect(second.failureId).toBe(first.failureId);

    const resolved = await resolveSemanticIndexFailure._handler(harness.ctx as never, {
      sourceType: "asset",
      sourceId: "assets:1",
    });

    expect(resolved.resolved).toBeTrue();
    const rows = harness.db.getTableDocs("semantic_index_failures");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("resolved");
  });
});
