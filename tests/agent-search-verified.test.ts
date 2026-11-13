import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getFunctionName } from "convex/server";

import { SEARCHING_BY_WORDS, searchAssetsVerified } from "../convex/semanticSearch";
import { geminiQuestions, normalizeParts, relevanceOf } from "../convex/searchVerify";
import { jevQuestions } from "../convex/searchVerifyJev";
import { RELEVANCE_MATCH_AT, relevanceTier } from "../lib/search-relevance";
import { callAsOwner } from "./helpers/call-as-owner";

const OWNER = "278674008";
const id = (index: number) => `assets:${String(index).padStart(3, "0")}`;

// 40 candidates in the pixel lane. What a decision model says about each:
// 0-9 answer the request, 10-14 show the subject with a detail doubtful, the
// rest are about something else. Piece 3 fails its second required part.
const verdict = (assetId: string) => {
  const index = Number(assetId.slice(-3));
  if (index < 10) return { whole: 0.95, parts: [0.95, index === 3 ? 0.2 : 0.9] };
  if (index < 15) return { whole: 0.6, parts: [0.9, 0.4] };
  return { whole: 0.05, parts: [0.1, 0.1] };
};

type Call = { name: string; args: Record<string, unknown> };

const makeCtx = (options: { embedFails?: boolean; keptJudgments?: Array<{ assetId: string; phrase: string; probability: number }> } = {}) => {
  const calls: Call[] = [];
  const saved: Array<{ assetId: string; phrase: string; probability: number }> = [];
  const ctx = {
    vectorSearch: async (_table: string, index: string, opts: { limit: number }) =>
      index === "by_embedding"
        ? Array.from({ length: 40 }, (_, i) => ({ _id: id(i).replace("assets:", "semanticDocuments:"), _score: 0.4 - i * 0.002 }))
          .slice(0, opts.limit)
        : [],
    runQuery: async (ref: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) => {
      const name = getFunctionName(ref);
      calls.push({ name, args });
      if (args.queryHash) return options.embedFails ? null : [0.1, 0.2, 0.3];
      if (name === "pictureJudgments:getJudgments") return options.keptJudgments ?? [];
      if (name === "assetKeywords:searchKeywordHits") {
        return [5, 20, 2].map((i, rank) => ({ assetId: id(i), score: 1 - rank * 0.1 }));
      }
      if (args.ids) {
        return (args.ids as string[]).map((docId) => ({
          _id: docId, assetId: docId.replace("semanticDocuments:", "assets:"), modality: "multimodal_image",
        }));
      }
      if (args.items) {
        return (args.items as Array<{ assetId: string; score: number }>).map((item) => ({
          _id: item.assetId, kind: "image", tagIds: [], tagNames: [], folderIds: [], createdAt: 1, ownerUserId: OWNER,
          thumbUrl: `https://img.example/${item.assetId}.webp`, ...item,
        }));
      }
      return null;
    },
    runAction: async (ref: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) => {
      const name = getFunctionName(ref);
      calls.push({ name, args });
      if (name !== "searchVerifyJev:judgeRelevance") return null;
      const pieces = args.pieces as Array<{ assetId: string }>;
      return { model: "jev-latest", judged: pieces.map((piece) => ({ assetId: piece.assetId, ...verdict(piece.assetId) })) };
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.judgments) saved.push(...(args.judgments as typeof saved));
      return null;
    },
  };
  return { ctx: ctx as never, calls, saved };
};

describe("relevance rules", () => {
  test("a piece matches when the whole request and every part hold", () => {
    expect(relevanceOf(0.95, [0.9, 0.9]).match).toBeCloseTo(0.855);
    expect(relevanceTier(0.855, 0.95)).toBe("match");
    // A required part fails: not a match, but the subject is there.
    expect(relevanceTier(relevanceOf(0.95, [0.95, 0.2]).match, 0.95)).toBe("near");
    expect(relevanceTier(relevanceOf(0.05, [0.1]).match, 0.05)).toBeUndefined();
    expect(relevanceOf(0.8, []).match).toBe(0.8);
    expect(RELEVANCE_MATCH_AT).toBe(0.7);
  });

  test("parts are trimmed, deduplicated and capped at five", () => {
    expect(normalizeParts([" a castle  ", "a castle.", "", "b", "c", "d", "e", "f"])).toEqual(["a castle", "b", "c", "d", "e"]);
  });

  test("both models get one question for the whole request and one per part, with what counts as no", () => {
    const gemini = geminiQuestions("castle on a hill", ["a castle is a main subject", "the castle stands on a hill"]);
    expect(Object.keys(gemini)).toEqual(["whole", "p0", "p1"]);
    expect(gemini.p1).toMatchObject({ type: "noul", instructions: "In this piece: the castle stands on a hill." });
    expect(JSON.stringify(gemini.whole)).toContain("small, far off or only in the background");
    const jev = jevQuestions("castle on a hill", ["a castle is a main subject"]);
    expect(Object.keys(jev)).toEqual(["whole", "p0"]);
    expect(jev.p0.criteria.false).toContain("background");
  });
});

describe("verified search for agents", () => {
  const originalFetch = global.fetch;
  let geminiStatus = 402;
  let geminiCalls = 0;
  beforeEach(() => {
    process.env.SEMANTIC_EMBEDDINGS_ENABLED = "true";
    process.env.SEMANTIC_EMBEDDING_DIMENSIONS = "3";
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.TYPESAFE_API_KEY = "test-typesafe-key";
    geminiStatus = 402;
    geminiCalls = 0;
    global.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/v1beta/decisions")) {
        geminiCalls += 1;
        return new Response(JSON.stringify({ error: { code: 402, message: "Your prepayment credits are depleted." } }), { status: geminiStatus });
      }
      // Query embedding: the embedding provider has no credit either.
      return new Response(JSON.stringify({ error: { message: "Your prepayment credits are depleted." } }), { status: 402 });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    for (const key of ["SEMANTIC_EMBEDDINGS_ENABLED", "SEMANTIC_EMBEDDING_DIMENSIONS", "GEMINI_API_KEY", "TYPESAFE_API_KEY"]) {
      delete process.env[key];
    }
  });

  const parts = ["a castle is a main subject", "the castle stands on a hill"];

  test("only pieces that answer the whole request come back, with what was checked", async () => {
    const { ctx, calls, saved } = makeCtx();
    const found = await callAsOwner(searchAssetsVerified)(ctx, {
      scope: "mine", ownerUserId: OWNER, query: "castle on a hill", mustShow: parts, limit: 24, mode: "visual",
    });
    // 0-9 match except 3, whose second part fails.
    expect(found.results.map((asset) => asset._id as string)).toEqual([0, 1, 2, 4, 5, 6, 7, 8, 9].map(id));
    expect(found.results.every((asset) => asset.tier === "match")).toBeTrue();
    expect(found.summary).toMatchObject({ mode: "verified", candidates: 40, checked: 40, matched: 9, near: 6, unchecked: 0 });
    // Gemini has no credit: one refused call, then Jev answered the wave.
    expect(geminiCalls).toBe(1);
    // The wave of 40 goes to Jev as three actions side by side.
    const jev = calls.filter((call) => call.name === "searchVerifyJev:judgeRelevance");
    expect(jev.map((call) => (call.args.pieces as unknown[]).length)).toEqual([16, 16, 8]);
    expect(jev.every((call) => JSON.stringify(call.args.parts) === JSON.stringify(parts))).toBeTrue();
    expect(saved).toHaveLength(80);
  });

  test("near pieces follow the matches when asked for", async () => {
    const { ctx } = makeCtx();
    const found = await callAsOwner(searchAssetsVerified)(ctx, {
      scope: "mine", ownerUserId: OWNER, query: "castle on a hill", mustShow: parts, limit: 24, mode: "visual", includeNear: true,
    });
    expect(found.results.map((asset) => asset.tier)).toEqual([...Array(9).fill("match"), ...Array(6).fill("near")]);
  });

  test("kept answers are not asked again", async () => {
    const first = makeCtx();
    await callAsOwner(searchAssetsVerified)(first.ctx, {
      scope: "mine", ownerUserId: OWNER, query: "castle on a hill", mustShow: parts, limit: 24, mode: "visual",
    });
    const again = makeCtx({ keptJudgments: first.saved });
    const found = await callAsOwner(searchAssetsVerified)(again.ctx, {
      scope: "mine", ownerUserId: OWNER, query: "castle on a hill", mustShow: parts, limit: 24, mode: "visual",
    });
    expect(found.summary.matched).toBe(9);
    expect(again.calls.filter((call) => call.name === "searchVerifyJev:judgeRelevance")).toHaveLength(0);
  });

  test("with search by meaning paused, keyword candidates are still checked", async () => {
    const { ctx } = makeCtx({ embedFails: true });
    const found = await callAsOwner(searchAssetsVerified)(ctx, {
      scope: "mine", ownerUserId: OWNER, query: "castle on a hill", mustShow: parts, limit: 24,
    });
    expect(found.summary.mode).toBe("keyword");
    expect(found.summary.note).toContain(SEARCHING_BY_WORDS);
    // Keyword candidates 5, 20, 2: 20 is about something else.
    expect(found.results.map((asset) => asset._id as string)).toEqual([id(5), id(2)]);
  });

  test("verify: false returns the nearest pieces unchecked", async () => {
    const { ctx, calls } = makeCtx();
    const found = await callAsOwner(searchAssetsVerified)(ctx, {
      scope: "mine", ownerUserId: OWNER, query: "castle on a hill", limit: 5, mode: "visual", verify: false,
    });
    expect(found.summary.mode).toBe("ranked");
    expect(found.results).toHaveLength(5);
    expect(calls.some((call) => call.name === "searchVerifyJev:judgeRelevance")).toBeFalse();
  });

  test("a visitor's search never asks a model", async () => {
    const { ctx, calls } = makeCtx();
    await callAsOwner(searchAssetsVerified)(ctx, {
      scope: "public", query: "castle on a hill", limit: 5, mode: "visual",
    }).catch(() => null);
    expect(calls.some((call) => call.name === "searchVerifyJev:judgeRelevance")).toBeFalse();
    expect(geminiCalls).toBe(0);
  });

  test("more than five parts are refused", async () => {
    const { ctx } = makeCtx();
    await expect(callAsOwner(searchAssetsVerified)(ctx, {
      scope: "mine", ownerUserId: OWNER, query: "x", mustShow: ["a", "b", "c", "d", "e", "f"],
    })).rejects.toThrow("at most 5");
  });
});
