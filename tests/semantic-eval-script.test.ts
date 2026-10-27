import { describe, expect, test } from "bun:test";

import { DEFAULT_QUERIES, estimateBytes, overlapAt, summarizeEval, type EvalRow, type EvalTrace } from "../scripts/semantic-search-eval";

const trace = (fields: Partial<EvalTrace>): EvalTrace => ({
  rounds: 1, queryEmbeddingReads: 0, providerCalls: 0, vectorSearches: 0, vectorHits: 0, resolvedHits: 0,
  legacyDocumentReads: 0, vectorRowReads: 0, hydratedAssets: 0, hydrationCalls: 0, ...fields,
});

describe("semantic search eval report", () => {
  test("ten representative queries by default", () => {
    expect(DEFAULT_QUERIES).toHaveLength(10);
    expect(DEFAULT_QUERIES).toContain("Gothic city at dusk");
  });

  test("overlap compares the candidate's top k with the baseline's", () => {
    expect(overlapAt(["a", "b", "c", "d"], ["b", "a", "x", "y"], 4)).toBe(0.5);
    expect(overlapAt(["a", "b"], ["b", "a"], 10)).toBe(1);
    expect(overlapAt([], [], 10)).toBe(1);
  });

  test("bytes follow each plan's row sizes", () => {
    const sizes = { queryEmbeddingFull: 27_890, queryEmbeddingSplit: 7_154, identity: 329, entry: 359, hydratedAsset: 3_000, legacyDocument: 56_211, pixelVector: 7_019 };
    // Before: two full query rows, 288 identities, a 60-asset chunk.
    expect(estimateBytes(trace({ queryEmbeddingReads: 2, resolvedHits: 288, hydratedAssets: 60 }), "before", sizes))
      .toBe(2 * 27_960 + 288 * 399 + 60 * 3_000);
    // Split: two prefix query rows, the hits that cleared the cutoff, the limit.
    expect(estimateBytes(trace({ queryEmbeddingReads: 2, resolvedHits: 40, hydratedAssets: 28 }), "split", sizes))
      .toBe(2 * 7_224 + 40 * 429 + 28 * 3_000);
    expect(estimateBytes(trace({ legacyDocumentReads: 1, vectorRowReads: 1 }), "tuned", sizes)).toBe(56_211 + 7_019);
  });

  test("summary reports overlap, top-1 agreement and mean bytes per plan", () => {
    const row = (plan: EvalRow["plan"], ids: string[], hydratedAssets: number): EvalRow => ({
      query: "q", plan, trace: trace({ hydratedAssets }), results: ids.map((assetId) => ({ assetId, score: 1 })),
    });
    const summary = summarizeEval([row("before", ["a", "b", "c"], 60), row("split", ["a", "c", "d"], 6)], { hydratedAsset: 1_000 }, 3);
    expect(summary.overall.before).toMatchObject({ meanOverlapAtK: 1, top1Agreement: "1/1", meanBytes: 60_000 });
    expect(summary.overall.split).toMatchObject({ meanOverlapAtK: 0.667, top1Agreement: "1/1", meanBytes: 6_000 });
  });
});
