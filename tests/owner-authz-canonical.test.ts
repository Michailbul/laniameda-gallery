import { beforeEach, describe, expect, test } from "bun:test";

import {
  countAssets,
  createAsset,
  getAsset,
  hasAssetForIngestKey,
  listAssets,
  setAssetFolder,
} from "../convex/assets";
import { createFolder, deleteFolder, listFolders } from "../convex/folders";
import { createPrompt, getPrompt, listPrompts, updatePrompt } from "../convex/prompts";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

describe("owner authz canonicalization", () => {
  let harness: ReturnType<typeof createMockConvexMutationCtx>;
  const owner = "278674008";
  const ownerAlias = "telegram:278674008";

  beforeEach(() => {
    harness = createMockConvexMutationCtx();
  });

  test("folder list and assignment accept owner aliases", async () => {
    const folder = await createFolder._handler(harness.ctx as never, {
      ownerUserId: owner,
      name: "Inbox",
    });
    const asset = await createAsset._handler(harness.ctx as never, {
      ownerUserId: owner,
      kind: "image",
      tagIds: [],
    });

    const folders = await listFolders._handler(harness.ctx as never, {
      ownerUserId: ownerAlias,
    });
    expect(folders.length).toBe(1);
    expect(folders[0]?._id).toBe(folder.folderId);

    const update = await setAssetFolder._handler(harness.ctx as never, {
      ownerUserId: ownerAlias,
      assetId: asset.assetId,
      folderId: folder.folderId,
    });
    expect(update.folderId).toBe(folder.folderId);
  });

  test("asset queries/count/ingest checks include owner aliases", async () => {
    const asset = await createAsset._handler(harness.ctx as never, {
      ownerUserId: ownerAlias,
      kind: "image",
      tagIds: [],
      ingestKey: "asset-owner-alias-key",
    });

    const fetched = await getAsset._handler(harness.ctx as never, {
      id: asset.assetId,
      ownerUserId: owner,
    });
    expect(fetched?._id).toBe(asset.assetId);

    const listed = await listAssets._handler(harness.ctx as never, {
      ownerUserId: owner,
    });
    expect(listed.some((row) => row._id === asset.assetId)).toBeTrue();

    const hasIngestKey = await hasAssetForIngestKey._handler(harness.ctx as never, {
      ownerUserId: owner,
      ingestKey: "asset-owner-alias-key",
    });
    expect(hasIngestKey).toBeTrue();

    const count = await countAssets._handler(harness.ctx as never, {
      ownerUserId: owner,
    });
    expect(count).toBe(1);
  });

  test("prompt ownership checks and reads accept owner aliases", async () => {
    const folderA = await createFolder._handler(harness.ctx as never, {
      ownerUserId: owner,
      name: "Folder A",
    });
    const folderB = await createFolder._handler(harness.ctx as never, {
      ownerUserId: ownerAlias,
      name: "Folder B",
    });
    const prompt = await createPrompt._handler(harness.ctx as never, {
      ownerUserId: owner,
      text: "Initial prompt text",
      tagIds: [],
      folderId: folderA.folderId,
    });

    const updatedPromptId = await updatePrompt._handler(harness.ctx as never, {
      ownerUserId: ownerAlias,
      id: prompt.promptId,
      text: "Updated prompt text",
      tagIds: [],
      folderId: folderB.folderId,
    });
    expect(updatedPromptId).toBe(prompt.promptId);

    const fetched = await getPrompt._handler(harness.ctx as never, {
      id: prompt.promptId,
      ownerUserId: ownerAlias,
    });
    expect(fetched?.text).toBe("Updated prompt text");
    expect(fetched?.folderId).toBe(folderB.folderId);

    const listed = await listPrompts._handler(harness.ctx as never, {
      ownerUserId: ownerAlias,
    });
    expect(listed.length).toBe(1);
    expect(listed[0]?._id).toBe(prompt.promptId);
  });

  test("deleteFolder accepts owner alias and clears linked docs", async () => {
    const folder = await createFolder._handler(harness.ctx as never, {
      ownerUserId: owner,
      name: "Archive",
    });
    const prompt = await createPrompt._handler(harness.ctx as never, {
      ownerUserId: ownerAlias,
      text: "Alias-linked prompt",
      tagIds: [],
      folderId: folder.folderId,
    });
    const asset = await createAsset._handler(harness.ctx as never, {
      ownerUserId: ownerAlias,
      kind: "image",
      tagIds: [],
      folderId: folder.folderId,
      promptId: prompt.promptId,
    });

    const result = await deleteFolder._handler(harness.ctx as never, {
      ownerUserId: ownerAlias,
      folderId: folder.folderId,
    });

    expect(result.deleted).toBeTrue();
    expect(result.assetsUpdated).toBe(1);
    expect(result.promptsUpdated).toBe(1);

    const patchedPrompt = await harness.db.get<Record<string, unknown>>(prompt.promptId);
    const patchedAsset = await harness.db.get<Record<string, unknown>>(asset.assetId);
    expect(patchedPrompt?.folderId).toBeUndefined();
    expect(patchedAsset?.folderId).toBeUndefined();
  });
});
