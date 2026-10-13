import { describe, expect, test } from "bun:test";
import {
  auditSemanticIdentities,
  backfillSemanticIdentities,
  deleteSemanticDocumentForSource,
  getSemanticDocumentsByIds,
  getSemanticDocumentForAsset,
  listBackfillSourceBatch,
  upsertSemanticDocument,
} from "../convex/semanticIndex";
import { callAsOwner } from "./helpers/call-as-owner";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

const semanticInput = (sourceId = "assets:example") => ({
  ownerUserId: "owner", sourceType: "asset" as const, sourceId, assetId: sourceId,
  isPublic: false, kind: "image" as const, modality: "multimodal_image" as const,
  searchText: "An example with two complete vectors", contentHash: "pixels",
  textContentHash: "words", embeddingModel: "gemini-embedding-2-preview",
  embeddingDimensions: 3072, embedding: Array.from({ length: 3072 }, (_, i) => i / 3072),
  textEmbedding: Array.from({ length: 3072 }, (_, i) => (i + 1) / 3072),
  scopeKey: "owner:owner:asset", sourceUpdatedAt: 1,
});

// Record the actual query primitive used. Any whole-table materialization
// fails the test instead of allowing a mock's cheap in-memory scan to hide it.
const boundedQueries = (harness: ReturnType<typeof createMockConvexMutationCtx>) => {
  const pages: Array<{ table: string; requested: number; returned: number }> = [];
  const original = harness.db.query.bind(harness.db);
  const wrap = (table: string, query: ReturnType<typeof original>): ReturnType<typeof original> => {
    const withIndex = query.withIndex.bind(query);
    query.withIndex = (...args) => wrap(table, withIndex(...args));
    query.collect = async () => { throw new Error(`Unbounded collect on ${table}`); };
    const paginate = query.paginate.bind(query);
    query.paginate = async (args) => {
      const result = await paginate(args);
      pages.push({ table, requested: args.numItems, returned: result.page.length });
      return result;
    };
    return query;
  };
  harness.db.query = (table) => wrap(table, original(table));
  return pages;
};

describe("semantic identity read costs", () => {
  test("similarity source checks current visibility before reading stale vector metadata", async () => {
    const harness = createMockConvexMutationCtx();
    const assetId = await harness.db.insert("assets", { ownerUserId: "owner", isPublic: false, createdAt: 1 });
    const semanticId = await callAsOwner(upsertSemanticDocument)(harness.ctx, {
      ...semanticInput(assetId), isPublic: true,
    });
    let vectorQueries = 0;
    const query = harness.db.query.bind(harness.db);
    harness.db.query = (table) => {
      if (table === "semanticDocuments") vectorQueries += 1;
      return query(table);
    };
    expect(await callAsOwner(getSemanticDocumentForAsset)(harness.ctx, {
      assetId, scope: "public", ownerCandidates: [],
    })).toBeNull();
    expect(vectorQueries).toBe(0);
    expect(await callAsOwner(getSemanticDocumentForAsset)(harness.ctx, {
      assetId, scope: "mine", ownerCandidates: ["other-owner"],
    })).toBeNull();
    expect(vectorQueries).toBe(0);
    expect(await callAsOwner(getSemanticDocumentForAsset)(harness.ctx, {
      assetId, scope: "mine", ownerCandidates: ["owner"],
    })).toMatchObject({ _id: semanticId });
    await harness.db.patch(assetId, { isPublic: true });
    expect(await callAsOwner(getSemanticDocumentForAsset)(harness.ctx, {
      assetId, scope: "public", ownerCandidates: [],
    })).toMatchObject({ _id: semanticId });
    await harness.db.delete(assetId);
    expect(await callAsOwner(getSemanticDocumentForAsset)(harness.ctx, {
      assetId, scope: "public", ownerCandidates: [],
    })).toBeNull();
    expect(vectorQueries).toBe(2);
  });

  test("backfilled hits read only lightweight metadata and deduplicate repeated IDs", async () => {
    const harness = createMockConvexMutationCtx();
    const id = await callAsOwner(upsertSemanticDocument)(harness.ctx, semanticInput());
    const full = await harness.db.get(id);
    const identities = harness.db.getTableDocs("semanticDocumentIdentities");
    expect(identities).toHaveLength(1);
    const identity = identities[0]!;
    // Payload budget is a local proxy for billed bytes, not a billing claim.
    expect(JSON.stringify(identity).length / JSON.stringify(full).length).toBeLessThan(0.01);

    let identityReads = 0;
    const query = harness.db.query.bind(harness.db);
    harness.db.query = (table) => {
      if (table === "semanticDocumentIdentities") identityReads += 1;
      return query(table);
    };
    harness.db.get = async () => { throw new Error("Hit hydration must not read vectors"); };
    const result = await callAsOwner(getSemanticDocumentsByIds)(harness.ctx, { ids: [id, id, id] });
    expect(identityReads).toBe(1);
    expect(result).toEqual([{
      _id: id, _creationTime: full!._creationTime, sourceType: "asset", sourceId: "assets:example",
      assetId: "assets:example", ownerUserId: "owner", isPublic: false,
      kind: "image", modality: "multimodal_image", skillId: undefined, pillar: undefined,
    }]);
    expect(result[0]).not.toHaveProperty("embedding");
    expect(result[0]).not.toHaveProperty("textEmbedding");
  });

  test("legacy and missing hits preserve fallback behavior with one read per ID", async () => {
    const harness = createMockConvexMutationCtx();
    const id = await harness.db.insert("semanticDocuments", { ...semanticInput(), createdAt: 1, updatedAt: 1 });
    const get = harness.db.get.bind(harness.db);
    const reads: string[] = [];
    harness.db.get = async (id) => { reads.push(id); return await get(id); };
    const results = await callAsOwner(getSemanticDocumentsByIds)(harness.ctx, { ids: [id, id, "semanticDocuments:missing"] });
    expect(results).toHaveLength(1);
    expect(results[0]?._id).toBe(id);
    expect(reads).toEqual([id, "semanticDocuments:missing"]);
    expect(harness.db.getTableDocs("semanticDocumentIdentities")).toHaveLength(0);
  });

  test("updates, optional-field clears, and deletion maintain identities atomically", async () => {
    const harness = createMockConvexMutationCtx();
    const args = { ...semanticInput(), pillar: "old-pillar", skillId: "skills:old" };
    const id = await callAsOwner(upsertSemanticDocument)(harness.ctx, args);
    await callAsOwner(upsertSemanticDocument)(harness.ctx, {
      ...semanticInput(), ownerUserId: "new-owner", isPublic: true, modality: "text_only",
      clearTextEmbedding: true,
    });
    const rows = await callAsOwner(getSemanticDocumentsByIds)(harness.ctx, { ids: [id] });
    expect(rows[0]).toMatchObject({ ownerUserId: "new-owner", isPublic: true, modality: "text_only" });
    expect(rows[0]?.pillar).toBeUndefined();
    expect(rows[0]?.skillId).toBeUndefined();
    const vectors = await harness.db.get(id);
    expect(vectors?.embedding).toEqual(args.embedding);
    expect(vectors?.textEmbedding).toBeUndefined();
    expect(harness.db.getTableDocs("semanticDocumentIdentities")).toHaveLength(1);
    expect(await callAsOwner(auditSemanticIdentities)(harness.ctx, {})).toMatchObject({ missing: 0, mismatched: 0 });
    expect(await callAsOwner(deleteSemanticDocumentForSource)(harness.ctx, { sourceType: "asset", sourceId: args.sourceId })).toEqual({ deleted: true });
    expect(harness.db.getTableDocs("semanticDocumentIdentities")).toHaveLength(0);
    expect(await callAsOwner(deleteSemanticDocumentForSource)(harness.ctx, { sourceType: "asset", sourceId: args.sourceId })).toEqual({ deleted: false });
  });

  test("metadata migration is bounded, replay-safe, auditable, and leaves vectors unchanged", async () => {
    const harness = createMockConvexMutationCtx();
    for (let i = 0; i < 57; i += 1) {
      await harness.db.insert("semanticDocuments", { ...semanticInput(`assets:${i}`), createdAt: i, updatedAt: i });
    }
    const before = JSON.stringify(harness.db.getTableDocs("semanticDocuments"));
    const pages = boundedQueries(harness);
    const first = await callAsOwner(backfillSemanticIdentities)(harness.ctx, { batchSize: 25 });
    expect(first).toMatchObject({ scanned: 25, written: 25, done: false });
    const replay = await callAsOwner(backfillSemanticIdentities)(harness.ctx, { batchSize: 25 });
    expect(replay).toMatchObject({ scanned: 25, written: 0, nextCursor: first.nextCursor });
    let cursor = first.nextCursor;
    let done = false;
    while (!done) {
      const batch = await callAsOwner(backfillSemanticIdentities)(harness.ctx, { cursor, batchSize: 25 });
      cursor = batch.nextCursor;
      done = batch.done;
    }
    expect(harness.db.getTableDocs("semanticDocumentIdentities")).toHaveLength(57);
    expect(JSON.stringify(harness.db.getTableDocs("semanticDocuments"))).toBe(before);
    expect(pages.map((page) => page.returned)).toEqual([25, 25, 25, 7]);
    expect(pages.every((page) => page.requested <= 25)).toBe(true);

    const identity = harness.db.getTableDocs("semanticDocumentIdentities")[0]!;
    await harness.db.patch(identity._id, { ownerUserId: "stale-owner" });
    expect(await callAsOwner(auditSemanticIdentities)(harness.ctx, { batchSize: 25 })).toMatchObject({ scanned: 25, missing: 0, mismatched: 1 });
    expect(await callAsOwner(backfillSemanticIdentities)(harness.ctx, { batchSize: 25 })).toMatchObject({ written: 1 });
    expect(await callAsOwner(auditSemanticIdentities)(harness.ctx, { batchSize: 25 })).toMatchObject({ missing: 0, mismatched: 0 });
  });
});

describe("bounded semantic source enumeration", () => {
  for (const [sourceType, table] of [["asset", "assets"], ["prompt", "prompts"], ["designInspiration", "designInspirations"], ["skill", "skills"]] as const) {
    test(`${sourceType} visits each timestamp-tied source once without collect`, async () => {
      const harness = createMockConvexMutationCtx();
      const expected = [];
      for (let i = 0; i < 63; i += 1) expected.push(await harness.db.insert(table, { createdAt: 100 }));
      const pages = boundedQueries(harness);
      const actual: string[] = [];
      let cursor: string | undefined;
      while (true) {
        const batch = await callAsOwner(listBackfillSourceBatch)(harness.ctx, { sourceType, cursor, batchSize: 25 });
        actual.push(...batch.ids);
        if (batch.done) break;
        expect(batch.nextCursor).not.toBe(cursor);
        cursor = batch.nextCursor;
      }
      expect(actual).toEqual(expected);
      expect(pages.map((page) => page.returned)).toEqual([25, 25, 13]);
      expect(pages.reduce((sum, page) => sum + page.returned, 0)).toBe(63);
    });
  }

  test("legacy checkpoint survives empty pages and timestamp ties without lost sources", async () => {
    const harness = createMockConvexMutationCtx();
    const ids: string[] = [];
    for (let i = 0; i < 12; i += 1) ids.push(await harness.db.insert("assets", { createdAt: 100 }));
    const later = await harness.db.insert("assets", { createdAt: 101 });
    boundedQueries(harness);
    let cursor = "100::assets:8";
    const seen: string[] = [];
    let sawEmptyContinuingPage = false;
    while (true) {
      const batch = await callAsOwner(listBackfillSourceBatch)(harness.ctx, { sourceType: "asset", cursor, batchSize: 2 });
      seen.push(...batch.ids);
      if (!batch.done && batch.ids.length === 0) sawEmptyContinuingPage = true;
      if (batch.done) break;
      cursor = batch.nextCursor!;
    }
    expect(sawEmptyContinuingPage).toBe(true);
    expect(seen).toEqual([...ids.filter((id) => id.localeCompare("assets:8") > 0), later]);
  });

  test("cursor source mismatch and malformed cursors cannot silently restart", async () => {
    const harness = createMockConvexMutationCtx();
    for (let i = 0; i < 2; i += 1) await harness.db.insert("assets", { createdAt: i });
    const batch = await callAsOwner(listBackfillSourceBatch)(harness.ctx, { sourceType: "asset", batchSize: 1 });
    await expect(callAsOwner(listBackfillSourceBatch)(harness.ctx, { sourceType: "prompt", cursor: batch.nextCursor })).rejects.toThrow("Invalid semantic backfill cursor");
    await expect(callAsOwner(listBackfillSourceBatch)(harness.ctx, { sourceType: "asset", cursor: "garbage" })).rejects.toThrow("Invalid semantic backfill cursor");
    await expect(callAsOwner(listBackfillSourceBatch)(harness.ctx, { sourceType: "asset", batchSize: 1.5 })).rejects.toThrow("positive integer");
  });
});
