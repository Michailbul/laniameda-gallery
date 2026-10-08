import { describe, expect, test } from "bun:test";
import { setAssetSelectionLiked } from "../lib/bulk-like";
import { setAssetLiked } from "../convex/assets";
import { callAsOwner } from "./helpers/call-as-owner";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

describe("bulk favourites", () => {
  test("sets mixed selections to one explicit state and reports failed items", async () => {
    const states = new Map([["first", false], ["second", true]]);
    const update = async (id: string, liked: boolean) => {
      if (id === "missing") throw new Error("Asset not found.");
      states.set(id, liked);
    };
    const result = await setAssetSelectionLiked(["first", "second", "first", "missing"], true, update);
    expect(result.updatedIds.sort()).toEqual(["first", "second"]);
    expect(result.failures).toEqual([{ assetId: "missing", error: "Asset not found." }]);
    expect([...states.values()]).toEqual([true, true]);
    await setAssetSelectionLiked(["first", "second"], false, update);
    expect([...states.values()]).toEqual([false, false]);
  });

  test("liking and unliking preserve publication, starring and collection metadata", async () => {
    const harness = createMockConvexMutationCtx();
    const id = await harness.db.insert("assets", {
      ownerUserId: "owner", kind: "image", tagIds: [], createdAt: 1,
      isPublic: false, isFeatured: false, starredAt: 42, folderId: "folders:project",
    });
    for (const isLiked of [true, false]) {
      await callAsOwner(setAssetLiked)(harness.ctx as never, { ownerUserId: "owner", assetId: id, isLiked });
      expect(await harness.db.get(id)).toMatchObject({
        isLiked, isPublic: false, isFeatured: false, starredAt: 42, folderId: "folders:project",
      });
    }
    await expect(callAsOwner(setAssetLiked)(harness.ctx as never, {
      ownerUserId: "someone-else", assetId: id, isLiked: true,
    })).rejects.toThrow("Asset does not belong to this user.");
  });
});
