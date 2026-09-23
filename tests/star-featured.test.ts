import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createAsset, setAssetStarred } from "../convex/assets";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

describe("star is the featured flag", () => {
  let harness: ReturnType<typeof createMockConvexMutationCtx>;
  const previous = process.env.CURATION_ADMIN_USER_IDS;

  beforeEach(() => {
    harness = createMockConvexMutationCtx();
    process.env.CURATION_ADMIN_USER_IDS = "curator-1";
  });
  afterEach(() => {
    process.env.CURATION_ADMIN_USER_IDS = previous;
  });

  test("a curator's star publishes and features; unstar unfeatures", async () => {
    const asset = await createAsset._handler(harness.ctx as never, {
      ownerUserId: "curator-1",
      kind: "image",
      tagIds: [],
    });
    await setAssetStarred._handler(harness.ctx as never, {
      ownerUserId: "curator-1",
      assetId: asset.assetId,
      starred: true,
    });
    let row = await harness.db.get<Record<string, unknown>>(asset.assetId);
    expect(row?.isPublic).toBe(true);
    expect(row?.isFeatured).toBe(true);
    expect(row?.starredAt).toBeDefined();

    await setAssetStarred._handler(harness.ctx as never, {
      ownerUserId: "curator-1",
      assetId: asset.assetId,
      starred: false,
    });
    row = await harness.db.get<Record<string, unknown>>(asset.assetId);
    expect(row?.isFeatured).toBe(false);
    expect(row?.isPublic).toBe(true);
    expect(row?.starredAt).toBeUndefined();
  });

  test("anyone else's star stays private", async () => {
    const asset = await createAsset._handler(harness.ctx as never, {
      ownerUserId: "someone-else",
      kind: "image",
      tagIds: [],
    });
    await setAssetStarred._handler(harness.ctx as never, {
      ownerUserId: "someone-else",
      assetId: asset.assetId,
      starred: true,
    });
    const row = await harness.db.get<Record<string, unknown>>(asset.assetId);
    expect(row?.isFeatured).toBeFalsy();
    expect(row?.isPublic).toBeFalsy();
  });
});
