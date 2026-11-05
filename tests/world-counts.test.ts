import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fileWorldAssets, listWorldChanges, markWorld, moveToWorld, undoWorldChanges } from "../convex/worlds";
import { recountWorldCounts } from "../convex/worldCounts";
import { setAssetFolders } from "../convex/assets";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { callAsOwner } from "./helpers/call-as-owner";

const realNow = Date.now;
let clock = 1_800_000_000_000;
beforeEach(() => { Date.now = () => (clock += 1000); });
afterEach(() => { Date.now = realNow; });

const owner = "owner";
const indexOrder = {
  "worldChanges.by_owner_world_createdAt": ["ownerUserId", "worldFolderId", "createdAt"],
  "worldChanges.by_owner_session_createdAt": ["ownerUserId", "session", "createdAt"],
  "worldChanges.by_owner_target_createdAt": ["ownerUserId", "targetId", "createdAt"],
  "assetFolders.by_folder_createdAt": ["folderId", "createdAt"],
};

// Two worlds whose counts start exact; pieces are filed through the normal
// collection editor so every count comes from the write paths under test.
const setup = async () => {
  const { db, ctx } = createMockConvexMutationCtx({ indexOrder });
  await db.insert("publicCollectionCountBackfill", { key: "v1", complete: true, cursor: null, scanned: 0 });
  const dear = await db.insert("folders", { ownerUserId: owner, name: "DEAR ANNETE", normalizedName: "dear annete", memberCount: 0, publicMemberCount: 0 });
  const three = await db.insert("folders", { ownerUserId: owner, name: "DEAR ANNETE — 3D", normalizedName: "dear annete — 3d", memberCount: 0, publicMemberCount: 0 });
  const liz = await db.insert("folders", { ownerUserId: owner, name: "Liz", parentFolderId: dear, group: "Cast", memberCount: 0, publicMemberCount: 0 });
  const wardrobe = await db.insert("folders", { ownerUserId: owner, name: "Wardrobe", parentFolderId: dear, memberCount: 0, publicMemberCount: 0 });
  const liz3d = await db.insert("folders", { ownerUserId: owner, name: "Liz 3D", parentFolderId: three, group: "Cast", memberCount: 0, publicMemberCount: 0 });
  await callAsOwner(markWorld)(ctx, { ownerUserId: owner, folderId: dear, worldKey: "dear-annete" });
  await callAsOwner(markWorld)(ctx, { ownerUserId: owner, folderId: three, worldKey: "dear-annete-3d" });
  const piece = async (folderIds: string[], isPublic = false) => {
    const id = await db.insert("assets", { ownerUserId: owner, kind: "image", tagIds: [], createdAt: Date.now(), isPublic });
    await callAsOwner(setAssetFolders)(ctx, { ownerUserId: owner, assetId: id, folderIds });
    return id;
  };
  const counts = async (folderId: string) => {
    const folder = await db.get(folderId);
    return [folder?.memberCount ?? 0, folder?.publicMemberCount ?? 0];
  };
  return { db, ctx, dear, three, liz, wardrobe, liz3d, piece, counts };
};

describe("collection counts follow pieces between worlds", () => {
  test("world_file move lowers the source shelves and raises the target, public counts included", async () => {
    const { ctx, liz, wardrobe, liz3d, three, piece, counts } = await setup();
    const a = await piece([liz, wardrobe], true);
    const b = await piece([liz]);
    expect(await counts(liz)).toEqual([2, 1]);
    expect(await counts(wardrobe)).toEqual([1, 1]);

    await callAsOwner(fileWorldAssets)(ctx, { ownerUserId: owner, world: "dear-annete-3d", assetIds: [a, b], addTo: ["Liz 3D", "root"], move: true });
    expect(await counts(liz)).toEqual([0, 0]);
    expect(await counts(wardrobe)).toEqual([0, 0]);
    expect(await counts(liz3d)).toEqual([2, 1]);
    expect(await counts(three)).toEqual([2, 1]);

    // world_undo puts both sides back.
    const change = (await callAsOwner(listWorldChanges)(ctx, { ownerUserId: owner, world: "dear-annete-3d" })).changes[0];
    await callAsOwner(undoWorldChanges)(ctx, { ownerUserId: owner, changeId: change.id });
    expect(await counts(liz)).toEqual([2, 1]);
    expect(await counts(liz3d)).toEqual([0, 0]);
  });

  test("world_move of a shelf and the collection editor keep both sides exact", async () => {
    const { ctx, dear, liz, wardrobe, liz3d, three, piece, counts } = await setup();
    const a = await piece([liz, wardrobe], true);
    await callAsOwner(moveToWorld)(ctx, { ownerUserId: owner, world: "dear-annete-3d", shelf: wardrobe });
    // The shelf keeps its piece; the piece left Liz, the other shelf of the old world.
    expect(await counts(wardrobe)).toEqual([1, 1]);
    expect(await counts(liz)).toEqual([0, 0]);

    // update_gallery_item folderIds replaces the set through setAssetFolders.
    await callAsOwner(setAssetFolders)(ctx, { ownerUserId: owner, assetId: a, folderIds: [liz3d, three] });
    expect(await counts(wardrobe)).toEqual([0, 0]);
    expect(await counts(liz3d)).toEqual([1, 1]);
    expect(await counts(three)).toEqual([1, 1]);
    expect(await counts(dear)).toEqual([0, 0]);
  });
});

describe("world_recount", () => {
  test("a dry run lists a stale count, the run fixes and journals it, a second run finds nothing", async () => {
    const { ctx, db, liz, liz3d, piece, counts } = await setup();
    await piece([liz3d], true);
    await piece([liz3d]);
    await db.patch(liz, { memberCount: 4, publicMemberCount: 3 });
    await db.patch(liz3d, { memberCount: 0 });

    const dry = await callAsOwner(recountWorldCounts)(ctx, { ownerUserId: owner, world: "dear-annete", dryRun: true });
    expect(dry.done).toBe(true);
    expect(dry.changeId).toBeNull();
    expect(dry.rows.map((row) => row.name)).toEqual(["DEAR ANNETE", "Liz", "Wardrobe"]);
    expect(dry.rows.find((row) => row.folderId === liz)).toMatchObject({
      before: { memberCount: 4, publicMemberCount: 3 }, after: { memberCount: 0, publicMemberCount: 0 }, changed: true,
    });
    expect(await counts(liz)).toEqual([4, 3]);

    const run = await callAsOwner(recountWorldCounts)(ctx, { ownerUserId: owner, world: "dear-annete", session: "repair" });
    expect(run.rows.filter((row) => row.changed).map((row) => row.name)).toEqual(["Liz"]);
    expect(await counts(liz)).toEqual([0, 0]);
    const journal = (await callAsOwner(listWorldChanges)(ctx, { ownerUserId: owner, world: "dear-annete" })).changes[0];
    expect(journal).toMatchObject({ op: "world.recount", session: "repair" });
    expect((await callAsOwner(recountWorldCounts)(ctx, { ownerUserId: owner, world: "dear-annete" })).rows.some((row) => row.changed)).toBe(false);

    // The other world: the stale 0 on Liz 3D comes back to 2, public 1.
    const other = await callAsOwner(recountWorldCounts)(ctx, { ownerUserId: owner, world: "dear-annete-3d" });
    expect(other.rows.find((row) => row.folderId === liz3d)).toMatchObject({ after: { memberCount: 2, publicMemberCount: 1 }, changed: true });

    // A recount in a session never blocks undoing that session.
    const undo = await callAsOwner(undoWorldChanges)(ctx, { ownerUserId: owner, undoSession: "repair" });
    expect(undo.blocked).toEqual([]);
    expect(await counts(liz)).toEqual([0, 0]);
  });

  test("a large collection is paged across calls and counted exactly, a duplicate link once", async () => {
    const { ctx, db, liz, counts } = await setup();
    for (let i = 0; i < 405; i += 1) {
      const id = await db.insert("assets", { ownerUserId: owner, kind: "image", tagIds: [], createdAt: Date.now(), isPublic: i < 3 });
      await db.insert("assetFolders", { ownerUserId: owner, assetId: id, folderId: liz, createdAt: Date.now() });
      if (i === 0) await db.insert("assetFolders", { ownerUserId: owner, assetId: id, folderId: liz, createdAt: Date.now() });
    }
    // A public piece held by the legacy primary pointer alone.
    await db.insert("assets", { ownerUserId: owner, kind: "image", tagIds: [], createdAt: Date.now(), isPublic: true, folderId: liz });

    let cursor;
    const rows = [];
    for (let call = 0; call < 10; call += 1) {
      const page = await callAsOwner(recountWorldCounts)(ctx, { ownerUserId: owner, world: "dear-annete", cursor });
      rows.push(...page.rows);
      if (page.done) break;
      cursor = page.cursor ?? undefined;
    }
    expect(rows.find((row) => row.folderId === liz)?.after).toEqual({ memberCount: 405, publicMemberCount: 4 });
    expect(await counts(liz)).toEqual([405, 4]);
    expect(rows).toHaveLength(3);
  });
});
