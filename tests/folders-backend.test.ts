import { beforeEach, describe, expect, test } from "bun:test";

import { createAsset, setAssetFolder } from "../convex/assets";
import { createFolder, deleteFolder, listFolders } from "../convex/folders";
import { createPrompt } from "../convex/prompts";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

describe("folders backend", () => {
  let harness: ReturnType<typeof createMockConvexMutationCtx>;

  beforeEach(() => {
    harness = createMockConvexMutationCtx();
  });

  test("creates owner-scoped folders and dedupes by normalized name", async () => {
    const first = await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "  Mood   Board ",
      description: " references ",
    });

    expect(first.created).toBe(true);

    const second = await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "mood board",
    });

    expect(second.created).toBe(false);
    expect(second.folderId).toBe(first.folderId);

    const third = await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-2",
      name: "mood board",
    });

    expect(third.created).toBe(true);
    expect(third.folderId).not.toBe(first.folderId);
  });

  test("lists folders only for the requested owner", async () => {
    await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Folder A",
    });
    await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-2",
      name: "Folder B",
    });

    const list = await listFolders._handler(harness.ctx as never, {
      ownerUserId: "user-1",
    });

    expect(list.length).toBe(1);
    expect(list[0]?.name).toBe("Folder A");
    expect(list[0]?.ownerUserId).toBe("user-1");
  });

  test("rejects assigning another user's folder during asset create", async () => {
    const folder = await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-2",
      name: "Private",
    });

    await expect(
      createAsset._handler(harness.ctx as never, {
        ownerUserId: "user-1",
        kind: "image",
        tagIds: [],
        folderId: folder.folderId,
      }),
    ).rejects.toThrow("Folder does not belong to this user.");
  });

  test("setAssetFolder updates folder assignment and blocks cross-user access", async () => {
    const folderA = await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "To Review",
    });
    const folderB = await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-2",
      name: "Hidden",
    });

    const assetResult = await createAsset._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      kind: "image",
      tagIds: [],
    });

    const firstUpdate = await setAssetFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      assetId: assetResult.assetId,
      folderId: folderA.folderId,
    });

    expect(firstUpdate.folderId).toBe(folderA.folderId);

    const asset = await harness.db.get<Record<string, unknown>>(assetResult.assetId);
    expect(asset?.folderId).toBe(folderA.folderId);

    await expect(
      setAssetFolder._handler(harness.ctx as never, {
        ownerUserId: "user-1",
        assetId: assetResult.assetId,
        folderId: folderB.folderId,
      }),
    ).rejects.toThrow("Folder does not belong to this user.");
  });

  test("deleteFolder clears related asset and prompt references", async () => {
    const folder = await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Archive",
    });

    const promptResult = await createPrompt._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      text: "Cinematic portrait",
      tagIds: [],
      folderId: folder.folderId,
    });

    const assetResult = await createAsset._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      kind: "image",
      tagIds: [],
      folderId: folder.folderId,
      promptId: promptResult.promptId,
    });

    const deletion = await deleteFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      folderId: folder.folderId,
    });

    expect(deletion.deleted).toBe(true);
    expect(deletion.assetsUpdated).toBe(1);
    expect(deletion.promptsUpdated).toBe(1);

    const deletedFolder = await harness.db.get(folder.folderId);
    expect(deletedFolder).toBeNull();

    const asset = await harness.db.get<Record<string, unknown>>(assetResult.assetId);
    const prompt = await harness.db.get<Record<string, unknown>>(promptResult.promptId);

    expect(asset?.folderId).toBeUndefined();
    expect(prompt?.folderId).toBeUndefined();
  });
});
