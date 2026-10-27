import { beforeEach, describe, expect, test } from "bun:test";

import {
  addAssetComment,
  deleteAssetComment,
  listAssetComments,
  listRecentAssetComments,
  updateAssetComment,
} from "../convex/assetComments";
import { createAsset, internalDeleteAsset } from "../convex/assets";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { callAsOwner } from "./helpers/call-as-owner";

describe("asset comments", () => {
  let harness: ReturnType<typeof createMockConvexMutationCtx>;
  let assetId: string;

  beforeEach(async () => {
    harness = createMockConvexMutationCtx();
    const created = await callAsOwner(createAsset)(harness.ctx as never, {
      ownerUserId: "user-1",
      kind: "image",
      tagIds: [],
      sourceUrl: "https://example.com/street.jpg",
    });
    assetId = String((created as { assetId?: string }).assetId ?? created);
  });

  const add = (body: string, author?: "owner" | "agent") =>
    callAsOwner(addAssetComment)(harness.ctx as never, {
      ownerUserId: "user-1",
      assetId,
      body,
      author,
    });

  test("a thread reads oldest first and keeps who wrote each comment", async () => {
    await add("  warmer light on the lamps  ");
    await new Promise((resolve) => setTimeout(resolve, 2));
    await add("Done: v2 filed next to it.", "agent");
    const thread = await callAsOwner(listAssetComments)(harness.ctx as never, {
      ownerUserId: "user-1",
      assetId,
    });
    expect(thread.map((comment) => [comment.author, comment.body])).toEqual([
      ["owner", "warmer light on the lamps"],
      ["agent", "Done: v2 filed next to it."],
    ]);
    const recent = await callAsOwner(listRecentAssetComments)(harness.ctx as never, {
      ownerUserId: "user-1",
      author: "owner",
    });
    expect(recent.map((comment) => comment.body)).toEqual(["warmer light on the lamps"]);
  });

  test("edit and delete a comment; empty text is refused", async () => {
    const comment = await add("first take");
    const edited = await callAsOwner(updateAssetComment)(harness.ctx as never, {
      ownerUserId: "user-1",
      commentId: comment._id,
      body: "second take",
    });
    expect(edited.body).toBe("second take");
    await expect(add("   ")).rejects.toThrow("A comment needs text.");
    await callAsOwner(deleteAssetComment)(harness.ctx as never, {
      ownerUserId: "user-1",
      commentId: comment._id,
    });
    const thread = await callAsOwner(listAssetComments)(harness.ctx as never, {
      ownerUserId: "user-1",
      assetId,
    });
    expect(thread).toHaveLength(0);
  });

  test("another owner can neither read nor comment", async () => {
    await add("private note");
    await expect(
      callAsOwner(listAssetComments)(harness.ctx as never, { ownerUserId: "user-2", assetId }),
    ).rejects.toThrow("Asset not found.");
    await expect(
      callAsOwner(addAssetComment)(harness.ctx as never, { ownerUserId: "user-2", assetId, body: "hi" }),
    ).rejects.toThrow("Asset not found.");
  });

  test("deleting the asset deletes its thread", async () => {
    await add("note one");
    await add("note two");
    await callAsOwner(internalDeleteAsset)(harness.ctx as never, { id: assetId });
    const rows = await harness.ctx.db.query("assetComments").collect();
    expect(rows).toHaveLength(0);
  });
});
