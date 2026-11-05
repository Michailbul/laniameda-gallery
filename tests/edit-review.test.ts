import { describe, expect, test } from "bun:test";
import { approveEdit, discardEdit, finishJob, listAssetEdits, restoreAssetVersion } from "../convex/editJobs";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { callAsOwner } from "./helpers/call-as-owner";

// A landed in-place edit is a pending take on its job, never an asset; approve
// puts its picture on the same asset and keeps every earlier picture a version.

const internal = <A, R>(fn: unknown) => (ctx: unknown, args: A) =>
  (fn as { _handler: (ctx: unknown, args: A) => Promise<R> })._handler(ctx, args);

async function setup() {
  const { ctx, db } = createMockConvexMutationCtx();
  const scheduled: string[] = [];
  const context = { ...ctx, scheduler: { runAfter: async (_d: number, ref: unknown) => { scheduled.push(String((ref as { _name?: string })?._name ?? "fn")); return null; } } };
  const assetId = await db.insert("assets", {
    ownerUserId: "owner", kind: "image", tagIds: [], r2Key: "orig.png", thumbR2Key: "orig-thumb.webp",
    width: 1000, height: 1500, contentHash: "h-orig", createdAt: 1,
  });
  const job = async (n: number) => {
    const jobId = await db.insert("editJobs", {
      ownerUserId: "owner", sourceAssetId: assetId, folderIds: [], prompt: `edit ${n}`, model: "ideogram-precise",
      modelName: "Ideogram 4.5 precise", provider: "fal", endpoint: "ideogram/v4.5/edit", attempts: [], retries: 0,
      status: "running", estimateUsd: 0.06, batch: "b", take: 1, of: 1, refAssetIds: [], refNames: [], refsDropped: 0,
      createdBy: "owner", pollCount: 0, createdAt: n, updatedAt: n,
    });
    await internal(finishJob)(context, {
      jobId, resultUrl: `https://fal.test/${n}.png`, chargedUsd: 0.06, chargedExact: false,
      take: { r2Key: `take${n}.png`, thumbR2Key: `take${n}-thumb.webp`, contentType: "image/png", width: 1024, height: 1536, contentHash: `h${n}` },
    });
    return jobId;
  };
  return { context, db, assetId, job, scheduled };
}

describe("edit takes", () => {
  test("a landed take is pending on its job and creates no asset", async () => {
    const { db, assetId, job } = await setup();
    const jobId = await job(2);
    const row = await db.get(jobId) as { status: string; review: string; resultAssetId?: string; takeMedia: { r2Key: string } };
    expect(row.status).toBe("done");
    expect(row.review).toBe("pending");
    expect(row.resultAssetId).toBeUndefined();
    expect(row.takeMedia.r2Key).toBe("take2.png");
    const assets = await db.query("assets").collect();
    expect(assets.map((asset) => asset._id)).toEqual([assetId]);
  });

  test("approve replaces the picture on the same asset; versions keep the original; restore brings it back", async () => {
    const { context, db, assetId, job, scheduled } = await setup();
    const first = await job(2);
    const second = await job(3);
    const approve = callAsOwner(approveEdit);
    expect(await approve(context, { ownerUserId: "owner", jobId: first })).toEqual({ jobId: first, assetId, version: 2 });
    let asset = await db.get(assetId) as { r2Key?: string; thumbR2Key?: string; width?: number; contentHash?: string };
    expect([asset.r2Key, asset.thumbR2Key, asset.width, asset.contentHash]).toEqual(["take2.png", "take2-thumb.webp", 1024, "h2"]);
    expect(scheduled.length).toBeGreaterThanOrEqual(2); // reindex + rehash

    expect((await approve(context, { ownerUserId: "owner", jobId: second })).version).toBe(3);
    // Approving again is a no-op that answers the same version.
    expect((await approve(context, { ownerUserId: "owner", jobId: second })).version).toBe(3);
    const versions = (await db.query("assetVersions").collect()) as { number: number; origin: string; r2Key?: string }[];
    expect(versions.map((row) => [row.number, row.origin, row.r2Key])).toEqual([
      [1, "original", "orig.png"], [2, "edit", "take2.png"], [3, "edit", "take3.png"],
    ]);
    asset = await db.get(assetId) as typeof asset;
    expect(asset.r2Key).toBe("take3.png");

    const original = (await db.query("assetVersions").collect())[0] as { _id: string };
    expect(await callAsOwner(restoreAssetVersion)(context, { ownerUserId: "owner", versionId: original._id })).toEqual({ assetId, version: 1 });
    asset = await db.get(assetId) as typeof asset;
    expect([asset.r2Key, asset.contentHash]).toEqual(["orig.png", "h-orig"]);
    expect(await db.query("assetVersions").collect()).toHaveLength(3);
  });

  test("discard archives a take, reopen brings it back, an approved take cannot be discarded", async () => {
    const { context, db, assetId, job } = await setup();
    const jobId = await job(2);
    const discard = callAsOwner(discardEdit);
    expect(await discard(context, { ownerUserId: "owner", jobId })).toEqual({ jobId, review: "discarded" });
    expect(((await db.get(jobId)) as { takeMedia?: unknown }).takeMedia).toBeDefined();
    expect(((await db.get(assetId)) as { r2Key: string }).r2Key).toBe("orig.png");
    expect(await discard(context, { ownerUserId: "owner", jobId, reopen: true })).toEqual({ jobId, review: "pending" });
    await callAsOwner(approveEdit)(context, { ownerUserId: "owner", jobId });
    await expect(discard(context, { ownerUserId: "owner", jobId })).rejects.toThrow();
  });

  test("another owner cannot approve", async () => {
    const { context, job } = await setup();
    const jobId = await job(2);
    await expect(callAsOwner(approveEdit)(context, { ownerUserId: "someone-else", jobId })).rejects.toThrow();
  });

  test("the panel's read lists the take as pending and the versions with the current one marked", async () => {
    const { context, assetId, job } = await setup();
    const jobId = await job(2);
    const before = await callAsOwner(listAssetEdits)(context, { ownerUserId: "owner", assetId });
    expect(before.versions).toEqual([]);
    expect(before.jobs.map((row: { review?: string; resultAssetId?: string }) => [row.review, row.resultAssetId])).toEqual([["pending", undefined]]);
    await callAsOwner(approveEdit)(context, { ownerUserId: "owner", jobId });
    const after = await callAsOwner(listAssetEdits)(context, { ownerUserId: "owner", assetId });
    expect(after.versions.map((row: { number: number; current: boolean }) => [row.number, row.current])).toEqual([[1, false], [2, true]]);
  });
});
