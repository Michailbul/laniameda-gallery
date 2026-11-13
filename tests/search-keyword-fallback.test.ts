import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getFunctionName } from "convex/server";

import { SEARCHING_BY_WORDS, searchAssets, searchAssetsPage } from "../convex/semanticSearch";
import { keywordSearchString, keywordTerms, rankKeywordCandidates } from "../lib/keyword-ranking";
import { callAsOwner } from "./helpers/call-as-owner";

const OWNER = "278674008";

describe("ranking by words and tags", () => {
  const rank = (query: string, pieces: Array<[string, string, string[]]>) =>
    rankKeywordCandidates(query, pieces.map(([item, text, tagNames]) => ({ item, text, tagNames })))
      .map((hit) => hit.item);

  test("a piece tagged with the word leads one that only mentions it", () => {
    expect(rank("castle", [
      ["mentions", "A road; a castle far behind the trees.", []],
      ["tagged", "Stone walls at dusk.", ["castle", "location"]],
    ])).toEqual(["tagged", "mentions"]);
  });

  test("every word of the request beats one of them", () => {
    expect(rank("castle at night", [
      ["one", "A castle in the morning.", []],
      ["both", "A castle at night under the moon.", []],
    ])).toEqual(["both", "one"]);
  });

  test("a several-word tag inside the request counts as exact", () => {
    expect(rank("dear annete castle", [
      ["other", "Dear friend, a castle.", ["castle"]],
      ["world", "A castle on a cliff.", ["Dear Annete", "castle"]],
    ])[0]).toBe("world");
  });

  test("plurals either way; a prefix inside another word is not a match", () => {
    expect(rank("cars", [
      ["prefix", "A character portrait.", []],
      ["plural", "A red car on a wet street.", []],
    ])).toEqual(["plural"]);
  });

  test("filler words are not searched, plurals are", () => {
    expect(keywordTerms("show me the castles at night")).toEqual(["castles", "night"]);
    expect(keywordSearchString(["castles", "night"]).split(" ")).toEqual(["castles", "castle", "night", "nights"]);
    expect(keywordSearchString(["boxes", "dress"]).split(" ")).toEqual(["boxes", "box", "boxe", "dress", "dresses"]);
    expect(keywordSearchString(keywordTerms("a b c d e f g h i j k l")).split(" ").length).toBeLessThanOrEqual(16);
  });
});

// Gemini refuses every new request (no credit). The keyword index answers.
const makeCtx = () => {
  const keywordQueries: string[] = [];
  const ctx = {
    vectorSearch: async () => {
      throw new Error("vector search must not run without a query vector");
    },
    runQuery: async (ref: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) => {
      const name = getFunctionName(ref);
      if (args.queryHash) return null;
      if (name === "assetKeywords:searchKeywordHits") {
        keywordQueries.push(args.query as string);
        return Array.from({ length: 80 }, (_, i) => ({
          assetId: `assets:${String(i).padStart(3, "0")}`, score: 1 - i * 0.01,
        }));
      }
      if (args.items) {
        return (args.items as Array<{ assetId: string; score: number }>).map((item) => ({
          _id: item.assetId, kind: "image", tagIds: [], folderIds: [], createdAt: 1, ownerUserId: OWNER,
          tagNames: item.assetId === "assets:001" ? ["cars"] : ["castle"],
          agentDescription: "A castle on a hill.", ...item,
        }));
      }
      return null;
    },
    runMutation: async () => null,
    runAction: async () => ({ judged: [] }),
  };
  return { ctx: ctx as never, keywordQueries };
};

describe("search without embedding credit", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    process.env.SEMANTIC_EMBEDDINGS_ENABLED = "true";
    process.env.SEMANTIC_EMBEDDING_DIMENSIONS = "3";
    process.env.GEMINI_API_KEY = "test-gemini-key";
    global.fetch = (async () => new Response(
      JSON.stringify({ error: { code: 402, message: "Your prepayment credits are depleted." } }),
      { status: 402 },
    )) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.SEMANTIC_EMBEDDINGS_ENABLED;
    delete process.env.SEMANTIC_EMBEDDING_DIMENSIONS;
    delete process.env.GEMINI_API_KEY;
  });

  test("the grid answers by words and tags, says so, and pages on", async () => {
    const { ctx, keywordQueries } = makeCtx();
    const page = await callAsOwner(searchAssetsPage)(ctx, {
      scope: "mine", ownerUserId: OWNER, query: "castle on a hill", textHint: "Dear Annete", pageSize: 30,
    });
    expect(page.by).toBe("keywords");
    expect(page.note).toBe(SEARCHING_BY_WORDS);
    expect(page.results).toHaveLength(30);
    expect(page.remaining).toHaveLength(50);
    // The world's name narrows by collection, not by words.
    expect(keywordQueries).toEqual(["castle on a hill"]);
  });

  test("what the search leaves out is still dropped by its words", async () => {
    const { ctx } = makeCtx();
    const page = await callAsOwner(searchAssetsPage)(ctx, {
      scope: "mine", ownerUserId: OWNER, query: "castle", exclude: ["cars"], pageSize: 10,
    });
    expect(page.results.map((asset) => asset._id as string)).not.toContain("assets:001");
  });

  test("an agent's search answers too, and with embeddings switched off", async () => {
    const { ctx } = makeCtx();
    expect(await callAsOwner(searchAssets)(ctx, {
      scope: "mine", ownerUserId: OWNER, query: "castle", limit: 5,
    })).toHaveLength(5);
    process.env.SEMANTIC_EMBEDDINGS_ENABLED = "false";
    expect(await callAsOwner(searchAssets)(ctx, {
      scope: "public", query: "castle", limit: 5,
    })).toHaveLength(0); // hydrated pieces are not public
  });

  test("a look-only search has no stand-in and reports the failure", async () => {
    const { ctx } = makeCtx();
    await expect(callAsOwner(searchAssets)(ctx, {
      scope: "mine", ownerUserId: OWNER, query: "castle", mode: "visual",
    })).rejects.toThrow();
  });
});
