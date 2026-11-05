import { describe, expect, test } from "bun:test";

import { chunkIds, collectPrivateCount, describePrivateCount, publishInBatches, type PrivateCountPage } from "../lib/publish-all";
import { countPrivateAssetsInView } from "../convex/assets";
import { callAsOwner } from "./helpers/call-as-owner";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

const owner = "owner";

type CountArgs = Omit<Parameters<ReturnType<typeof callAsOwner<typeof countPrivateAssetsInView>>>[1], "cursor">;

// The dialog's loop over the query: one call per page until the server is done.
const countView = (harness: ReturnType<typeof createMockConvexMutationCtx>, args: CountArgs) =>
  collectPrivateCount((cursor) =>
    callAsOwner(countPrivateAssetsInView)(harness.ctx as never, { ...args, cursor: cursor ?? undefined }) as Promise<PrivateCountPage>,
  );

const seed = async (harness: ReturnType<typeof createMockConvexMutationCtx>) => {
  const world = await harness.db.insert("folders", { ownerUserId: owner, name: "DEAR ANNETE", createdAt: 1 });
  const shelf = await harness.db.insert("folders", { ownerUserId: owner, name: "Streets", parentFolderId: world, createdAt: 2 });
  const other = await harness.db.insert("folders", { ownerUserId: owner, name: "ART", createdAt: 3 });
  const tag = await harness.db.insert("tags", { ownerUserId: owner, name: "location", createdAt: 1 });
  const insertAsset = async (fields: Record<string, unknown>, folderIds: string[]) => {
    const id = await harness.db.insert("assets", {
      ownerUserId: owner, kind: "image", tagIds: [], isPublic: false, createdAt: 10, ...fields,
    });
    for (const folderId of folderIds) {
      await harness.db.insert("assetFolders", { ownerUserId: owner, assetId: id, folderId, createdAt: 10 });
    }
    return id;
  };
  const inWorld = await insertAsset({ createdAt: 11 }, [world]);
  const inShelf = await insertAsset({ createdAt: 12, tagIds: [tag] }, [shelf]);
  const publicInShelf = await insertAsset({ createdAt: 13, isPublic: true }, [shelf]);
  const inOther = await insertAsset({ createdAt: 14, kind: "video" }, [other]);
  const loose = await insertAsset({ createdAt: 15 }, []);
  return { world, shelf, other, tag, inWorld, inShelf, publicInShelf, inOther, loose };
};

describe("countPrivateAssetsInView", () => {
  test("a world counts its own and its shelves' private pieces, never the public ones", async () => {
    const harness = createMockConvexMutationCtx();
    const ids = await seed(harness);
    const result = await countView(harness, {
      ownerUserId: owner, folderId: ids.world, includeDescendants: true,
    });
    expect(result.complete).toBe(true);
    expect(result.count).toBe(2);
    expect(new Set(result.assetIds)).toEqual(new Set([ids.inWorld, ids.inShelf]));
  });

  test("a shelf on its own, and the view's chips, narrow the count", async () => {
    const harness = createMockConvexMutationCtx();
    const ids = await seed(harness);
    const shelf = await countView(harness, { ownerUserId: owner, folderId: ids.shelf });
    expect(shelf.assetIds).toEqual([ids.inShelf]);
    const tagged = await countView(harness, {
      ownerUserId: owner, folderId: ids.world, includeDescendants: true, tagIdGroups: [[ids.tag]],
    });
    expect(tagged.assetIds).toEqual([ids.inShelf]);
    const videos = await countView(harness, { ownerUserId: owner, kind: "video" });
    expect(videos.assetIds).toEqual([ids.inOther]);
  });

  test("Everything counts every private piece, minus excluded collections", async () => {
    const harness = createMockConvexMutationCtx();
    const ids = await seed(harness);
    const all = await countView(harness, { ownerUserId: owner });
    expect(all.count).toBe(4);
    const withoutArt = await countView(harness, { ownerUserId: owner, excludeFolderIds: [ids.other] });
    expect(new Set(withoutArt.assetIds)).toEqual(new Set([ids.inWorld, ids.inShelf, ids.loose]));
  });

  test("another owner's pieces are not counted", async () => {
    const harness = createMockConvexMutationCtx();
    await seed(harness);
    await harness.db.insert("assets", { ownerUserId: "someone-else", kind: "image", tagIds: [], isPublic: false, createdAt: 99 });
    const all = await countView(harness, { ownerUserId: owner });
    expect(all.count).toBe(4);
  });

  test("a view larger than one page is counted across pages, a piece in two folders once", async () => {
    const harness = createMockConvexMutationCtx();
    const ids = await seed(harness);
    // Filed in the world and in its shelf: two links, one piece.
    await harness.db.insert("assetFolders", { ownerUserId: owner, assetId: ids.inShelf, folderId: ids.world, createdAt: 12 });
    for (let index = 0; index < 1650; index += 1) {
      const id = await harness.db.insert("assets", { ownerUserId: owner, kind: "image", tagIds: [], isPublic: index % 3 === 0, createdAt: 100 + index });
      await harness.db.insert("assetFolders", { ownerUserId: owner, assetId: id, folderId: ids.shelf, createdAt: 100 + index });
    }
    const calls: Array<string | null> = [];
    const result = await collectPrivateCount((cursor) => {
      calls.push(cursor);
      return callAsOwner(countPrivateAssetsInView)(harness.ctx as never, {
        ownerUserId: owner, folderId: ids.world, includeDescendants: true, cursor: cursor ?? undefined,
      }) as Promise<PrivateCountPage>;
    });
    expect(result.complete).toBe(true);
    expect(result.count).toBe(2 + 1100);
    expect(calls.length).toBeGreaterThan(2);
    expect(new Set(result.assetIds).size).toBe(result.assetIds.length);
  });

  test("the dialog gives up, and says so, past its page limit", async () => {
    let served = 0;
    const result = await collectPrivateCount(async (cursor) => {
      served += 1;
      return { count: 1, assetIds: [`a${cursor ?? 0}`], continueCursor: String(served), isDone: false };
    }, 3);
    expect(served).toBe(3);
    expect(result).toMatchObject({ complete: false, count: 3 });
  });
});

describe("publish all helpers", () => {
  test("ids go to the bulk route 200 at a time", () => {
    const ids = Array.from({ length: 450 }, (_, index) => `a${index}`);
    expect(chunkIds(ids).map((batch) => batch.length)).toEqual([200, 200, 50]);
    expect(chunkIds([])).toEqual([]);
  });

  test("the dialog's copy follows the server count", () => {
    expect(describePrivateCount(null, "Everything")).toMatchObject({ publishable: false, headline: "Counting private pieces…" });
    expect(describePrivateCount(null, "Everything", "failed").publishable).toBe(false);
    expect(describePrivateCount({ count: 0, assetIds: [], complete: true }, "ART")).toMatchObject({
      publishable: false, headline: "Everything here is already public",
    });
    expect(describePrivateCount({ count: 1140, assetIds: [], complete: true }, "DEAR ANNETE")).toMatchObject({
      publishable: true, headline: "Make 1,140 pieces public",
    });
    expect(describePrivateCount({ count: 1, assetIds: ["a"], complete: true }, "x").headline).toBe("Make 1 piece public");
    const capped = describePrivateCount({ count: 2000, assetIds: [], complete: false }, "Everything");
    expect(capped.publishable).toBe(false);
    expect(capped.headline).toBe("More than 2,000 pieces are private");
  });

  test("publishing runs batch by batch and stops at the first failure with its progress", async () => {
    const ids = Array.from({ length: 450 }, (_, index) => `a${index}`);
    const sent: number[] = [];
    const progress: number[] = [];
    const ok = await publishInBatches(ids, async (batch) => {
      sent.push(batch.length);
      return { updatedCount: batch.length - 1, skippedCount: 1 };
    }, (done) => progress.push(done));
    expect(sent).toEqual([200, 200, 50]);
    expect(progress).toEqual([200, 400, 450]);
    expect(ok).toEqual({ updatedCount: 447, skippedCount: 3 });

    let calls = 0;
    const failed = await publishInBatches(ids, async (batch) => {
      calls += 1;
      if (calls === 2) throw new Error("Server misconfigured");
      return { updatedCount: batch.length, skippedCount: 0 };
    });
    expect(failed).toEqual({ updatedCount: 200, skippedCount: 0, failedAt: 200, error: "Server misconfigured" });
  });
});
