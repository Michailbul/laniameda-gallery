import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { findSimilarAssets, searchAssets } from "../convex/semanticSearch";
import { callAsOwner } from "./helpers/call-as-owner";

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
            { _id: "semanticDocuments:1", assetId: "assets:1", modality: "multimodal_image" },
            { _id: "semanticDocuments:2", assetId: "assets:2", modality: "multimodal_image" },
          ];
        }
        if (payload.items) {
          return [
            {
              _id: "assets:1",
              isPublic: true,
              kind: "image",
              tagIds: [],
              tagNames: [],
              createdAt: 10,
              modelName: "imagen",
              score: 0.93,
            },
            {
              _id: "assets:2",
              isPublic: true,
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

    const results = await callAsOwner(searchAssets)(ctx as never, {
      scope: "public",
      query: "editorial brutalist",
      modelName: "imagen",
      kind: "image",
      limit: 10,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?._id).toBe("assets:1");
    // The fused score; each lane keeps its raw cosine score.
    expect(results[0]).toMatchObject({ score: 1, visualScore: 0.93, textScore: 0.93 });
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
            modality: "multimodal_image",
            embedding: [0.1, 0.2, 0.3],
          };
        }
        if ("ids" in payload && payload.ids) {
          return [
            { _id: "semanticDocuments:source", assetId: "assets:1", modality: "multimodal_image" },
            { _id: "semanticDocuments:other", assetId: "assets:2", modality: "multimodal_image" },
          ];
        }
        if ("items" in payload && payload.items) {
          return [
            {
              _id: "assets:2",
              isPublic: true,
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

    const results = await callAsOwner(findSimilarAssets)(ctx as never, {
      scope: "public",
      assetId: "assets:1" as never,
      limit: 10,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?._id).toBe("assets:2");
  });

  test("hybrid shares one unique identity lookup and preserves lane scores and rank fusion", async () => {
    const identityRequests: string[][] = [];
    const ctx = {
      vectorSearch: async (_table: string, index: string) => index === "by_embedding" ? [
        { _id: "semanticDocuments:video", _score: 0.99 },
        { _id: "semanticDocuments:a", _score: 0.9 },
        { _id: "semanticDocuments:b", _score: 0.85 },
        { _id: "semanticDocuments:duplicate-a", _score: 0.8 },
        { _id: "semanticDocuments:deleted", _score: 0.7 },
      ] : [
        { _id: "semanticDocuments:b", _score: 0.91 },
        { _id: "semanticDocuments:a", _score: 0.87 },
        { _id: "semanticDocuments:video", _score: 0.85 },
      ],
      runQuery: async (_ref: unknown, args: {
        ids?: string[]; queryHash?: string; items?: Array<{ assetId: string; score: number }>;
      }) => {
        if (args.queryHash) return [0.1, 0.2, 0.3]; // Cached: no provider request.
        if (args.ids) {
          identityRequests.push(args.ids);
          return [
            { _id: "semanticDocuments:a", assetId: "assets:a", modality: "multimodal_image" },
            { _id: "semanticDocuments:b", assetId: "assets:b", modality: "multimodal_image" },
            { _id: "semanticDocuments:duplicate-a", assetId: "assets:a", modality: "multimodal_image" },
            { _id: "semanticDocuments:video", assetId: "assets:video", modality: "text_only" },
          ];
        }
        return args.items?.map(({ assetId, ...scores }) => ({
          _id: assetId, isPublic: true, kind: "image", tagIds: [], tagNames: [], createdAt: 1, ...scores,
        })) ?? [];
      },
    };
    const result = await callAsOwner(searchAssets)(ctx, {
      scope: "public", query: "example", mode: "hybrid", minRelativeScore: 0,
    });
    expect(identityRequests).toEqual([[
      "semanticDocuments:video", "semanticDocuments:a", "semanticDocuments:b",
      "semanticDocuments:duplicate-a", "semanticDocuments:deleted",
    ], ["semanticDocuments:deleted"]]);
    expect(result.map((row) => row._id)).toEqual(["assets:a", "assets:b", "assets:video"]);
    expect(result[0]?.score).toBeCloseTo((1 + 61 / 62) / 2, 12);
    expect(result[1]?.score).toBeCloseTo((1 + 61 / 62) / 2, 12);
    expect(result[0]).toMatchObject({ visualScore: 0.9, textScore: 0.87 });
    expect(result[1]).toMatchObject({ visualScore: 0.85, textScore: 0.91 });
    expect(result[2]?.score).toBeCloseTo(61 / 63, 12);
    expect(result[2]).not.toHaveProperty("visualScore");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("similarity hybrid resolves shared hits once and still removes its source", async () => {
    let identityReads = 0;
    const ctx = {
      vectorSearch: async () => [
        { _id: "semanticDocuments:source", _score: 1 },
        { _id: "semanticDocuments:other", _score: 0.9 },
      ],
      runQuery: async (_ref: unknown, args: {
        assetId?: string; ids?: string[]; items?: Array<{ assetId: string; score: number }>;
      }) => {
        if (args.assetId) return {
          ownerUserId: "owner", isPublic: true, modality: "multimodal_image",
          embedding: [1, 2, 3], textEmbedding: [3, 2, 1],
        };
        if (args.ids) {
          identityReads += 1;
          expect(args.ids).toEqual(["semanticDocuments:source", "semanticDocuments:other"]);
          return args.ids.map((id) => ({ _id: id, assetId: id.replace("semanticDocuments", "assets"), modality: "multimodal_image" }));
        }
        return args.items?.map(({ assetId, ...scores }) => ({
          _id: assetId, ownerUserId: "owner", kind: "image", tagIds: [], tagNames: [], createdAt: 1, ...scores,
        })) ?? [];
      },
    };
    const result = await callAsOwner(findSimilarAssets)(ctx, {
      ownerUserId: "owner", scope: "mine", assetId: "assets:source", mode: "hybrid",
    });
    expect(identityReads).toBe(1);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ _id: "assets:other", score: 1, visualScore: 0.9, textScore: 0.9 });
  });

  test("owner and public vector scope filters remain enforced for both lanes", async () => {
    type Filter = { field: string; value: string } | { or: Filter[] };
    const filters: Filter[] = [];
    let identityReads = 0;
    const ctx = {
      vectorSearch: async (_table: string, _index: string, options: { filter: (q: {
        eq: (field: string, value: string) => Filter; or: (...filters: Filter[]) => Filter;
      }) => Filter }) => {
        filters.push(options.filter({ eq: (field, value) => ({ field, value }), or: (...or) => ({ or }) }));
        return [];
      },
      runQuery: async (_ref: unknown, args: { queryHash?: string; ids?: string[] }) => {
        if (args.ids) identityReads += 1;
        return args.queryHash ? [1, 2, 3] : [];
      },
    };
    await callAsOwner(searchAssets)(ctx, { ownerUserId: "123", scope: "mine", query: "example", pillar: "designs" });
    expect(filters).toEqual(Array(2).fill({ or: [
      { field: "scopePillarKey", value: "owner:123:asset:designs" },
      { field: "scopePillarKey", value: "owner:telegram:123:asset:designs" },
    ] }));
    filters.length = 0;
    await callAsOwner(searchAssets)(ctx, { scope: "public", query: "example", pillar: "designs" });
    expect(filters).toEqual(Array(2).fill({ field: "publicScopePillarKey", value: "public:asset:designs" }));
    expect(identityReads).toBe(0);
    await expect(callAsOwner(searchAssets)({
      ...ctx, auth: { getUserIdentity: async () => ({ subject: "different-owner" }) },
    }, { ownerUserId: "123", scope: "mine", query: "example" })).rejects.toThrow("does not match");
  });

  for (const scope of ["public", "mine"] as const) {
    for (const action of [searchAssets, findSimilarAssets]) {
      test(`${action === searchAssets ? "search" : "similarity"} ${scope} scope rejects stale vector visibility at final hydration`, async () => {
        const ctx = {
          vectorSearch: async () => [
            { _id: "semanticDocuments:stale", _score: 0.95 },
            { _id: "semanticDocuments:allowed", _score: 0.9 },
          ],
          runQuery: async (_ref: unknown, args: {
            queryHash?: string; assetId?: string; scope?: string; ownerCandidates?: string[];
            ids?: string[]; items?: Array<{ assetId: string; score: number }>;
          }) => {
            if (args.queryHash) return [1, 2, 3];
            if (args.assetId) {
              expect(args.scope).toBe(scope);
              expect(args.ownerCandidates).toEqual(scope === "mine" ? ["owner"] : []);
              return { ownerUserId: "owner", isPublic: true, modality: "multimodal_image", embedding: [1, 2, 3] };
            }
            if (args.ids) return args.ids.map((id) => ({
              _id: id, assetId: id.replace("semanticDocuments", "assets"),
              modality: "multimodal_image", ownerUserId: "owner", isPublic: true,
            }));
            return args.items?.map(({ assetId, ...scores }) => ({
              _id: assetId, kind: "image", tagIds: [], tagNames: [], createdAt: 1, ...scores,
              ownerUserId: assetId === "assets:stale" && scope === "mine" ? "other-owner" : "owner",
              isPublic: !(assetId === "assets:stale" && scope === "public"),
            })) ?? [];
          },
        };
        const results = await callAsOwner(action)(ctx, {
          scope, ownerUserId: "owner", query: "example", assetId: "assets:source",
          mode: "visual", minRelativeScore: 0, limit: 1,
        });
        expect(results.map((result) => result._id)).toEqual(["assets:allowed"]);
      });
    }
  }
});
