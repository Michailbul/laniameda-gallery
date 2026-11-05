import { describe, expect, test } from "bun:test";
import {
  archive,
  restore,
  finishDeletion,
  ARCHIVE_DELAY_MS,
} from "../convex/assetReview";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { callAsOwner } from "./helpers/call-as-owner";

async function setup() {
  const { ctx, db } = createMockConvexMutationCtx();
  const assetId = await db.insert("assets", {
    ownerUserId: "owner",
    kind: "image",
    tagIds: [],
    createdAt: 1,
  });
  const scheduled: { delay: number; args: { archiveId: string } }[] = [];
  const deleted: string[] = [];
  const context = {
    ...ctx,
    scheduler: {
      runAfter: async (
        delay: number,
        _ref: unknown,
        args: { archiveId: string },
      ) => {
        scheduled.push({ delay, args });
        return null;
      },
    },
    runMutation: async (_ref: unknown, args: { id: string }) => {
      deleted.push(args.id);
      await db.delete(args.id);
    },
  };
  // Registered handlers are exercised through the same auth wrapper as production.
  const finish = (args: { archiveId: string }) =>
    (
      finishDeletion as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<null>;
      }
    )._handler(context, args);
  return { context, db, assetId, scheduled, deleted, finish };
}

describe("asset archive", () => {
  test("D schedules one deletion ten minutes away; repeats do not extend it", async () => {
    const { context, assetId, scheduled, db } = await setup();
    const before = Date.now();
    const deleteAt = await callAsOwner(archive)(context, {
      ownerUserId: "owner",
      assetId,
    });
    expect(deleteAt).toBeGreaterThanOrEqual(before + ARCHIVE_DELAY_MS);
    expect(
      await callAsOwner(archive)(context, { ownerUserId: "owner", assetId }),
    ).toBe(deleteAt);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].delay).toBe(600000);
    expect(await db.get(assetId)).not.toBeNull();
  });

  test("restore invalidates old jobs, including after another archive", async () => {
    const { context, assetId, scheduled, finish, deleted } = await setup();
    await callAsOwner(archive)(context, { ownerUserId: "owner", assetId });
    await callAsOwner(restore)(context, { ownerUserId: "owner", assetId });
    await callAsOwner(restore)(context, { ownerUserId: "owner", assetId });
    await callAsOwner(archive)(context, { ownerUserId: "owner", assetId });
    await finish(scheduled[0].args);
    expect(deleted).toEqual([]);
    expect(scheduled).toHaveLength(2);
  });

  test("only a due, active ticket deletes and retries are harmless", async () => {
    const { context, assetId, scheduled, finish, deleted, db } = await setup();
    await callAsOwner(archive)(context, { ownerUserId: "owner", assetId });
    await finish(scheduled[0].args);
    expect(deleted).toEqual([]);
    await db.patch(scheduled[0].args.archiveId, { deleteAt: Date.now() - 1 });
    await finish(scheduled[0].args);
    await finish(scheduled[0].args);
    expect(deleted).toEqual([assetId]);
    expect(await db.get(scheduled[0].args.archiveId)).toBeNull();
  });

  test("another owner cannot archive or restore an asset", async () => {
    const { context, assetId } = await setup();
    await expect(
      callAsOwner(archive)(context, { ownerUserId: "stranger", assetId }),
    ).rejects.toThrow("Asset not found");
    await callAsOwner(archive)(context, { ownerUserId: "owner", assetId });
    await expect(
      callAsOwner(restore)(context, { ownerUserId: "stranger", assetId }),
    ).rejects.toThrow("Asset not found");
  });
});
