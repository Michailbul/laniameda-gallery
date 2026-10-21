import { describe, expect, test } from "bun:test";
import {
  clusterByHash, dHashFromGray, hammingDistance, isDHash, similarityToDistance,
} from "../lib/perceptual-hash";
import { findSimilarGroups, listAssetHashes, setAssetHash } from "../convex/assetHashes";
import { stackAssets, unstackAssets } from "../convex/stacks";
import { internalDeleteAsset } from "../convex/assets";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { callAsOwner } from "./helpers/call-as-owner";

const OWNER = "owner";
type AnyDoc = Record<string, unknown> & { _id: string };

// 64-bit hashes that differ from BASE by n bits.
const BASE = "f0f0f0f0f0f0f0f0";
const flip = (hash: string, bits: number) => {
  const value = BigInt(`0x${hash}`) ^ ((1n << BigInt(bits)) - 1n);
  return value.toString(16).padStart(16, "0");
};

describe("perceptual hash", () => {
  test("dHash reads left-brighter-than-right per row and round-trips as hex", () => {
    const falling = Array.from({ length: 72 }, (_, index) => 255 - (index % 9) * 20);
    const rising = Array.from({ length: 72 }, (_, index) => (index % 9) * 20);
    expect(dHashFromGray(falling)).toBe("ffffffffffffffff");
    expect(dHashFromGray(rising)).toBe("0000000000000000");
    expect(isDHash(dHashFromGray(falling))).toBe(true);
    expect(() => dHashFromGray([1, 2, 3])).toThrow("72 grey values");
  });

  test("hamming distance counts differing bits", () => {
    expect(hammingDistance(BASE, BASE)).toBe(0);
    expect(hammingDistance(BASE, flip(BASE, 5))).toBe(5);
    expect(hammingDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
  });

  test("clusters keep input order, come largest first and skip unhashed items", () => {
    const items = [
      { id: "a", hash: BASE }, { id: "x", hash: "0123456789abcdef" }, { id: "b", hash: flip(BASE, 3) },
      { id: "c", hash: flip(BASE, 5) }, { id: "y", hash: "fedcba9876543210" }, { id: "z", hash: flip("fedcba9876543210", 2) },
      { id: "none", hash: "" },
    ];
    const tight = clusterByHash(items, 4);
    expect(tight.map((cluster) => cluster.ids)).toEqual([["a", "b", "c"], ["y", "z"]]);
    expect(tight[0]!.maxDistance).toBe(3);
    expect(clusterByHash(items, 1)).toEqual([]);
    expect(similarityToDistance(0)).toBe(3);
    expect(similarityToDistance(1)).toBe(20);
  });
});

const setup = async () => {
  const { db, ctx } = createMockConvexMutationCtx({ indexOrder: { "assetFolders.by_folder_createdAt": ["folderId", "createdAt"] } });
  const world = await db.insert("folders", { ownerUserId: OWNER, name: "WORLD", normalizedName: "world" });
  const shelf = await db.insert("folders", { ownerUserId: OWNER, name: "Places", normalizedName: "x/places", parentFolderId: world });
  const asset = async (folderId: string, hash?: string) => {
    const id = await db.insert("assets", { ownerUserId: OWNER, kind: "image", tagIds: [], createdAt: Date.now(), width: 1600, height: 900 });
    await db.insert("assetFolders", { ownerUserId: OWNER, assetId: id, folderId, createdAt: Date.now() });
    if (hash) await db.insert("assetHashes", { ownerUserId: OWNER, assetId: id, dHash: hash, createdAt: 1 });
    return id;
  };
  const call = <F extends Parameters<typeof callAsOwner>[0]>(fn: F, args: Record<string, unknown>) =>
    callAsOwner(fn)(ctx, { ownerUserId: OWNER, ...args });
  return { db, ctx, world, shelf, asset, call };
};

describe("hashes and stacks backend", () => {
  test("a hash is stored once per asset and updated in place", async () => {
    const env = await setup();
    const a1 = await env.asset(env.world);
    const set = (setAssetHash as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<boolean> })._handler;
    expect(await set(env.ctx, { assetId: a1, dHash: BASE })).toBe(true);
    expect(await set(env.ctx, { assetId: a1, dHash: flip(BASE, 1) })).toBe(true);
    await expect(set(env.ctx, { assetId: a1, dHash: "nope" })).rejects.toThrow("16 hex");
    expect(env.db.getTableDocs("assetHashes")).toHaveLength(1);
    expect(await env.call(listAssetHashes, {})).toEqual([{ a: a1, h: flip(BASE, 1) }]);
  });

  test("similar groups scan a world with its shelves, largest first", async () => {
    const env = await setup();
    const takes = [await env.asset(env.world, BASE), await env.asset(env.shelf, flip(BASE, 2)), await env.asset(env.shelf, flip(BASE, 4))];
    const pair = [await env.asset(env.world, "0123456789abcdef"), await env.asset(env.world, flip("0123456789abcdef", 1))];
    await env.asset(env.world, "fedcba9876543210");
    await env.asset(env.world);
    const onlyRoot = await env.call(findSimilarGroups, { folderId: env.world });
    expect(onlyRoot.groups.map((group: { assets: AnyDoc[] }) => group.assets.length)).toEqual([2]);
    const whole = await env.call(findSimilarGroups, { folderId: env.world, includeChildren: true, maxDistance: 4 });
    expect(whole).toMatchObject({ scanned: 7, hashed: 6, truncated: false });
    expect(whole.groups.map((group: { assets: { assetId: string }[] }) => group.assets.map((asset) => asset.assetId).sort()))
      .toEqual([[...takes].sort(), [...pair].sort()]);
    expect((await env.call(findSimilarGroups, { folderId: env.world, includeChildren: true, maxDistance: 4, minSize: 3 })).groups).toHaveLength(1);
    await expect(callAsOwner(findSimilarGroups)(env.ctx, { ownerUserId: "stranger", folderId: env.world })).rejects.toThrow("Collection not found");
  });

  test("stacking a cluster puts the cover first; undo takes the stack apart", async () => {
    const env = await setup();
    const [a, b, c] = [await env.asset(env.world), await env.asset(env.world), await env.asset(env.world)];
    await expect(env.call(stackAssets, { assetIds: [a] })).rejects.toThrow("at least two");
    const record = await env.call(stackAssets, { assetIds: [c, a, b] });
    const pack = (await env.db.get(record.packId)) as AnyDoc;
    expect(pack).toMatchObject({ kind: "stack", coverAssetId: c, itemCount: 3 });
    expect([(await env.db.get(c)) as AnyDoc, (await env.db.get(a)) as AnyDoc].map((asset) => asset.packSlotIndex)).toEqual([0, 1]);
    await expect(callAsOwner(unstackAssets)(env.ctx, { ownerUserId: "stranger", record })).rejects.toThrow("Stack not found");
    expect(await env.call(unstackAssets, { record })).toEqual({ unstacked: true });
    expect(await env.db.get(record.packId)).toBeNull();
    expect(((await env.db.get(a)) as AnyDoc).assetPackId).toBeUndefined();
    expect(await env.call(unstackAssets, { record })).toEqual({ unstacked: false });
  });

  test("deleting an asset removes its hash", async () => {
    const env = await setup();
    const a1 = await env.asset(env.world, BASE);
    await callAsOwner(internalDeleteAsset)(env.ctx, { id: a1 });
    expect(env.db.getTableDocs("assetHashes")).toHaveLength(0);
  });
});
