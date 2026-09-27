import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { buildAssetFilter, fuseLanes, searchAssets } from "../convex/semanticSearch";
import { reindexAsset } from "../convex/semanticIndex";

describe("lane fusion", () => {
  test("a piece found by both lanes outranks one found by a single lane", () => {
    const fused = fuseLanes({
      visual: [
        { assetId: "assets:a" as never, score: 0.37 },
        { assetId: "assets:b" as never, score: 0.36 },
      ],
      text: [
        { assetId: "assets:b" as never, score: 0.71 },
        { assetId: "assets:c" as never, score: 0.7 },
      ],
    });
    expect(fused.map((hit) => hit.assetId)).toEqual(["assets:b", "assets:a", "assets:c"]);
    expect(fused[0]).toMatchObject({ visualScore: 0.36, textScore: 0.71 });
    expect(fused[0]!.score).toBeLessThanOrEqual(1);
  });

  test("single lane normalizes its top hit to 1", () => {
    const fused = fuseLanes({ visual: [{ assetId: "assets:a" as never, score: 0.4 }] });
    expect(fused[0]!.score).toBeCloseTo(1);
  });
});

describe("asset filters", () => {
  const asset = (tagNames: string[], extra: Record<string, unknown> = {}) => ({
    _id: "assets:1" as never,
    kind: "image" as const,
    tagNames,
    folderIds: [],
    ...extra,
  });

  test("tag names match canonically; all / any / exclude", () => {
    const keep = buildAssetFilter(
      { tagNames: ["Golden Hour"], anyTagNames: ["x", "instagram"], excludeTagNames: ["draft"] },
      "mine",
    );
    expect(keep(asset(["golden-hour", "x"]))).toBeTrue();
    expect(keep(asset(["golden_hour", "pinterest"]))).toBeFalse();
    expect(keep(asset(["golden hour", "x", "Draft"]))).toBeFalse();
  });

  test("piece type accepts plural and still spellings", () => {
    expect(buildAssetFilter({ pieceType: "character" }, "mine")(asset(["Characters"]))).toBeTrue();
    expect(buildAssetFilter({ pieceType: "scene" }, "mine")(asset(["stills"]))).toBeTrue();
    expect(buildAssetFilter({ pieceType: "location" }, "mine")(asset(["character"]))).toBeFalse();
  });

  test("medium: animation is the tag, live action is everything else", () => {
    const animation = buildAssetFilter({ medium: "animation" }, "mine");
    const live = buildAssetFilter({ medium: "live-action" }, "mine");
    expect(animation(asset(["animation"]))).toBeTrue();
    expect(animation(asset(["animated"]))).toBeFalse();
    expect(live(asset(["animated"]))).toBeTrue();
    expect(live(asset(["Animation"]))).toBeFalse();
  });

  test("liked, starred and collection filters", () => {
    expect(buildAssetFilter({ onlyLiked: true }, "mine")(asset([], { isLiked: true }))).toBeTrue();
    expect(buildAssetFilter({ onlyLiked: true }, "mine")(asset([]))).toBeFalse();
    expect(buildAssetFilter({ onlyStarred: true }, "mine")(asset([], { starredAt: 5 }))).toBeTrue();
    expect(
      buildAssetFilter({ folderId: "folders:1" as never }, "mine")(
        asset([], { folderIds: ["folders:1"] }),
      ),
    ).toBeTrue();
  });
});

describe("hybrid searchAssets", () => {
  beforeEach(() => {
    process.env.SEMANTIC_EMBEDDINGS_ENABLED = "true";
    process.env.SEMANTIC_EMBEDDING_DIMENSIONS = "3";
    process.env.GEMINI_API_KEY = "test-semantic-key";
  });
  afterEach(() => {
    delete process.env.SEMANTIC_EMBEDDINGS_ENABLED;
    delete process.env.SEMANTIC_EMBEDDING_DIMENSIONS;
    delete process.env.GEMINI_API_KEY;
  });

  const hydrated: Record<string, Record<string, unknown>> = {
    "assets:a": { _id: "assets:a", kind: "image", tagIds: [], tagNames: ["character"], folderIds: [], createdAt: 1 },
    "assets:b": { _id: "assets:b", kind: "image", tagIds: [], tagNames: ["location"], folderIds: [], createdAt: 2 },
    "assets:c": { _id: "assets:c", kind: "image", tagIds: [], tagNames: ["character", "animation"], folderIds: [], createdAt: 3 },
  };

  const makeCtx = (indexes: string[]) => ({
    vectorSearch: async (_table: string, index: string) => {
      indexes.push(index);
      return index === "by_embedding"
        ? [
            { _id: "semanticDocuments:a", _score: 0.4 },
            { _id: "semanticDocuments:b", _score: 0.39 },
            { _id: "semanticDocuments:c", _score: 0.2 },
          ]
        : [
            { _id: "semanticDocuments:c", _score: 0.8 },
            { _id: "semanticDocuments:b", _score: 0.6 },
          ];
    },
    runQuery: async (_ref: unknown, args: unknown) => {
      const payload = args as {
        queryHash?: string;
        ids?: string[];
        items?: Array<{ assetId: string; score: number }>;
      };
      if (payload.queryHash) return [0.1, 0.2, 0.3];
      if (payload.ids) {
        return payload.ids.map((id) => ({ _id: id, assetId: id.replace("semanticDocuments:", "assets:") }));
      }
      if (payload.items) {
        return payload.items.map((item) => ({ ...hydrated[item.assetId], ...item }));
      }
      return null;
    },
    runMutation: async () => null,
  });

  test("hybrid queries both lanes and fuses them", async () => {
    const indexes: string[] = [];
    const results = await searchAssets._handler(makeCtx(indexes) as never, {
      scope: "mine",
      ownerUserId: "278674008",
      query: "clay character",
      limit: 10,
    });
    expect(indexes.sort()).toEqual(["by_embedding", "by_text_embedding"]);
    // b is in both lanes (visual 0.39 within 0.85 of 0.4; text 0.6 within 0.75
    // of 0.8); c misses the visual cutoff, so it counts in one lane only.
    expect(results[0]?._id).toBe("assets:b");
    expect(results.map((asset) => asset._id)).toContain("assets:a");
  });

  test("visual mode queries the pixel lane only", async () => {
    const indexes: string[] = [];
    await searchAssets._handler(makeCtx(indexes) as never, {
      scope: "mine",
      ownerUserId: "278674008",
      query: "clay character",
      mode: "visual",
    });
    expect(indexes).toEqual(["by_embedding"]);
  });

  test("filters apply after fusion and switch the score cutoff off", async () => {
    const results = await searchAssets._handler(makeCtx([]) as never, {
      scope: "mine",
      ownerUserId: "278674008",
      query: "clay character",
      pieceType: "character",
      medium: "animation",
    });
    // c scores low visually but is the only animated character.
    expect(results.map((asset) => asset._id)).toEqual(["assets:c"]);
  });
});

describe("text lane indexing", () => {
  test("a pixel-lane 429 still saves the text lane", async () => {
    process.env.SEMANTIC_EMBEDDINGS_ENABLED = "true";
    process.env.SEMANTIC_EMBEDDING_DIMENSIONS = "3";
    process.env.GEMINI_API_KEY = "test-semantic-key";
    const originalFetch = global.fetch;
    global.fetch = mock(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("storage.example")) {
        return new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } });
      }
      if (url.includes("gemini-embedding-001")) {
        return new Response(JSON.stringify({ embedding: { values: [0.4, 0.5, 0.6] } }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("quota", { status: 429 });
    }) as unknown as typeof fetch;
    const writes: Array<Record<string, unknown>> = [];
    const retries: unknown[] = [];
    const ctx = {
      runQuery: async (_ref: unknown, args: unknown) =>
        (args as { sourceType?: string }).sourceType
          ? null
          : {
              assetId: "assets:2",
              ownerUserId: "278674008",
              kind: "image",
              contentType: "image/png",
              storageUrl: "https://storage.example/2.png",
              agentDescription: "Neon alley at night.",
              tagNames: [],
              isPublic: false,
              sourceUpdatedAt: 1,
            },
      runMutation: async (_ref: unknown, args: unknown) => {
        writes.push(args as Record<string, unknown>);
        return "semanticDocuments:2";
      },
      scheduler: {
        runAfter: async (_d: number, _r: unknown, args: unknown) => {
          retries.push(args);
          return null;
        },
      },
    };
    try {
      const result = await reindexAsset._handler(ctx as never, { assetId: "assets:2" as never });
      expect(result.status).toBe("indexed");
      expect(result.retryScheduled).toBeTrue();
      const upsert = writes.find((w) => "searchText" in w)!;
      expect(upsert.textEmbedding).toEqual([0.4, 0.5, 0.6]);
      expect(upsert.embedding).toBeUndefined();
      expect(retries).toHaveLength(1);
    } finally {
      global.fetch = originalFetch;
      delete process.env.SEMANTIC_EMBEDDINGS_ENABLED;
      delete process.env.SEMANTIC_EMBEDDING_DIMENSIONS;
      delete process.env.GEMINI_API_KEY;
    }
  });

  const originalFetch = global.fetch;
  beforeEach(() => {
    process.env.SEMANTIC_EMBEDDINGS_ENABLED = "true";
    process.env.SEMANTIC_EMBEDDING_DIMENSIONS = "3";
    process.env.GEMINI_API_KEY = "test-semantic-key";
  });
  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.SEMANTIC_EMBEDDINGS_ENABLED;
    delete process.env.SEMANTIC_EMBEDDING_DIMENSIONS;
    delete process.env.GEMINI_API_KEY;
  });

  test("an image asset gets a pixel embedding plus a text embedding, and reuses both", async () => {
    const embedBodies: string[] = [];
    const embedUrls: string[] = [];
    global.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("storage.example")) {
        return new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/png" } });
      }
      embedUrls.push(url);
      embedBodies.push(String(init?.body ?? ""));
      return new Response(JSON.stringify({ embedding: { values: [0.1, 0.2, 0.3] } }), {
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const source = {
      assetId: "assets:1",
      ownerUserId: "278674008",
      kind: "image",
      contentType: "image/png",
      storageUrl: "https://storage.example/1.png",
      storageId: "_storage:1",
      agentDescription: "Clay character waves from a doorway.",
      tagNames: ["character", "animation"],
      isPublic: false,
      sourceUpdatedAt: 1,
    };
    let stored: Record<string, unknown> | null = null;
    const ctx = {
      runQuery: async (_ref: unknown, args: unknown) => {
        const payload = args as { assetId?: string; sourceType?: string };
        if (payload.sourceType) return stored;
        return source;
      },
      runMutation: async (_ref: unknown, args: unknown) => {
        const payload = args as Record<string, unknown>;
        if ("searchText" in payload) {
          stored = {
            ...(stored ?? {}),
            ...payload,
            embedding: payload.embedding ?? stored?.embedding,
            textEmbedding: payload.textEmbedding ?? stored?.textEmbedding,
          };
          return "semanticDocuments:1";
        }
        return null;
      },
      scheduler: { runAfter: async () => null },
    };

    const first = await reindexAsset._handler(ctx as never, { assetId: "assets:1" as never });
    expect(first.status).toBe("indexed");
    expect(embedBodies).toHaveLength(2); // words + pixels
    // The text lane runs on its own model, first, as a retrieval document.
    expect(embedUrls[0]).toContain("gemini-embedding-001");
    expect(embedBodies[0]).toContain("Clay character waves from a doorway.");
    expect(embedBodies[0]).toContain("RETRIEVAL_DOCUMENT");
    expect(embedBodies[1]).toContain("inline_data");
    expect(stored!.searchText).toContain("Clay character waves");
    expect(stored!.textEmbedding).toEqual([0.1, 0.2, 0.3]);

    await reindexAsset._handler(ctx as never, { assetId: "assets:1" as never });
    expect(embedBodies).toHaveLength(2); // nothing changed, nothing re-embedded
  });
});
