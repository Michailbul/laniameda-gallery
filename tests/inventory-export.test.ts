import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getFunctionName } from "convex/server";

import * as inventoryExport from "../convex/inventoryExport";
import { callAsOwner } from "./helpers/call-as-owner";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

const OWNER = "278674008";

const createHarness = () => {
  const harness = createMockConvexMutationCtx();
  const calls: string[] = [];
  const dispatch = async (ref: unknown, args: Record<string, unknown> = {}) => {
    let name: string;
    try {
      name = getFunctionName(ref as never);
    } catch {
      name = "component";
    }
    calls.push(name);
    const [module, exportName] = name.split(":");
    const fn = module === "inventoryExport" ? (inventoryExport as Record<string, unknown>)[exportName!] : undefined;
    // R2 component calls (object deletion) are outside this test.
    if (!fn) return null;
    return callAsOwner(fn as never)(ctx, args);
  };
  const ctx = {
    ...harness.ctx,
    auth: { getUserIdentity: async () => ({ subject: OWNER }) },
    runQuery: dispatch,
    runMutation: dispatch,
  };
  return { ctx, db: harness.db, calls };
};

const previousEnv = process.env.NODE_ENV;
let h: ReturnType<typeof createHarness>;
beforeEach(() => {
  // storeBlobToR2 returns a test key instead of uploading when R2 is unset.
  process.env.NODE_ENV = "test";
  h = createHarness();
});
afterEach(() => {
  process.env.NODE_ENV = previousEnv;
});

const addAsset = (createdAt: number, extra: Record<string, unknown> = {}) =>
  h.db.insert("assets", { ownerUserId: OWNER, kind: "image", tagIds: [], createdAt, ...extra });
const status = (args: Record<string, unknown> = {}) =>
  callAsOwner(inventoryExport.getInventoryExport)(h.ctx, { ownerUserId: OWNER, ...args });
const traversals = () => h.calls.filter((name) => name === "inventoryExport:listExportPage").length;

describe("cached inventory export", () => {
  test("builds the default inventory once, then serves the snapshot plus newer assets", async () => {
    // Ten minutes apart: wider than the 5-minute overlap newer assets are read with.
    const TEN_MINUTES = 600_000;
    for (let index = 0; index < 150; index += 1) await addAsset(index * TEN_MINUTES);
    await addAsset(150 * TEN_MINUTES, { assetRole: "skill_example" });
    await h.db.insert("folders", { ownerUserId: OWNER, name: "Dear Annete", createdAt: 1 });

    const first = await status();
    expect(first).toMatchObject({ rebuilt: true, assetCount: 150, folderCount: 1, version: 1 });
    expect(first.parts).toEqual([{ index: 0, count: 150, bytes: expect.any(Number) }]);
    // Two pages for the owner, one for its telegram: spelling.
    expect(traversals()).toBe(3);

    h.calls.length = 0;
    await addAsset(200 * TEN_MINUTES);
    const second = await status();
    expect(second.rebuilt).toBe(false);
    expect(second.generatedAt).toBe(first.generatedAt);
    expect(traversals()).toBe(0);
    // The overlap also returns the snapshot's newest asset; clients drop duplicates.
    expect(second.newerAssets.map((asset) => asset.createdAt)).toEqual([200 * TEN_MINUTES, 149 * TEN_MINUTES]);
    expect(second.newerTruncated).toBe(false);
  });

  test("too many saves since a fresh snapshot are reported, not silently dropped", async () => {
    await addAsset(1);
    await status();
    for (let index = 0; index < 201; index += 1) await addAsset(Date.now() + index);
    const result = await status();
    // The snapshot is under 15 minutes old, so it is not rebuilt yet.
    expect(result.rebuilt).toBe(false);
    expect(result.newerTruncated).toBe(true);
  });

  test("refresh rebuilds only once the snapshot is 15 minutes old; a stale age always rebuilds", async () => {
    await addAsset(1);
    const first = await status();
    expect((await status({ refresh: true })).rebuilt).toBe(false);
    const [row] = h.db.getTableDocs("inventoryExports");
    await h.db.patch(row!._id, { generatedAt: first.generatedAt - 20 * 60_000 });
    expect((await status({ refresh: true })).rebuilt).toBe(true);
    const [aged] = h.db.getTableDocs("inventoryExports");
    await h.db.patch(aged!._id, { generatedAt: Date.now() - 25 * 60 * 60_000 });
    expect((await status()).rebuilt).toBe(true);
  });

  test("a concurrent build holds the lease and a lost lease discards its parts", async () => {
    const now = Date.now();
    expect(await callAsOwner(inventoryExport.claimExportBuild)(h.ctx, { ownerUserId: OWNER, now })).toBe(true);
    expect(await callAsOwner(inventoryExport.claimExportBuild)(h.ctx, { ownerUserId: OWNER, now: now + 1 })).toBe(false);
    // No snapshot exists yet and another build holds the lease.
    await expect(status()).rejects.toThrow("being built");
    const finished = await callAsOwner(inventoryExport.finishExportBuild)(h.ctx, {
      ownerUserId: OWNER, buildStartedAt: now - 5, generatedAt: now, assetCount: 0, folderCount: 0,
      byteSize: 10, parts: [{ key: "inventory/lost.json", count: 0, bytes: 10 }],
    });
    expect(finished).toEqual({ published: false, staleKeys: ["inventory/lost.json"] });
    // An abandoned lease expires.
    expect(await callAsOwner(inventoryExport.claimExportBuild)(h.ctx, { ownerUserId: OWNER, now: now + 11 * 60_000 })).toBe(true);
  });

  test("a part of a replaced snapshot is refused", async () => {
    await addAsset(1);
    const first = await status();
    await expect(callAsOwner(inventoryExport.getInventoryExportPartUrl)(h.ctx, {
      ownerUserId: OWNER, generatedAt: first.generatedAt - 1, index: 0,
    })).rejects.toThrow("rebuilt");
  });
});
