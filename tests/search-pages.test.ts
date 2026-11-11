import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { loadSearchHits, searchAssets, searchAssetsPage } from "../convex/semanticSearch";
import { callAsOwner } from "./helpers/call-as-owner";

const OWNER = "278674008";
const assetId = (index: number) => `assets:${String(index).padStart(3, "0")}`;

// 150 images in the pixel lane, scores falling from 0.40: 20 close matches,
// then 130 weaker ones.
const makeCtx = (foreign = new Set<string>()) => {
  const vectorTakes: number[] = [];
  const hydratedCounts: number[] = [];
  const ctx = {
    vectorSearch: async (_table: string, index: string, options: { limit: number }) => {
      vectorTakes.push(options.limit);
      if (index !== "by_embedding") return [];
      return Array.from({ length: 150 }, (_, i) => ({
        _id: assetId(i).replace("assets:", "semanticDocuments:"),
        _score: i < 20 ? 0.4 - i * 0.001 : 0.3 - i * 0.001,
      })).slice(0, options.limit);
    },
    runQuery: async (_ref: unknown, args: unknown) => {
      const payload = args as {
        queryHash?: string;
        ids?: string[];
        items?: Array<{ assetId: string; score: number }>;
      };
      if (payload.queryHash) return [0.1, 0.2, 0.3];
      if (payload.ids) {
        return payload.ids.map((id) => ({
          _id: id,
          assetId: id.replace("semanticDocuments:", "assets:"),
          modality: "multimodal_image",
        }));
      }
      if (payload.items) {
        hydratedCounts.push(payload.items.length);
        return payload.items.map((item) => ({
          _id: item.assetId, kind: "image", tagIds: [], tagNames: [], folderIds: [], createdAt: 1,
          ...item,
          ownerUserId: foreign.has(item.assetId) ? "999" : OWNER,
        }));
      }
      return null;
    },
    runMutation: async () => null,
  };
  return { ctx: ctx as never, vectorTakes, hydratedCounts };
};

describe("paged grid search", () => {
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

  test("scrolling reads every ranked hit, once, in order", async () => {
    const { ctx, vectorTakes, hydratedCounts } = makeCtx();
    const first = await callAsOwner(searchAssetsPage)(ctx, {
      scope: "mine", ownerUserId: OWNER, query: "white car", mode: "visual", pageSize: 60,
    });
    expect(first.results).toHaveLength(60);
    expect(first.remaining).toHaveLength(90);
    // One pass per lane at Convex's ceiling; pages after it never search again.
    expect(vectorTakes).toEqual([256]);
    expect(hydratedCounts).toEqual([60]);

    const seen = first.results.map((asset) => asset._id as string);
    let remaining = first.remaining;
    while (remaining.length > 0) {
      const page = await callAsOwner(loadSearchHits)(ctx, {
        scope: "mine", ownerUserId: OWNER, hits: remaining, pageSize: 60,
      });
      seen.push(...page.results.map((asset) => asset._id as string));
      remaining = page.remaining;
    }
    expect(vectorTakes).toEqual([256]);
    expect(seen).toEqual(Array.from({ length: 150 }, (_, i) => assetId(i)));
    // Scores never rise as the list goes on.
    const scores = first.results.map((asset) => asset.score ?? 0);
    expect(scores).toEqual([...scores].sort((left, right) => right - left));
  });

  test("the first results are the ones the one-shot search returns", async () => {
    const page = await callAsOwner(searchAssetsPage)(makeCtx().ctx, {
      scope: "mine", ownerUserId: OWNER, query: "white car", mode: "visual", pageSize: 60,
    });
    const oneShot = await callAsOwner(searchAssets)(makeCtx().ctx, {
      scope: "mine", ownerUserId: OWNER, query: "white car", mode: "visual", limit: 100,
    });
    // The agents' search and the grid read the same ranking.
    expect(oneShot).toHaveLength(100);
    expect(oneShot.slice(0, 60).map((asset) => asset._id))
      .toEqual(page.results.map((asset) => asset._id));
    expect(oneShot.slice(0, 60).map((asset) => asset.score))
      .toEqual(page.results.map((asset) => asset.score));
  });

  test("hits handed back by the caller are still checked against its scope", async () => {
    const { ctx } = makeCtx(new Set([assetId(1)]));
    const page = await callAsOwner(loadSearchHits)(ctx, {
      scope: "mine",
      ownerUserId: OWNER,
      hits: [0, 1, 2].map((index) => ({ assetId: assetId(index) as never, score: 0.5 })),
    });
    expect(page.results.map((asset) => asset._id as string)).toEqual([assetId(0), assetId(2)]);
    expect(page.remaining).toEqual([]);
  });

  test("a request with more hits than a search can rank is refused", async () => {
    // Three phrasings of two 256-hit lanes each is the most a search ranks.
    const hits = Array.from({ length: 1537 }, (_, index) => ({
      assetId: assetId(index) as never, score: 0.1,
    }));
    await expect(callAsOwner(loadSearchHits)(makeCtx().ctx, {
      scope: "mine", ownerUserId: OWNER, hits,
    })).rejects.toThrow("Too many search hits");
  });
});

// Each phrase embeds to its own code, so the mock lanes can tell them apart.
const PHRASES: Record<string, number> = {
  interiors: 1, "city street": 2, cars: 3, "interiors, DEAR ANNETE": 4,
};
const lane = (from: number, count: number, top: number, step: number) =>
  Array.from({ length: count }, (_, i) => ({
    _id: assetId(from + i).replace("assets:", "semanticDocuments:"), _score: top - i * step,
  }));
const LANES: Record<number, Array<{ _id: string; _score: number }>> = {
  1: lane(0, 10, 0.4, 0.005),
  2: lane(5, 10, 0.41, 0.005),
  // Pieces 0 and 1 clearly show cars; twenty others barely register.
  3: [...lane(0, 2, 0.45, 0.01), ...lane(20, 20, 0.31, 0.001)],
  4: lane(0, 10, 0.7, 0.005),
};
const DESCRIBED: Record<string, Record<string, unknown>> = {
  [assetId(7)]: { agentDescription: "A vintage car parked on a wet street." },
  [assetId(8)]: { agentDescription: "An empty street at dawn.", promptText: "empty street, no cars, soft light" },
};

describe("a search said in steps", () => {
  const embedded: Array<{ model: string; text: string }> = [];
  const originalFetch = global.fetch;
  beforeEach(() => {
    process.env.SEMANTIC_EMBEDDINGS_ENABLED = "true";
    process.env.SEMANTIC_EMBEDDING_DIMENSIONS = "3";
    process.env.GEMINI_API_KEY = "test-semantic-key";
    embedded.length = 0;
    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const text = (JSON.parse(String(init?.body)) as { content: { parts: Array<{ text: string }> } })
        .content.parts[0]!.text;
      embedded.push({ model: String(input).match(/models\/([^:]+):/)![1]!, text });
      return new Response(JSON.stringify({ embedding: { values: [PHRASES[text] ?? 0, 0, 0] } }), {
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.SEMANTIC_EMBEDDINGS_ENABLED;
    delete process.env.SEMANTIC_EMBEDDING_DIMENSIONS;
    delete process.env.GEMINI_API_KEY;
  });

  const makeStepCtx = () => ({
    vectorSearch: async (_table: string, index: string, options: { vector: number[] }) => {
      const code = options.vector[0]!;
      // Code 4 is a text-lane query; the others are asked of the pixel lane.
      return (index === "by_embedding") === (code !== 4) ? LANES[code] ?? [] : [];
    },
    runQuery: async (_ref: unknown, args: unknown) => {
      const payload = args as { queryHash?: string; ids?: string[]; items?: Array<{ assetId: string }> };
      if (payload.queryHash) return null;
      if (payload.ids) {
        return payload.ids.map((id) => ({
          _id: id, assetId: id.replace("semanticDocuments:", "assets:"), modality: "multimodal_image",
        }));
      }
      return (payload.items ?? []).map((item) => ({
        _id: item.assetId, kind: "image", tagIds: [], tagNames: [], folderIds: [], createdAt: 1,
        ownerUserId: OWNER, ...DESCRIBED[item.assetId], ...item,
      }));
    },
    runMutation: async () => null,
  }) as never;

  test("either phrasing finds a piece; what the search leaves out is dropped by look and by name", async () => {
    const page = await callAsOwner(searchAssetsPage)(makeStepCtx(), {
      scope: "mine", ownerUserId: OWNER, mode: "visual",
      query: "interiors", alternatives: ["city street"], exclude: ["cars"], pageSize: 60,
    });
    const ids = page.results.map((asset) => asset._id as string);
    // 0-9 answer "interiors", 5-14 "city street".
    expect(ids).toContain(assetId(3));
    expect(ids).toContain(assetId(12));
    expect(new Set(ids).size).toBe(ids.length);
    // 0 and 1 clearly show cars; 7 is described as one.
    expect(ids).not.toContain(assetId(0));
    expect(ids).not.toContain(assetId(1));
    expect(ids).not.toContain(assetId(7));
    // A prompt saying "no cars" does not make its picture a car.
    expect(ids).toContain(assetId(8));
    expect(ids).toHaveLength(12);
    expect(embedded.map((call) => call.text).sort()).toEqual(["cars", "city street", "interiors"]);
  });

  test("later pages leave out the same things", async () => {
    const page = await callAsOwner(loadSearchHits)(makeStepCtx(), {
      scope: "mine", ownerUserId: OWNER, exclude: ["cars"],
      hits: [6, 7, 8].map((index) => ({ assetId: assetId(index) as never, score: 0.5 })),
    });
    expect(page.results.map((asset) => asset._id as string)).toEqual([assetId(6), assetId(8)]);
  });

  test("the name of the world goes to the text lane only", async () => {
    const page = await callAsOwner(searchAssetsPage)(makeStepCtx(), {
      scope: "mine", ownerUserId: OWNER, query: "interiors", textHint: "DEAR ANNETE", pageSize: 5,
    });
    expect(page.results).toHaveLength(5);
    expect(embedded).toContainEqual({ model: "gemini-embedding-2-preview", text: "interiors" });
    expect(embedded).toContainEqual({ model: "gemini-embedding-001", text: "interiors, DEAR ANNETE" });
    expect(embedded).toHaveLength(2);
  });

  describe("with the picture check on", () => {
    beforeEach(() => {
      process.env.TYPESAFE_API_KEY = "test-typesafe-key";
    });
    afterEach(() => {
      delete process.env.TYPESAFE_API_KEY;
    });

    // The model sees a car in piece 9 that no description or tag mentions.
    const makeJudgeCtx = (known: Array<{ assetId: string; phrase: string; probability: number }> = []) => {
      const asked: Array<{ pictures: Array<{ assetId: string; imageUrl: string }>; phrases: string[] }> = [];
      const saved: Array<{ assetId: string; phrase: string; probability: number }> = [];
      const base = makeStepCtx() as unknown as {
        runQuery: (ref: unknown, args: unknown) => Promise<unknown>;
      };
      const ctx = {
        ...base,
        runQuery: async (ref: unknown, args: unknown) => {
          const payload = args as { assetIds?: string[]; phrases?: string[]; items?: Array<{ assetId: string }> };
          if (payload.assetIds) return known.filter((row) => payload.assetIds!.includes(row.assetId));
          const rows = await base.runQuery(ref, args);
          return payload.items
            ? (rows as Array<{ _id: string }>).map((row) => ({ ...row, thumbUrl: `https://img.example/${row._id}.webp` }))
            : rows;
        },
        runAction: async (_ref: unknown, args: unknown) => {
          const call = args as (typeof asked)[number];
          asked.push(call);
          return {
            model: "jev-latest",
            judged: call.pictures.map((picture) => ({
              assetId: picture.assetId, probabilities: [picture.assetId === assetId(9) ? 0.93 : 0.04],
            })),
          };
        },
        runMutation: async (_ref: unknown, args: unknown) => {
          const payload = args as { judgments?: typeof saved };
          if (payload.judgments) saved.push(...payload.judgments);
          return null;
        },
      };
      return { ctx: ctx as never, asked, saved };
    };

    test("a picture the model says shows the thing is dropped, and the answer is kept", async () => {
      const { ctx, asked, saved } = makeJudgeCtx();
      const page = await callAsOwner(searchAssetsPage)(ctx, {
        scope: "mine", ownerUserId: OWNER, mode: "visual", query: "interiors", exclude: ["cars"], pageSize: 60,
      });
      const ids = page.results.map((asset) => asset._id as string);
      // 0 and 1 go by look, 7 by its description, 9 by the picture check.
      expect(ids).toEqual([2, 3, 4, 5, 6, 8].map(assetId));
      // Only pieces that passed the cheaper tests are shown to the model.
      expect(asked).toHaveLength(1);
      expect(asked[0]!.phrases).toEqual(["cars"]);
      expect(asked[0]!.pictures.map((picture) => picture.assetId)).toEqual([2, 3, 4, 5, 6, 8, 9].map(assetId));
      expect(saved).toHaveLength(7);
      expect(saved.find((row) => row.assetId === assetId(9))).toMatchObject({ phrase: "cars", probability: 0.93 });
    });

    test("a question already answered is not asked again", async () => {
      const known = [2, 3, 4, 5, 6, 8, 9].map((index) => ({
        assetId: assetId(index), phrase: "cars", probability: index === 9 ? 0.93 : 0.04,
      }));
      const { ctx, asked, saved } = makeJudgeCtx(known);
      const page = await callAsOwner(loadSearchHits)(ctx, {
        scope: "mine", ownerUserId: OWNER, exclude: ["cars"],
        hits: [8, 9].map((index) => ({ assetId: assetId(index) as never, score: 0.5 })),
      });
      expect(page.results.map((asset) => asset._id as string)).toEqual([assetId(8)]);
      expect(asked).toHaveLength(0);
      expect(saved).toHaveLength(0);
    });

    test("a visitor's search never asks the model", async () => {
      const { ctx, asked } = makeJudgeCtx();
      const base = ctx as unknown as { runQuery: (ref: unknown, args: unknown) => Promise<unknown> };
      const publicCtx = {
        ...(ctx as object),
        runQuery: async (ref: unknown, args: unknown) => {
          const rows = await base.runQuery(ref, args);
          return (args as { items?: unknown }).items
            ? (rows as object[]).map((row) => ({ ...row, isPublic: true }))
            : rows;
        },
      };
      const page = await callAsOwner(searchAssetsPage)(publicCtx as never, {
        scope: "public", mode: "visual", query: "interiors", exclude: ["cars"], pageSize: 60,
      });
      expect(page.results.map((asset) => asset._id as string)).toContain(assetId(9));
      expect(asked).toHaveLength(0);
    });
  });

  test("more than three phrasings are refused", async () => {
    await expect(callAsOwner(searchAssetsPage)(makeStepCtx(), {
      scope: "mine", ownerUserId: OWNER, query: "a", alternatives: ["b", "c", "d"],
    })).rejects.toThrow("at most 3 alternatives");
  });
});

describe("keyword results after the ranked ones", () => {
  test("whole words only, plurals either way, every word required", async () => {
    const { galleryWordMatcher } = await import("../lib/gallery-search");
    const car = galleryWordMatcher("car");
    expect(car("white car in a hangar")).toBeTrue();
    expect(car("CARS collection")).toBeTrue();
    expect(car("character sheet, red scarf, cartoon")).toBeFalse();
    expect(galleryWordMatcher("cars")("one car")).toBeTrue();
    const redCar = galleryWordMatcher("red car");
    expect(redCar("a car, painted red")).toBeTrue();
    expect(redCar("a red door")).toBeFalse();
    expect(galleryWordMatcher("  ")("anything")).toBeFalse();
  });
});
