import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getFunctionName } from "convex/server";

import { setAgentDescription, setAssetTags } from "../convex/assets";
import {
  TEXT_EDIT_FAILURE_COOLDOWN_MS,
  TEXT_EDIT_NEW_ASSET_GRACE_MS,
  textEditDefersPixel,
} from "../convex/semanticStorage";
import { callAsOwner } from "./helpers/call-as-owner";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { OWNER, createSemanticHarness, type SemanticHarness } from "./helpers/semantic-harness";

// Nov 2026: the reindexer sent the full original image to the embedder again
// after edits that left the picture alone (35k reindexes, 90 GiB of egress).
// A text or scope edit must reuse the stored pixel vector and never download
// the original; a real image change still embeds the new picture.

type Row = Record<string, unknown> & { _id: string };

let h: SemanticHarness;
let imageFetches: string[];
let harnessFetch: typeof fetch;

const OLD = 1_000; // created long ago: past the new-asset grace window

beforeEach(() => {
  h = createSemanticHarness();
  imageFetches = [];
  harnessFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://cdn.example/")) imageFetches.push(url);
    return harnessFetch(input, init);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = harnessFetch;
  h.restore();
});

const multimodalCalls = () => h.providerCalls.filter((call) => call.model !== "gemini-embedding-001");
const legacyDoc = () => (h.db.getTableDocs("semanticDocuments") as Row[])[0]!;

const indexedImage = async (fields: Record<string, unknown> = {}) => {
  const assetId = await h.addAsset({ r2Key: "gothic-dusk.png", agentDescription: "A gothic dusk street.", createdAt: OLD, ...fields });
  await h.reindexAsset(assetId);
  expect(imageFetches).toHaveLength(1);
  h.reset();
  imageFetches.length = 0;
  return assetId;
};

describe("legacy storage (the deployed default)", () => {
  beforeEach(() => h.setStorage("legacy"));

  test("publishing or re-filing reuses the pixel vector instead of downloading the image", async () => {
    const assetId = await indexedImage();
    const pixel = legacyDoc().embedding;

    await h.db.patch(assetId, { isPublic: true });
    await h.reindexAsset(assetId);
    await h.db.patch(assetId, { pillar: "creators" });
    await h.reindexAsset(assetId, { textEdit: true });

    expect(imageFetches).toHaveLength(0);
    expect(multimodalCalls()).toHaveLength(0);
    expect(legacyDoc()).toMatchObject({ isPublic: true, pillar: "creators", publicScopeKey: "public:asset" });
    expect(legacyDoc().embedding).toEqual(pixel);

    // The rewritten hash matches the new scope, so the next pass is a no-op.
    h.reset();
    await h.reindexAsset(assetId);
    expect(h.callsNamed("semanticIndex:upsertSemanticDocument")).toHaveLength(0);
    expect(imageFetches).toHaveLength(0);
  });

  test("a text-only edit re-embeds the words and never fetches the image", async () => {
    const assetId = await indexedImage();
    await h.db.patch(assetId, { agentDescription: "A gothic dusk street in the rain." });
    await h.reindexAsset(assetId, { textEdit: true });
    expect(imageFetches).toHaveLength(0);
    expect(h.providerCalls.map((call) => call.model)).toEqual(["gemini-embedding-001"]);
  });

  test("a new picture on the same asset still embeds the new pixels", async () => {
    const assetId = await indexedImage();
    await h.db.patch(assetId, { r2Key: "neon-night.png" });
    await h.reindexAsset(assetId);
    expect(imageFetches).toEqual(["https://cdn.example/neon-night.png"]);
    expect(multimodalCalls()).toHaveLength(1);
  });
});

describe("text edits on a picture whose pixel lane is missing", () => {
  beforeEach(() => h.setStorage("split"));

  test("a brand-new asset leaves the pixels to its own first index", async () => {
    const assetId = await h.addAsset({ r2Key: "flower-shop.png", agentDescription: "A flower shop.", createdAt: Date.now() });
    await h.reindexAsset(assetId, { textEdit: true });
    expect(imageFetches).toHaveLength(0);
    expect(multimodalCalls()).toHaveLength(0);
    // Words are searchable at once.
    const [entry] = h.db.getTableDocs("semanticEntries") as Row[];
    expect(entry!.textVectorId).toBeString();
    expect(entry!.pixelVectorId).toBeUndefined();

    // The asset's own (non text-edit) index embeds the picture.
    await h.reindexAsset(assetId);
    expect(imageFetches).toEqual(["https://cdn.example/flower-shop.png"]);
  });

  test("a recent pixel failure is left to its retry chain", async () => {
    const assetId = await h.addAsset({ r2Key: "romance.png", agentDescription: "A romance close-up.", createdAt: OLD });
    await h.db.insert("semantic_index_failures", {
      ownerUserId: OWNER, sourceType: "asset", sourceId: assetId, status: "pending", attemptCount: 1,
      lastErrorMessage: "pixel lane: 429", firstErrorAt: Date.now(), lastErrorAt: Date.now(), updatedAt: Date.now(),
    });
    await h.reindexAsset(assetId, { textEdit: true });
    expect(imageFetches).toHaveLength(0);
    // The failure stays open, so the retry still owns the pixel lane.
    expect((h.db.getTableDocs("semantic_index_failures") as Row[])[0]).toMatchObject({ status: "pending" });
  });

  test("an old asset that never got its pixels is healed by the next edit", async () => {
    const assetId = await h.addAsset({ r2Key: "art-deco.png", agentDescription: "An art deco interior.", createdAt: OLD });
    await h.reindexAsset(assetId, { textEdit: true });
    expect(imageFetches).toEqual(["https://cdn.example/art-deco.png"]);
    expect(multimodalCalls()).toHaveLength(1);
  });
});

describe("textEditDefersPixel", () => {
  const now = 10 * 24 * 60 * 60_000;
  test("defers inside the new-asset grace window and during a recent failure", () => {
    expect(textEditDefersPixel({ now, assetCreatedAt: now - 1_000 })).toBe(true);
    expect(textEditDefersPixel({ now, assetCreatedAt: now - TEXT_EDIT_NEW_ASSET_GRACE_MS - 1 })).toBe(false);
    expect(textEditDefersPixel({ now, assetCreatedAt: 0, failure: { status: "pending", updatedAt: now - 60_000 } })).toBe(true);
    expect(textEditDefersPixel({
      now, assetCreatedAt: 0, failure: { status: "pending", updatedAt: now - TEXT_EDIT_FAILURE_COOLDOWN_MS - 1 },
    })).toBe(false);
    expect(textEditDefersPixel({ now, assetCreatedAt: 0, failure: { status: "resolved", updatedAt: now } })).toBe(false);
  });
});

describe("text-only mutations mark their reindex as a text edit", () => {
  const scheduledReindexes = () => {
    const harness = createMockConvexMutationCtx();
    const scheduled: Array<{ name: string; args: Record<string, unknown> }> = [];
    const ctx = {
      ...harness.ctx,
      scheduler: {
        runAfter: async (_delay: number, ref: unknown, args: Record<string, unknown>) => {
          scheduled.push({ name: getFunctionName(ref as never), args });
          return null;
        },
      },
    };
    return { harness, ctx, reindexes: () => scheduled.filter((call) => call.name === "semanticIndex:reindexAsset") };
  };

  test("tags and descriptions", async () => {
    const { harness, ctx, reindexes } = scheduledReindexes();
    const assetId = await harness.db.insert("assets", {
      ownerUserId: OWNER, kind: "image", contentType: "image/png", tagIds: [], isPublic: false, createdAt: OLD,
    });
    await callAsOwner(setAssetTags)(ctx, { ownerUserId: OWNER, assetId, tagNames: ["gothic"] });
    await callAsOwner(setAgentDescription)(ctx, { ownerUserId: OWNER, assetId, agentDescription: "A gothic arch." });
    expect(reindexes()).toHaveLength(2);
    for (const call of reindexes()) expect(call.args).toMatchObject({ assetId, textEdit: true });
  });
});
