import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { findSimilarAssets, searchAssets } from "../convex/semanticSearch";

describe("semantic search actions", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.SEMANTIC_EMBEDDINGS_ENABLED = "true";
    process.env.SEMANTIC_EMBEDDING_MODEL = "gemini-embedding-2-preview";
    process.env.SEMANTIC_EMBEDDING_DIMENSIONS = "3";
    process.env.GEMINI_API_KEY = "test-semantic-key";
    global.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          embedding: { values: [0.1, 0.2, 0.3] },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    ) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.SEMANTIC_EMBEDDINGS_ENABLED;
    delete process.env.SEMANTIC_EMBEDDING_MODEL;
    delete process.env.SEMANTIC_EMBEDDING_DIMENSIONS;
    delete process.env.GEMINI_API_KEY;
  });

  test("searchAssets returns post-filtered public asset results", async () => {
    const ctx = {
      vectorSearch: async () => [
        { _id: "semanticDocuments:1", _score: 0.93 },
        { _id: "semanticDocuments:2", _score: 0.77 },
      ],
      runQuery: async (_ref: unknown, args: unknown) => {
        const payload = args as { ids?: string[]; items?: Array<{ assetId: string; score: number }> };
        if (payload.ids) {
          return [
            { _id: "semanticDocuments:1", assetId: "assets:1" },
            { _id: "semanticDocuments:2", assetId: "assets:2" },
          ];
        }
        if (payload.items) {
          return [
            {
              _id: "assets:1",
              kind: "image",
              tagIds: [],
              tagNames: [],
              createdAt: 10,
              modelName: "imagen",
              score: 0.93,
            },
            {
              _id: "assets:2",
              kind: "image",
              tagIds: [],
              tagNames: [],
              createdAt: 9,
              modelName: "other-model",
              score: 0.77,
            },
          ];
        }
        return [];
      },
    };

    const results = await searchAssets._handler(ctx as never, {
      scope: "public",
      query: "editorial brutalist",
      modelName: "imagen",
      kind: "image",
      limit: 10,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?._id).toBe("assets:1");
    expect(results[0]?.score).toBe(0.93);
  });

  test("findSimilarAssets excludes the source asset", async () => {
    const ctx = {
      vectorSearch: async () => [
        { _id: "semanticDocuments:source", _score: 1 },
        { _id: "semanticDocuments:other", _score: 0.88 },
      ],
      runQuery: async (_ref: unknown, args: unknown) => {
        const payload = args as
          | { assetId?: string }
          | { ids?: string[] }
          | { items?: Array<{ assetId: string; score: number }> };
        if ("assetId" in payload && payload.assetId) {
          return {
            _id: "semanticDocuments:source",
            ownerUserId: "278674008",
            pillar: "designs",
            isPublic: true,
            embedding: [0.1, 0.2, 0.3],
          };
        }
        if ("ids" in payload && payload.ids) {
          return [
            { _id: "semanticDocuments:source", assetId: "assets:1" },
            { _id: "semanticDocuments:other", assetId: "assets:2" },
          ];
        }
        if ("items" in payload && payload.items) {
          return [
            {
              _id: "assets:2",
              kind: "image",
              tagIds: [],
              tagNames: [],
              createdAt: 11,
              score: 0.88,
            },
          ];
        }
        return null;
      },
    };

    const results = await findSimilarAssets._handler(ctx as never, {
      scope: "public",
      assetId: "assets:1" as never,
      limit: 10,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?._id).toBe("assets:2");
  });
});
