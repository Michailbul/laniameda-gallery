import { afterEach, describe, expect, test } from "bun:test";

import {
  SEMANTIC_VECTOR_DIMENSIONS,
  buildScopeFields,
  convexValueSize,
  legacyAssetTextHash,
  legacyPixelHash,
  legacySkillTextHash,
  pixelLaneHash,
  semanticStorageMode,
  sha256Hex,
  textLaneHash,
  toStoredVector,
} from "../convex/semanticStorage";

describe("semantic storage helpers", () => {
  afterEach(() => {
    delete process.env.SEMANTIC_STORAGE;
  });

  test("storage mode defaults to legacy and accepts only dual or split", () => {
    expect(semanticStorageMode()).toBe("legacy");
    process.env.SEMANTIC_STORAGE = " Split ";
    expect(semanticStorageMode()).toBe("split");
    process.env.SEMANTIC_STORAGE = "dual";
    expect(semanticStorageMode()).toBe("dual");
    process.env.SEMANTIC_STORAGE = "splitt";
    expect(semanticStorageMode()).toBe("legacy");
  });

  test("stored vectors are the normalized 768-value prefix", () => {
    const values = Array.from({ length: 3072 }, (_, index) => (index < SEMANTIC_VECTOR_DIMENSIONS ? 2 : 100));
    const stored = toStoredVector(values);
    expect(stored).toHaveLength(SEMANTIC_VECTOR_DIMENSIONS);
    const norm = Math.sqrt(stored.reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 12);
    // Only the prefix counts: the large tail values are dropped, not mixed in.
    expect(new Set(stored).size).toBe(1);
    expect(() => toStoredVector([1, 2, 3])).toThrow("SEMANTIC_EMBEDDING_DIMENSIONS");
    expect(() => toStoredVector(new Array(SEMANTIC_VECTOR_DIMENSIONS).fill(0))).toThrow("all-zero");
  });

  test("legacy hash helpers reproduce the semanticDocuments formulas byte for byte", async () => {
    // These literals are the inline JSON the index wrote before the split.
    expect(await legacyPixelHash({
      modality: "multimodal_image", searchText: "[image]", storageId: undefined,
      storageUrl: "https://cdn.example/a.png", isPublic: false, pillar: undefined,
    })).toBe(await sha256Hex(JSON.stringify({
      v: "pure-v1", modality: "multimodal_image", searchText: "[image]",
      storageUrl: "https://cdn.example/a.png", isPublic: false,
    })));
    expect(await legacyAssetTextHash({ model: "gemini-embedding-001", dimensions: 3072, text: "words" }))
      .toBe(await sha256Hex('{"v":"text-lane-v2","model":"gemini-embedding-001","dimensions":3072,"text":"words"}'));
    expect(await legacySkillTextHash({ model: "gemini-embedding-001", dimensions: 3072, text: "skill: x" }))
      .toBe(await sha256Hex('{"v":"skill-v1","model":"gemini-embedding-001","dimensions":3072,"text":"skill: x"}'));
  });

  test("split lane hashes change with content and model, not with visibility", async () => {
    const base = { model: "gemini-embedding-2-preview", storageUrl: "https://cdn.example/a.png" };
    expect(await pixelLaneHash(base)).toBe(await pixelLaneHash({ ...base }));
    expect(await pixelLaneHash(base)).not.toBe(await pixelLaneHash({ ...base, storageUrl: "https://cdn.example/b.png" }));
    expect(await pixelLaneHash(base)).not.toBe(await pixelLaneHash({ ...base, model: "other" }));
    expect(await textLaneHash({ model: "m", text: "a" })).not.toBe(await textLaneHash({ model: "m", text: "b" }));
  });

  test("scope keys fold owner, source type, pillar and publication", () => {
    expect(buildScopeFields("123", "asset", undefined, true)).toEqual({
      scopeKey: "owner:123:asset", scopePillarKey: undefined,
      publicScopeKey: "public:asset", publicScopePillarKey: undefined,
    });
    expect(buildScopeFields("123", "skill", "designs", true)).toEqual({
      scopeKey: "owner:123:skill", scopePillarKey: "owner:123:skill:designs",
      publicScopeKey: undefined, publicScopePillarKey: undefined,
    });
  });

  test("value sizes follow Convex's accounting", () => {
    expect(convexValueSize(null)).toBe(1);
    expect(convexValueSize(true)).toBe(1);
    expect(convexValueSize(1.5)).toBe(9);
    expect(convexValueSize("abc")).toBe(5);
    expect(convexValueSize([1, 2])).toBe(2 + 18);
    expect(convexValueSize({ a: 1, skipped: undefined })).toBe(2 + 1 + 1 + 9);
    // One 3072-float vector: the reason a legacy row is ~56 KB with two of them.
    expect(convexValueSize(new Array(3072).fill(0.1))).toBe(27_650);
    expect(convexValueSize(new Array(SEMANTIC_VECTOR_DIMENSIONS).fill(0.1))).toBe(6_914);
  });
});
