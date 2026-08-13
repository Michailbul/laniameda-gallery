import { beforeEach, describe, expect, test } from "bun:test";

import { bulkAssignAssetType, createAsset } from "../convex/assets";
import {
  ASSET_DRAG_MIME,
  readAssetDragPayload,
  writeAssetDragPayload,
} from "../lib/asset-drag";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

describe("gallery bulk sorting", () => {
  let harness: ReturnType<typeof createMockConvexMutationCtx>;

  beforeEach(() => {
    harness = createMockConvexMutationCtx();
  });

  test("assigning an asset type removes competing and legacy type tags", async () => {
    const characterTagId = await harness.db.insert("tags", {
      name: "character",
      normalized: "character",
      canonicalKey: "character",
      usageCount: 1,
    });
    const locationsTagId = await harness.db.insert("tags", {
      name: "locations",
      normalized: "locations",
      canonicalKey: "locations",
      usageCount: 1,
    });
    const asset = await createAsset._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      kind: "image",
      tagIds: [characterTagId, locationsTagId],
    });

    const result = await bulkAssignAssetType._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      assetIds: [asset.assetId, asset.assetId],
      assetType: "scene",
    });

    expect(result).toEqual({
      updatedCount: 1,
      skippedCount: 0,
      assetType: "scene",
    });
    const stored = await harness.db.get<{ tagIds: string[] }>(asset.assetId);
    const storedTagNames = (stored?.tagIds ?? []).map((tagId) => {
      const tag = harness.db
        .getTableDocs("tags")
        .find((entry) => entry._id === tagId);
      return tag?.name;
    });
    expect(storedTagNames).toEqual(["scene"]);
    expect(
      harness.db
        .getTableDocs("assetTags")
        .filter((link) => link.assetId === asset.assetId),
    ).toHaveLength(1);
  });

  test("drag payload carries the full selection and allows sorting drops", () => {
    const values = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "none",
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? "",
    } as unknown as DataTransfer;

    writeAssetDragPayload(dataTransfer, ["assets:1", "assets:2"]);

    expect(dataTransfer.effectAllowed).toBe("copyMove");
    expect(values.has(ASSET_DRAG_MIME)).toBe(true);
    expect(readAssetDragPayload(dataTransfer)).toEqual([
      "assets:1",
      "assets:2",
    ]);
  });
});
