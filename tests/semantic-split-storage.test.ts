import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  migrateSemanticVectorsToSplit,
  reindexPrompt,
  getSemanticEntriesByVectorIds,
} from "../convex/semanticIndex";
import { evaluateSearchPlans, findSimilarAssets, measureSearchRowSizes, searchAssets } from "../convex/semanticSearch";
import { SEMANTIC_VECTOR_DIMENSIONS, convexValueSize, toStoredVector } from "../convex/semanticStorage";
import { callAsOwner } from "./helpers/call-as-owner";
import { OWNER, conceptVector, createSemanticHarness, type SemanticHarness } from "./helpers/semantic-harness";

type Row = Record<string, unknown> & { _id: string };

let h: SemanticHarness;
beforeEach(() => {
  h = createSemanticHarness();
});
afterEach(() => {
  h.restore();
});

const entries = () => h.db.getTableDocs("semanticEntries") as Row[];
const legacyDocs = () => h.db.getTableDocs("semanticDocuments") as Row[];
const pixelRows = () => h.db.getTableDocs("semanticPixelVectors") as Row[];
const textRows = () => h.db.getTableDocs("semanticTextVectors") as Row[];
const writesNamed = (name: string) => h.callsNamed(`semanticIndex:${name}`).length;

const seedImage = async (keywords: string, extra: Record<string, unknown> = {}) =>
  await h.addAsset({ r2Key: `${keywords.replace(/\s+/g, "-")}.png`, agentDescription: `A ${keywords} picture.`, ...extra });

describe("dual storage", () => {
  test("writes both layouts from one embedding pass and skips unchanged rewrites", async () => {
    h.setStorage("dual");
    const assetId = await seedImage("gothic dusk");
    expect(await h.reindexAsset(assetId)).toMatchObject({ status: "indexed" });
    // One text and one pixel provider call serve both layouts.
    expect(h.providerCalls.map((call) => call.model).sort()).toEqual(["gemini-embedding-001", "gemini-embedding-2-preview"]);
    expect(legacyDocs()).toHaveLength(1);
    expect((legacyDocs()[0]!.embedding as number[]).length).toBe(3072);
    const [entry] = entries();
    expect(entry).toMatchObject({ ownerUserId: OWNER, assetId, modality: "multimodal_image", isPublic: false });
    expect(entry!.pixelHash).toBeString();
    expect(entry!.textHash).toBeString();
    const pixel = await h.db.get<Row>(entry!.pixelVectorId as string);
    expect(pixel!.embedding).toEqual(toStoredVector(legacyDocs()[0]!.embedding as number[]));
    expect(pixel).toMatchObject({ scopeKey: `owner:${OWNER}:asset` });
    expect(pixel!.publicScopeKey).toBeUndefined();

    h.reset();
    await h.reindexAsset(assetId);
    expect(h.providerCalls).toHaveLength(0);
    expect(writesNamed("upsertSemanticDocument")).toBe(0);
    expect(writesNamed("writeSemanticEntry")).toBe(0);
  });

  test("copies current legacy vectors into split storage without a provider call", async () => {
    h.setStorage("legacy");
    const assetId = await seedImage("art deco interior");
    await h.reindexAsset(assetId);
    expect(entries()).toHaveLength(0);
    const legacy = legacyDocs()[0]!;

    h.setStorage("dual");
    h.reset();
    await h.reindexAsset(assetId);
    expect(h.providerCalls).toHaveLength(0);
    expect(writesNamed("upsertSemanticDocument")).toBe(0);
    const [entry] = entries();
    expect((await h.db.get<Row>(entry!.textVectorId as string))!.embedding)
      .toEqual(toStoredVector(legacy.textEmbedding as number[]));
    expect((await h.db.get<Row>(entry!.pixelVectorId as string))!.embedding)
      .toEqual(toStoredVector(legacy.embedding as number[]));
  });
});

describe("split storage", () => {
  beforeEach(() => h.setStorage("split"));

  test("indexes into the split tables only and keeps prompts out", async () => {
    const assetId = await seedImage("neon street night");
    await h.reindexAsset(assetId);
    expect(legacyDocs()).toHaveLength(0);
    expect(h.callsNamed("semanticIndex:getExistingSemanticDocumentForSource")).toHaveLength(0);
    expect(entries()).toHaveLength(1);
    expect(pixelRows()).toHaveLength(1);
    expect(textRows()).toHaveLength(1);
    expect((pixelRows()[0]!.embedding as number[]).length).toBe(SEMANTIC_VECTOR_DIMENSIONS);

    h.reset();
    const promptId = await h.db.insert("prompts", { ownerUserId: OWNER, text: "neon", tagIds: [], createdAt: 1 });
    expect(await callAsOwner(reindexPrompt)(h.ctx, { promptId })).toMatchObject({ status: "skipped" });
    expect(h.calls).toHaveLength(0);
    expect(h.providerCalls).toHaveLength(0);
  });

  test("publishing patches vector scope keys without re-embedding", async () => {
    const assetId = await seedImage("flower shop night");
    await h.reindexAsset(assetId);
    const before = pixelRows()[0]!.embedding;
    await h.db.patch(assetId, { isPublic: true });
    h.reset();
    await h.reindexAsset(assetId);
    expect(h.providerCalls).toHaveLength(0);
    expect(entries()[0]).toMatchObject({ isPublic: true });
    for (const row of [...pixelRows(), ...textRows()]) {
      expect(row).toMatchObject({ scopeKey: `owner:${OWNER}:asset`, publicScopeKey: "public:asset" });
    }
    expect(pixelRows()[0]!.embedding).toEqual(before);
  });

  test("a text edit rewrites only the text vector; deletion removes entry and vectors", async () => {
    const assetId = await seedImage("romance close-up");
    await h.reindexAsset(assetId);
    const pixel = pixelRows()[0]!;
    await h.db.patch(assetId, { agentDescription: "A romance close-up at dusk." });
    h.reset();
    await h.reindexAsset(assetId);
    expect(h.providerCalls.map((call) => call.model)).toEqual(["gemini-embedding-001"]);
    expect(pixelRows()).toEqual([pixel]);
    expect(textRows()[0]!.embedding).toEqual(toStoredVector(conceptVector(String(h.providerCalls[0]!.text))));

    await h.db.delete(assetId);
    expect(await h.reindexAsset(assetId)).toMatchObject({ status: "deleted" });
    expect(entries()).toHaveLength(0);
    expect(pixelRows()).toHaveLength(0);
    expect(textRows()).toHaveLength(0);
  });

  test("a video is found by its words: no pixel vector and no multimodal call", async () => {
    const assetId = await h.addAsset({
      kind: "video", contentType: "video/mp4", r2Key: "cyberpunk-street.mp4", agentDescription: "Cyberpunk street chase.",
    });
    await h.reindexAsset(assetId);
    expect(h.providerCalls.map((call) => call.model)).toEqual(["gemini-embedding-001"]);
    expect(entries()[0]).toMatchObject({ modality: "text_only" });
    expect(entries()[0]!.pixelVectorId).toBeUndefined();
    expect(pixelRows()).toHaveLength(0);
  });
});

const seedGallery = async () => {
  const ids: Record<string, string> = {};
  for (const keywords of [
    "gothic city dusk", "gothic cathedral night", "art deco interior", "neon cyberpunk street",
    "flower shop night", "romance close-up",
  ]) {
    ids[keywords] = await seedImage(keywords);
    await h.reindexAsset(ids[keywords]!);
  }
  return ids;
};

describe("split search", () => {
  test("hits are cut by score before mapping and no vector row is read", async () => {
    h.setStorage("split");
    const ids = await seedGallery();
    h.reset();
    const get = h.db.get.bind(h.db);
    h.db.get = async <T,>(id: string) => {
      if (id.startsWith("semanticPixelVectors:") || id.startsWith("semanticTextVectors:")) {
        throw new Error("search must not read vectors");
      }
      return await get<T>(id);
    };
    const results = await callAsOwner(searchAssets)(h.ctx, {
      ownerUserId: OWNER, scope: "mine", query: "gothic city at dusk", limit: 3,
    });
    expect(results[0]?._id).toBe(ids["gothic city dusk"]);
    expect(h.vectorSearches).toEqual([
      { table: "semanticPixelVectors", index: "by_embedding", limit: 32 },
      { table: "semanticTextVectors", index: "by_embedding", limit: 32 },
    ]);
    // Six hits per lane come back; only those within the lane cutoff are mapped.
    const mapped = h.callsNamed("semanticIndex:getSemanticEntriesByVectorIds")[0]!.args as {
      pixelIds: string[]; textIds: string[];
    };
    expect(mapped.pixelIds.length).toBeLessThan(6);
    expect(mapped.textIds.length).toBeLessThan(6);
    // Unfiltered hydration reads about the limit, not a 60-asset chunk.
    const hydrations = h.callsNamed("galleryAssetResults:listScoredGalleryAssetsByIds");
    expect(hydrations.every((call) => (call.args.items as unknown[]).length <= 7)).toBe(true);
  });

  test("legacy and split storage rank the same gallery alike", async () => {
    h.setStorage("dual");
    await seedGallery();
    const search = () => callAsOwner(searchAssets)(h.ctx, {
      ownerUserId: OWNER, scope: "mine", query: "neon cyberpunk street at night", limit: 4,
    });
    const legacy = (await search()).map((result) => result._id);
    h.setStorage("split");
    const split = (await search()).map((result) => result._id);
    expect(split).toEqual(legacy);
  });

  test("similarity reads one lane row and excludes its source before the cutoff", async () => {
    h.setStorage("split");
    const ids = await seedGallery();
    h.reset();
    const results = await callAsOwner(findSimilarAssets)(h.ctx, {
      ownerUserId: OWNER, scope: "mine", assetId: ids["gothic city dusk"],
    });
    // The source scores 1 against itself. Left in, it would set the bar above
    // every real neighbour; excluded first, the gothic cathedral survives.
    expect(results.map((result) => result._id)).toContain(ids["gothic cathedral night"]);
    expect(results.map((result) => result._id)).not.toContain(ids["gothic city dusk"]);
    expect(h.vectorSearches.map((search) => search.table)).toEqual(["semanticPixelVectors"]);
    const source = h.callsNamed("semanticIndex:getSemanticVectorsForAsset");
    expect(source).toHaveLength(1);
    expect(h.callsNamed("semanticIndex:getSemanticDocumentForAsset")).toHaveLength(0);
  });

  test("a filtered search widens to 256 only when the first pass cannot fill it", async () => {
    h.setStorage("split");
    const rare = await h.addTag("rare");
    for (let index = 0; index < 100; index += 1) {
      await h.reindexAsset(await seedImage(`neon street ${index}`, { createdAt: index }));
    }
    const rareIds: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const id = await h.addAsset({ r2Key: `flower-${index}.png`, agentDescription: "A flower.", tagIds: [rare] });
      rareIds.push(id);
      await h.reindexAsset(id);
    }
    h.reset();
    const results = await callAsOwner(searchAssets)(h.ctx, {
      ownerUserId: OWNER, scope: "mine", query: "neon street", tagNames: ["rare"], limit: 3,
    });
    expect(results.map((result) => result._id).every((id) => rareIds.includes(id))).toBe(true);
    expect(results).toHaveLength(3);
    expect(h.vectorSearches.map((search) => search.limit)).toEqual([96, 96, 256, 256]);
    // The second pass maps and hydrates only what the first did not.
    const [first, second] = h.callsNamed("semanticIndex:getSemanticEntriesByVectorIds")
      .map((call) => call.args as { pixelIds: string[]; textIds: string[] });
    expect(second!.pixelIds.some((id) => first!.pixelIds.includes(id))).toBe(false);
    const hydrated = h.callsNamed("galleryAssetResults:listScoredGalleryAssetsByIds")
      .flatMap((call) => (call.args.items as Array<{ assetId: string }>).map((item) => item.assetId));
    expect(new Set(hydrated).size).toBe(hydrated.length);
  });

  test("hit mapping reads entries through the vector-ID index", async () => {
    h.setStorage("split");
    const assetId = await seedImage("gothic dusk");
    await h.reindexAsset(assetId);
    const [pixel] = pixelRows();
    const mapped = await callAsOwner(getSemanticEntriesByVectorIds)(h.ctx, {
      pixelIds: [pixel!._id, pixel!._id], textIds: ["semanticTextVectors:missing"],
    });
    expect(mapped).toEqual({
      pixel: [{ vectorId: pixel!._id, assetId, modality: "multimodal_image", skillId: undefined }],
      text: [],
    });
    expect(convexValueSize(entries()[0])).toBeLessThan(600);
  });
});

describe("legacy to split migration", () => {
  const migrate = (args: Record<string, unknown>) => callAsOwner(migrateSemanticVectorsToSplit)(h.ctx, args);
  const runToEnd = async (args: Record<string, unknown>) => {
    const batches = [];
    let cursor: string | undefined;
    for (;;) {
      const batch = await migrate({ ...args, cursor });
      batches.push(batch);
      if (batch.done) return batches;
      expect(batch.nextCursor).not.toBe(cursor);
      cursor = batch.nextCursor;
    }
  };

  const seedLegacy = async () => {
    h.setStorage("legacy");
    const verified = await seedImage("gothic dusk");
    const stalePixel = await seedImage("deco interior");
    const staleText = await seedImage("flower shop");
    for (const id of [verified, stalePixel, staleText]) await h.reindexAsset(id);
    const doc = (assetId: string) => legacyDocs().find((row) => row.assetId === assetId)!;
    await h.db.patch(doc(stalePixel)._id, { contentHash: "stale" });
    await h.db.patch(doc(staleText)._id, { textContentHash: "stale" });
    const skillId = await h.db.insert("skills", {
      ownerUserId: OWNER, title: "Night lighting", tagIds: [], stepCount: 0, createdAt: 1, updatedAt: 1,
    });
    await callAsOwner((await import("../convex/semanticIndex")).reindexSkill)(h.ctx, { skillId });
    const unindexed = await h.addAsset({ r2Key: "never-indexed.png" });
    return { verified, stalePixel, staleText, skillId, unindexed, doc };
  };

  test("a dry run reads no legacy rows and writes nothing", async () => {
    await seedLegacy();
    h.reset();
    const before = JSON.stringify([legacyDocs(), entries()]);
    const batches = await runToEnd({ batchSize: 2 });
    expect(batches.every((batch) => !batch.apply && batch.copied === 0 && batch.legacyBytesRead === 0)).toBe(true);
    expect(batches.reduce((sum, batch) => sum + batch.missing, 0)).toBe(5);
    expect(batches.map((batch) => batch.table)).toEqual(["assets", "assets", "skills"]);
    expect(JSON.stringify([legacyDocs(), entries()])).toBe(before);
  });

  test("apply copies verified lanes with hashes, unverified ones without, and replays as a no-op", async () => {
    const seeded = await seedLegacy();
    const batches = await runToEnd({ apply: true, batchSize: 2 });
    const totals = batches.reduce((sum, batch) => ({
      copied: sum.copied + batch.copied,
      noLegacyVectors: sum.noLegacyVectors + batch.noLegacyVectors,
      unverifiedPixel: sum.unverifiedPixel + batch.unverifiedPixel,
      unverifiedText: sum.unverifiedText + batch.unverifiedText,
    }), { copied: 0, noLegacyVectors: 0, unverifiedPixel: 0, unverifiedText: 0 });
    expect(totals).toEqual({ copied: 4, noLegacyVectors: 1, unverifiedPixel: 1, unverifiedText: 1 });
    const entryFor = (assetId: string) => entries().find((row) => row.assetId === assetId)!;
    // Plain type checks: an asymmetric matcher would be written into the
    // mock's stored row by toMatchObject.
    expect(typeof entryFor(seeded.verified).pixelHash).toBe("string");
    expect(typeof entryFor(seeded.verified).textHash).toBe("string");
    expect(entryFor(seeded.stalePixel).pixelHash).toBeUndefined();
    expect(entryFor(seeded.staleText).textHash).toBeUndefined();
    expect(entries().find((row) => row.skillId === seeded.skillId)).toMatchObject({ modality: "text_only" });
    const legacy = seeded.doc(seeded.verified);
    expect((await h.db.get<Row>(entryFor(seeded.verified).pixelVectorId as string))!.embedding)
      .toEqual(toStoredVector(legacy.embedding as number[]));

    const replay = await runToEnd({ apply: true, batchSize: 50 });
    expect(replay.reduce((sum, batch) => sum + batch.copied, 0)).toBe(0);
    expect(replay.reduce((sum, batch) => sum + batch.alreadySplit, 0)).toBe(4);

    // After the cutover a verified lane is reused; an unverified one is
    // re-embedded once.
    h.setStorage("split");
    h.reset();
    await h.reindexAsset(seeded.verified);
    expect(h.providerCalls).toHaveLength(0);
    await h.reindexAsset(seeded.stalePixel);
    expect(h.providerCalls.map((call) => call.model)).toEqual(["gemini-embedding-2-preview"]);
    await h.reindexAsset(seeded.staleText);
    expect(h.providerCalls.map((call) => call.model)).toEqual(["gemini-embedding-2-preview", "gemini-embedding-001"]);
  });

  test("rejects a malformed cursor instead of restarting", async () => {
    await expect(migrate({ cursor: "semantic-split-v1:{\"table\":\"prompts\"}" })).rejects.toThrow("Invalid semantic split migration cursor");
    await expect(migrate({ cursor: "garbage" })).rejects.toThrow("Invalid semantic split migration cursor");
  });
});

describe("search evaluation", () => {
  test("compares plans on the same queries with row counts", async () => {
    h.setStorage("dual");
    const ids = await seedGallery();
    h.reset();
    const rows = await callAsOwner(evaluateSearchPlans)(h.ctx, {
      ownerUserId: OWNER, queries: ["gothic city at dusk"], similarTo: [ids["art deco interior"]],
      plans: ["before", "tuned", "split"], limit: 3,
    });
    expect(rows.map((row) => `${row.query}|${row.plan}`)).toEqual([
      "gothic city at dusk|before", "gothic city at dusk|tuned", "gothic city at dusk|split",
      `similar:${ids["art deco interior"]}|before`, `similar:${ids["art deco interior"]}|tuned`,
      `similar:${ids["art deco interior"]}|split`,
    ]);
    expect(rows.every((row) => !row.error)).toBe(true);
    const [before, tuned, split] = rows;
    expect(before!.results[0]!.assetId).toBe(ids["gothic city dusk"]);
    expect(split!.results[0]!.assetId).toBe(ids["gothic city dusk"]);
    expect(tuned!.trace.hydratedAssets).toBeLessThanOrEqual(before!.trace.hydratedAssets);
    expect(split!.trace.resolvedHits).toBeLessThanOrEqual(tuned!.trace.resolvedHits);
    expect(rows[5]!.trace.vectorRowReads).toBe(1);
    expect(rows[3]!.trace.legacyDocumentReads).toBe(1);
    // limit 3: before asked each lane for 18, after for 32 (the floor).
    expect(h.vectorSearches.slice(0, 2).map((search) => search.limit)).toEqual([18, 18]);

    const sizes = await callAsOwner(measureSearchRowSizes)(h.ctx, { sample: 3 });
    expect(sizes.legacyDocument).toBeGreaterThan(50_000);
    expect(sizes.pixelVector).toBeLessThan(8_000);
    expect(sizes.entry).toBeLessThan(600);
  });
});
