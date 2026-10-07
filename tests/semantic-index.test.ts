import { beforeEach, describe, expect, test } from "bun:test";

import {
  getAssetSourceForReindex,
  recordSemanticIndexFailure,
  resolveSemanticIndexFailure,
  reindexAsset,
  upsertSemanticDocument,
} from "../convex/semanticIndex";
import { getFunctionName } from "convex/server";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { callAsOwner } from "./helpers/call-as-owner";

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

    const source = await callAsOwner(getAssetSourceForReindex)(
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
    const firstId = await callAsOwner(upsertSemanticDocument)(harness.ctx as never, {
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

    const secondId = await callAsOwner(upsertSemanticDocument)(harness.ctx as never, {
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
    const first = await callAsOwner(recordSemanticIndexFailure)(harness.ctx as never, {
      ownerUserId: "278674008",
      sourceType: "asset",
      sourceId: "assets:1",
      errorMessage: "temporary failure",
    });
    const second = await callAsOwner(recordSemanticIndexFailure)(harness.ctx as never, {
      ownerUserId: "278674008",
      sourceType: "asset",
      sourceId: "assets:1",
      errorMessage: "retry failure",
    });

    expect(first.attemptCount).toBe(1);
    expect(second.attemptCount).toBe(2);
    expect(second.failureId).toBe(first.failureId);

    const resolved = await callAsOwner(resolveSemanticIndexFailure)(harness.ctx as never, {
      sourceType: "asset",
      sourceId: "assets:1",
    });

    expect(resolved.resolved).toBeTrue();
    const rows = harness.db.getTableDocs("semantic_index_failures");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("resolved");
  });

  test("a text-only provider failure schedules a text-only retry and preserves the pixel vector", async () => {
    const names = ["SEMANTIC_EMBEDDINGS_ENABLED", "SEMANTIC_EMBEDDING_DIMENSIONS", "GEMINI_API_KEY"];
    const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
    const originalFetch = globalThis.fetch;
    process.env.SEMANTIC_EMBEDDINGS_ENABLED = "true";
    process.env.SEMANTIC_EMBEDDING_DIMENSIONS = "3";
    process.env.GEMINI_API_KEY = "fake-test-key-no-network";
    const pixel = [0.1, 0.2, 0.3];
    const semanticId = await callAsOwner(upsertSemanticDocument)(harness.ctx, {
      ownerUserId: "owner", sourceType: "asset", sourceId: "assets:one", assetId: "assets:one", isPublic: false,
      kind: "image", modality: "multimodal_image", searchText: "Old tags", contentHash: "old-pixel-hash",
      embeddingModel: "gemini-embedding-2-preview", embeddingDimensions: 3, embedding: pixel,
      textEmbedding: [0.2, 0.3, 0.4], textContentHash: "old-text-hash", scopeKey: "owner:owner:asset", sourceUpdatedAt: 1,
    });
    const requests: string[] = [];
    const retries: Record<string, unknown>[] = [];
    let fail = true;
    globalThis.fetch = (async (input) => {
      requests.push(String(input));
      return fail ? new Response("Temporary text provider failure", { status: 429 }) : Response.json({ embedding: { values: [0.6, 0.7, 0.8] } });
    }) as typeof fetch;
    const ctx = {
      ...harness.ctx,
      runQuery: async (ref: Parameters<typeof getFunctionName>[0]) => getFunctionName(ref) === "semanticIndex:getAssetSourceForReindex"
        ? { assetId: "assets:one", ownerUserId: "owner", kind: "image", contentType: "image/png", storageUrl: "https://example.com/image.png", tagNames: ["motion-design", "still-reference"], agentDescription: "A static motion reference", isPublic: false, sourceUpdatedAt: 1 }
        : harness.db.get(semanticId),
      runMutation: async (ref: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) => {
        if (getFunctionName(ref) === "semanticIndex:upsertSemanticDocument") return callAsOwner(upsertSemanticDocument)(harness.ctx, args);
        return null;
      },
      scheduler: { runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => { retries.push(args); return null; } },
    };
    try {
      const first = await callAsOwner(reindexAsset)(ctx, { assetId: "assets:one", textOnly: true });
      expect(first).toMatchObject({ status: "skipped", retryScheduled: true });
      expect(retries).toEqual([{ assetId: "assets:one", attempt: 1, textOnly: true }]);
      fail = false;
      const retried = await callAsOwner(reindexAsset)(ctx, retries[0]);
      expect(retried).toMatchObject({ status: "indexed", retryScheduled: false });
      const saved = await harness.db.get(semanticId);
      expect(saved?.embedding).toEqual(pixel); expect(saved?.contentHash).toBe("old-pixel-hash");
      expect(saved?.textEmbedding).toEqual([0.6, 0.7, 0.8]); expect(saved?.searchText).toContain("still-reference");
      expect(requests).toHaveLength(2);
      expect(requests.every(url => url.includes("gemini-embedding-001"))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; }
    }
  });
});
