import { beforeEach, describe, expect, test } from "bun:test";

import { flattenSectionCollections } from "../convex/collectionCleanup";
import { createFolder } from "../convex/folders";
import { createAsset } from "../convex/assets";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

describe("flattenSectionCollections", () => {
  let harness: ReturnType<typeof createMockConvexMutationCtx>;

  beforeEach(() => {
    harness = createMockConvexMutationCtx();
  });

  test("folds section folders into tags and leaves the owner's folders alone", async () => {
    const world = await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Cassandra",
    });
    const section = await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Characters",
      parentFolderId: world.folderId,
    });
    const beat = await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Balcony",
      parentFolderId: world.folderId,
    });
    const empty = await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "inspo",
      parentFolderId: world.folderId,
    });
    await createAsset._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      kind: "image",
      tagIds: [],
      folderId: section.folderId,
    });
    await createAsset._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      kind: "image",
      tagIds: [],
      folderId: beat.folderId,
    });

    const result = await flattenSectionCollections._handler(
      harness.ctx as never,
      { ownerUserId: "user-1", dryRun: false },
    );

    expect(result.report.map((entry) => entry.name)).toEqual(["Characters"]);
    expect(await harness.db.get(section.folderId)).toBeNull();
    expect(await harness.db.get(beat.folderId)).not.toBeNull();
    expect(await harness.db.get(empty.folderId)).not.toBeNull();
  });
});
