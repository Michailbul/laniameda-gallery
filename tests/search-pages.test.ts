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
      if (index !== "by_pixel_embedding") return [];
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
    const hits = Array.from({ length: 513 }, (_, index) => ({
      assetId: assetId(index) as never, score: 0.1,
    }));
    await expect(callAsOwner(loadSearchHits)(makeCtx().ctx, {
      scope: "mine", ownerUserId: OWNER, hits,
    })).rejects.toThrow("Too many search hits");
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
