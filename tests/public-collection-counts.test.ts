import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Id } from "../convex/_generated/dataModel";
import {
  addAssetFolders, bulkDeleteAssets, bulkSetAssetCuration, bulkSetFolderCuration,
  createAsset, internalDeleteAsset, listPublicCollections, removeAssetFolder,
  setAssetCuration, setAssetFolder, setAssetFolders, setAssetStarred,
} from "../convex/assets";
import { createFolder, deleteFolder, listFolders, updateFolder } from "../convex/folders";
import { flattenSectionCollections } from "../convex/collectionCleanup";
import { backfill, status, syncPublicCollectionMembership } from "../convex/publicCollectionCounts";
import { callAsOwner } from "./helpers/call-as-owner";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

describe("public collection counters", () => {
  let h: ReturnType<typeof createMockConvexMutationCtx>;
  const previousSecret = process.env.CURATION_ADMIN_SECRET;
  const previousCurators = process.env.CURATION_ADMIN_USER_IDS;
  const ownerUserId = "owner";
  const admin = { actorUserId: ownerUserId, adminSecret: "test-secret" };

  beforeEach(() => {
    h = createMockConvexMutationCtx();
    process.env.CURATION_ADMIN_SECRET = admin.adminSecret;
    process.env.CURATION_ADMIN_USER_IDS = ownerUserId;
  });
  afterEach(() => {
    process.env.CURATION_ADMIN_SECRET = previousSecret;
    process.env.CURATION_ADMIN_USER_IDS = previousCurators;
  });

  const folder = async (name: string, extra: Record<string, unknown> = {}) =>
    (await callAsOwner(createFolder)(h.ctx, { ownerUserId, name, ...extra })).folderId;
  const asset = async (folderId?: string, extra: Record<string, unknown> = {}) =>
    await h.db.insert("assets", { ownerUserId, kind: "image", tagIds: [], folderId, isPublic: true, createdAt: 1, ...extra }) as Id<"assets">;
  const link = async (assetId: string, folderId: string) =>
    await h.db.insert("assetFolders", { ownerUserId, assetId, folderId, createdAt: 1 });
  const publicRows = async () => await callAsOwner(listPublicCollections)(h.ctx, {});
  const publish = async (assetId: string, isPublic: boolean) =>
    await callAsOwner(setAssetCuration)(h.ctx, { ...admin, assetId, isPublic });
  const finishBackfill = async () => {
    let result;
    do { result = await callAsOwner(backfill)(h.ctx, { batchSize: 2 }); } while (!result.complete);
    return result;
  };

  test("legacy fallback and ready counters agree, including duplicate joins, primary-only membership and public scope", async () => {
    const a = await folder("Alpha");
    const b = await folder("Beta");
    const empty = await folder("Empty");
    const story = await folder("Story", { kind: "storybook" });
    const other = await folder("Other owner", { ownerUserId: "other" });
    const first = await asset(a);
    await link(first, a);
    await link(first, a);
    await link(first, b);
    await asset(b, { isPublic: false });
    await asset(b, { isPublic: undefined });
    await asset(a, { createdAt: -1 });
    await asset(story);
    await asset(other, { ownerUserId: "other" });
    const expected = [
      { folderId: a, label: "Alpha", count: 1 },
      { folderId: b, label: "Beta", count: 1 },
      { folderId: other, label: "Other owner", count: 1 },
    ];
    expect(await publicRows()).toEqual(expected);
    await callAsOwner(backfill)(h.ctx, { batchSize: 1 });
    expect(await publicRows()).toEqual(expected);
    const partial = await callAsOwner(listFolders)(h.ctx, { ownerUserId });
    expect(partial.every((row) => row.publicMemberCount === undefined)).toBe(true);
    await finishBackfill();
    expect(await publicRows()).toEqual(expected);
    const owned = await callAsOwner(listFolders)(h.ctx, { ownerUserId });
    expect(owned.some((row) => row._id === other)).toBe(false);
    expect(owned.find((row) => row._id === empty)?.publicMemberCount).toBe(0);
    expect(owned.find((row) => row._id === a)?.publicMemberCount).toBe(1);
  });

  test("ready reads and repeated completed backfill never query asset or join tables", async () => {
    const a = await folder("A");
    await asset(a);
    const completed = await finishBackfill();
    const original = h.db.query.bind(h.db);
    h.db.query = (table: string) => {
      if (table === "assets" || table === "assetFolders") throw new Error(`Unexpected expensive read: ${table}`);
      return original(table);
    };
    expect(await publicRows()).toEqual([{ folderId: a, label: "A", count: 1 }]);
    expect(await callAsOwner(backfill)(h.ctx, { batchSize: 1 })).toEqual(completed);
    expect((await callAsOwner(listFolders)(h.ctx, { ownerUserId }))[0]?.publicMemberCount).toBe(1);
  });

  test("publication, edits and deletes between pages reconcile without double counting", async () => {
    const a = await folder("A");
    const b = await folder("B");
    const first = await asset(a, { createdAt: 1 });
    const second = await asset(a, { isPublic: false, createdAt: 2 });
    const third = await asset(a, { createdAt: 3 });
    const fourth = await asset(a, { createdAt: 4 });
    await callAsOwner(backfill)(h.ctx, { batchSize: 1 });
    await publish(first, false);
    await publish(second, true);
    await publish(second, true);
    await callAsOwner(setAssetFolders)(h.ctx, { ownerUserId, assetId: third, folderIds: [b, b] });
    await callAsOwner(internalDeleteAsset)(h.ctx, { id: fourth });
    const before = await publicRows();
    await finishBackfill();
    expect(await publicRows()).toEqual(before);
    expect(before).toEqual([
      { folderId: a, label: "A", count: 1 }, { folderId: b, label: "B", count: 1 },
    ]);
    const snapshots = h.db.getTableDocs("publicCollectionMemberships");
    expect(snapshots.length).toBe(2);
    await syncPublicCollectionMembership(h.ctx as never, third);
    expect(await publicRows()).toEqual(before);
  });

  test("creation, curator star, repeated save and every owner membership edit stay exact", async () => {
    const a = await folder("A");
    const b = await folder("B");
    const c = await folder("C");
    await finishBackfill();
    const created = await callAsOwner(createAsset)(h.ctx, { ownerUserId, kind: "image", tagIds: [], folderId: a, ingestKey: "same" });
    expect(await publicRows()).toEqual([]);
    await callAsOwner(setAssetStarred)(h.ctx, { ownerUserId, assetId: created.assetId, starred: true });
    await callAsOwner(createAsset)(h.ctx, { ownerUserId, kind: "image", tagIds: [], folderId: b, ingestKey: "same" });
    await callAsOwner(createAsset)(h.ctx, { ownerUserId, kind: "image", tagIds: [], folderId: b, ingestKey: "same" });
    expect((await publicRows()).map((r) => r.count)).toEqual([1, 1]);
    await callAsOwner(setAssetFolder)(h.ctx, { ownerUserId, assetId: created.assetId, folderId: c });
    expect((await publicRows()).map((r) => r.label)).toEqual(["B", "C"]);
    await callAsOwner(addAssetFolders)(h.ctx, { ownerUserId, assetId: created.assetId, folderIds: [a, a] });
    await callAsOwner(removeAssetFolder)(h.ctx, { ownerUserId, assetId: created.assetId, folderId: c });
    await callAsOwner(removeAssetFolder)(h.ctx, { ownerUserId, assetId: created.assetId, folderId: c });
    expect((await publicRows()).map((r) => r.label)).toEqual(["A", "B"]);
    await callAsOwner(setAssetFolders)(h.ctx, { ownerUserId, assetId: created.assetId, folderIds: [a] });
    expect(await publicRows()).toEqual([{ folderId: a, label: "A", count: 1 }]);
    await publish(created.assetId, false);
    expect(await publicRows()).toEqual([]);
    expect(h.db.getTableDocs("publicCollectionMemberships")).toEqual([]);
  });

  test("bulk curation, folder curation and bulk deletion update the last public member", async () => {
    const a = await folder("A");
    const first = await asset(a, { isPublic: false });
    const second = await asset(a, { isPublic: false });
    await link(first, a);
    await link(second, a);
    await finishBackfill();
    await callAsOwner(bulkSetAssetCuration)(h.ctx, { ...admin, assetIds: [first, second, first], isPublic: true });
    expect((await publicRows())[0]?.count).toBe(2);
    await callAsOwner(bulkSetFolderCuration)(h.ctx, { ...admin, folderId: a, isPublic: false });
    expect(await publicRows()).toEqual([]);
    await callAsOwner(bulkSetFolderCuration)(h.ctx, { ...admin, folderId: a, isPublic: true });
    expect((await publicRows())[0]?.count).toBe(2);
    await callAsOwner(bulkDeleteAssets)(h.ctx, { ids: [first, second, first] });
    expect(await publicRows()).toEqual([]);
    expect(h.db.getTableDocs("publicCollectionMemberships")).toEqual([]);
  });

  test("collection flattening/deletion and rename preserve counters for surviving folders", async () => {
    const root = await folder("World");
    const child = await folder("Characters", { parentFolderId: root });
    const kept = await folder("Kept");
    const member = await asset(child);
    await link(member, child);
    await link(member, kept);
    await finishBackfill();
    await callAsOwner(flattenSectionCollections)(h.ctx, { ownerUserId, dryRun: false });
    expect((await publicRows()).map((r) => [r.label, r.count])).toEqual([["Kept", 1], ["World", 1]]);
    await callAsOwner(updateFolder)(h.ctx, { ownerUserId, folderId: root, name: "Renamed" });
    expect((await publicRows()).map((r) => r.label)).toEqual(["Kept", "Renamed"]);
    await callAsOwner(deleteFolder)(h.ctx, { ownerUserId, folderId: root });
    expect(await publicRows()).toEqual([{ folderId: kept, label: "Kept", count: 1 }]);
    await publish(member, false);
    expect(await publicRows()).toEqual([]);
  });

  test("invalid batches and unauthorized edits do not start backfill or alter counts", async () => {
    const a = await folder("A");
    const member = await asset(a);
    for (const batchSize of [0, 101, 1.5]) {
      await expect(callAsOwner(backfill)(h.ctx, { batchSize })).rejects.toThrow("batchSize");
    }
    expect(await callAsOwner(status)(h.ctx, {})).toEqual({ complete: false, cursor: null, scanned: 0 });
    await finishBackfill();
    await expect(callAsOwner(setAssetFolders)(h.ctx, { ownerUserId: "other", assetId: member, folderIds: [] })).rejects.toThrow();
    await expect(callAsOwner(setAssetCuration)(h.ctx, { ...admin, adminSecret: "wrong", assetId: member, isPublic: false })).rejects.toThrow();
    expect(await publicRows()).toEqual([{ folderId: a, label: "A", count: 1 }]);
  });

  test("flattening a legacy primary-only public member counts its new parent after backfill", async () => {
    const root = await folder("World");
    const child = await folder("Characters", { parentFolderId: root });
    const member = await asset(child);
    // Deliberately no assetFolders row for the child: the legacy primary
    // pointer is the only evidence of membership before flattening.
    await finishBackfill();
    expect(await publicRows()).toEqual([{ folderId: child, label: "Characters", count: 1 }]);
    await callAsOwner(flattenSectionCollections)(h.ctx, { ownerUserId, dryRun: true });
    expect(await publicRows()).toEqual([{ folderId: child, label: "Characters", count: 1 }]);
    expect(h.db.getTableDocs("assetFolders")).toEqual([]);

    await callAsOwner(flattenSectionCollections)(h.ctx, { ownerUserId, dryRun: false });
    expect(await h.db.get(child)).toBeNull();
    expect(await publicRows()).toEqual([{ folderId: root, label: "World", count: 1 }]);
    expect(h.db.getTableDocs("publicCollectionMemberships").map((row) => row.folderIds)).toEqual([[root]]);
    await callAsOwner(flattenSectionCollections)(h.ctx, { ownerUserId, dryRun: false });
    expect(await publicRows()).toEqual([{ folderId: root, label: "World", count: 1 }]);
    await publish(member, false);
    expect(await publicRows()).toEqual([]);
  });
});
