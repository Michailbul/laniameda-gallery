import { describe, expect, test } from "bun:test";
import {
  archive,
  restore,
  purge,
  finishDeletion,
  ARCHIVE_HIDE_REASON,
} from "../convex/assetReview";
import { internalDeleteAsset } from "../convex/assets";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { callAsOwner } from "./helpers/call-as-owner";

async function setup() {
  const { ctx, db } = createMockConvexMutationCtx();
  const world = await db.insert("folders", {
    ownerUserId: "owner",
    name: "DEAR ANNETE",
    normalizedName: "dear annete",
    worldKey: "dear-annete",
  });
  const shelf = await db.insert("folders", {
    ownerUserId: "owner",
    name: "Experiments",
    normalizedName: "dear annete/experiments",
    parentFolderId: world,
  });
  const loose = await db.insert("folders", {
    ownerUserId: "owner",
    name: "INSPIRATION SOURCE",
    normalizedName: "inspiration source",
  });
  const asset = async (folderId: string, fields: Record<string, unknown> = {}) => {
    const id = await db.insert("assets", {
      ownerUserId: "owner",
      kind: "image",
      tagIds: [],
      createdAt: 1,
      folderId,
      fileName: "cab-a-lantern-3.png",
      ingestKey: "overnight:cab-a-lantern-3",
      ...fields,
    });
    await db.insert("assetFolders", { ownerUserId: "owner", assetId: id, folderId, createdAt: 1 });
    return id;
  };
  const scheduled: { delay: number; ref: unknown }[] = [];
  const context = {
    ...ctx,
    scheduler: {
      runAfter: async (delay: number, ref: unknown) => {
        scheduled.push({ delay, ref });
        return null;
      },
    },
  };
  const finish = (args: { archiveId: string }) =>
    (
      finishDeletion as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<null>;
      }
    )._handler(context, args);
  const rows = (table: string) => db.query(table).collect() as Promise<Record<string, unknown>[]>;
  return { context, db, world, shelf, loose, asset, scheduled, finish, rows };
}

describe("asset archive (D) is soft", () => {
  test("archive keeps the asset, schedules nothing and takes it off the world page", async () => {
    const { context, db, shelf, asset, scheduled, rows } = await setup();
    const assetId = await asset(shelf);
    const archivedAt = await callAsOwner(archive)(context, { ownerUserId: "owner", assetId });
    expect(await callAsOwner(archive)(context, { ownerUserId: "owner", assetId })).toBe(archivedAt);
    expect(scheduled).toHaveLength(0);
    expect(await db.get(assetId)).toMatchObject({ worldPageHidden: true, worldPageHiddenReason: ARCHIVE_HIDE_REASON });
    expect(await rows("assetArchive")).toHaveLength(1);
    expect(await rows("assetDeletions")).toHaveLength(0);
  });

  test("restore brings it back and undoes only its own world-page hide", async () => {
    const { context, db, shelf, asset } = await setup();
    const archived = await asset(shelf);
    await callAsOwner(archive)(context, { ownerUserId: "owner", assetId: archived });
    await callAsOwner(restore)(context, { ownerUserId: "owner", assetId: archived });
    expect(await db.get(archived)).toMatchObject({ worldPageHidden: undefined });

    const dropped = await asset(shelf, { worldPageHidden: true, worldPageHiddenReason: "Dropped on the world page (2)" });
    await callAsOwner(archive)(context, { ownerUserId: "owner", assetId: dropped });
    await callAsOwner(restore)(context, { ownerUserId: "owner", assetId: dropped });
    expect(await db.get(dropped)).toMatchObject({ worldPageHidden: true, worldPageHiddenReason: "Dropped on the world page (2)" });
  });

  test("a job left by the old ten-minute delete deletes nothing", async () => {
    const { context, db, shelf, asset, finish, rows } = await setup();
    const assetId = await asset(shelf);
    const archiveId = await db.insert("assetArchive", { ownerUserId: "owner", assetId, deleteAt: Date.now() - 1 });
    await finish({ archiveId });
    await finish({ archiveId });
    expect(await db.get(assetId)).not.toBeNull();
    expect(await db.get(archiveId)).toMatchObject({ deleteAt: undefined });
    expect(await rows("assetDeletions")).toHaveLength(0);
    // Still in the tray, still restorable.
    await callAsOwner(restore)(context, { ownerUserId: "owner", assetId });
    expect(await db.get(archiveId)).toBeNull();
  });

  test("Delete for good removes only archived frames, and journals each", async () => {
    const { context, db, world, shelf, asset, rows } = await setup();
    const archived = await asset(shelf);
    const live = await asset(shelf);
    await callAsOwner(archive)(context, { ownerUserId: "owner", assetId: archived });
    const result = await callAsOwner(purge)(context, { ownerUserId: "owner", assetIds: [archived, live] });
    expect(result).toEqual({ deleted: 1, skipped: 1 });
    expect(await db.get(archived)).toBeNull();
    expect(await db.get(live)).not.toBeNull();
    expect(await rows("assetArchive")).toHaveLength(0);
    const journal = await rows("worldChanges");
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ worldFolderId: world, op: "assets.delete", targetId: archived, actor: "owner", session: "archive-tray" });
    expect(await rows("assetDeletions")).toEqual([expect.objectContaining({ assetId: archived, via: "archive.purge" })]);
  });

  test("another owner cannot archive, restore or purge an asset", async () => {
    const { context, db, shelf, asset } = await setup();
    const assetId = await asset(shelf);
    await expect(
      callAsOwner(archive)(context, { ownerUserId: "stranger", assetId }),
    ).rejects.toThrow("Asset not found");
    await callAsOwner(archive)(context, { ownerUserId: "owner", assetId });
    await expect(
      callAsOwner(restore)(context, { ownerUserId: "stranger", assetId }),
    ).rejects.toThrow("Asset not found");
    expect(await callAsOwner(purge)(context, { ownerUserId: "stranger", assetIds: [assetId] })).toEqual({ deleted: 0, skipped: 1 });
    expect(await db.get(assetId)).not.toBeNull();
  });
});

describe("every hard delete leaves a trace", () => {
  test("a world asset gets an assets.delete journal entry with actor, session, path and filing", async () => {
    const { context, world, shelf, asset, rows } = await setup();
    const assetId = await asset(shelf);
    await callAsOwner(internalDeleteAsset)(context, {
      id: assetId,
      via: "agent.delete_gallery_item",
      actor: "agent:night shift",
      session: "cleanup-7nov",
    });
    const [entry] = await rows("worldChanges");
    expect(entry).toMatchObject({
      worldFolderId: world,
      op: "assets.delete",
      targetType: "asset",
      targetId: assetId,
      actor: "agent:night shift",
      session: "cleanup-7nov",
    });
    expect(String(entry.summary)).toContain("cab-a-lantern-3.png");
    expect(String(entry.summary)).toContain("via agent.delete_gallery_item");
    expect(JSON.parse(String(entry.before))).toMatchObject({
      assetId,
      fileName: "cab-a-lantern-3.png",
      ingestKey: "overnight:cab-a-lantern-3",
      folderIds: [shelf],
      primaryFolderId: shelf,
      via: "agent.delete_gallery_item",
    });
    expect(await rows("assetDeletions")).toEqual([
      expect.objectContaining({ assetId, via: "agent.delete_gallery_item", actor: "agent:night shift", worldFolderIds: [world] }),
    ]);
  });

  test("an asset in no world is still recorded, with no journal entry to hang it on", async () => {
    const { context, loose, asset, rows } = await setup();
    const assetId = await asset(loose);
    await callAsOwner(internalDeleteAsset)(context, { id: assetId, via: "ui.inbox.duplicates", actor: "owner" });
    expect(await rows("worldChanges")).toHaveLength(0);
    expect(await rows("assetDeletions")).toEqual([
      expect.objectContaining({ assetId, via: "ui.inbox.duplicates", folderIds: [loose], worldFolderIds: [] }),
    ]);
  });

  test("a delete that names no path is still recorded, as unknown", async () => {
    const { context, shelf, asset, rows } = await setup();
    const assetId = await asset(shelf);
    await callAsOwner(internalDeleteAsset)(context, { id: assetId });
    expect(await rows("assetDeletions")).toEqual([expect.objectContaining({ assetId, via: "unknown", actor: "unknown" })]);
    expect(await rows("worldChanges")).toEqual([expect.objectContaining({ op: "assets.delete", targetId: assetId })]);
  });
});
