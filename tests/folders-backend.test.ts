import { beforeEach, describe, expect, test } from "bun:test";

import {
  addAssetFolders,
  createAsset,
  listGalleryAssets,
  setAssetFolder,
  setAssetFolders,
} from "../convex/assets";
import {
  createFolder,
  deleteFolder,
  listChildCollectionEntries,
  listFolders,
} from "../convex/folders";
import { removeAssetsFromProject } from "../convex/projects";
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

  test("lists child collections as visual entries with previews and counts", async () => {
    const parent = await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Orpheus",
    });
    const characters = await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Characters",
      parentFolderId: parent.folderId,
    });
    await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Locations",
      parentFolderId: parent.folderId,
    });
    await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Inspirations",
      parentFolderId: parent.folderId,
    });
    await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Scenes",
      parentFolderId: parent.folderId,
    });
    await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-2",
      name: "Other",
    });

    const first = await createAsset._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      kind: "image",
      tagIds: [],
      folderId: characters.folderId,
      sourceUrl: "https://example.com/orpheus.jpg",
    });
    const second = await createAsset._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      kind: "image",
      tagIds: [],
      folderId: characters.folderId,
      sourceUrl: "https://example.com/eurydice.jpg",
    });

    const entries = await listChildCollectionEntries._handler(
      harness.ctx as never,
      {
        ownerUserId: "user-1",
        parentFolderId: parent.folderId,
      },
    );

    expect(entries.map((entry) => entry.name)).toEqual([
      "Characters",
      "Locations",
      "Scenes",
      "Inspirations",
    ]);
    expect(entries[0]?.count).toBe(2);
    expect(
      entries[0]?.previewAssets.map((preview) => preview.assetId).sort(),
    ).toEqual([first.assetId, second.assetId].sort());
    for (const entry of entries.slice(1)) {
      expect(entry.count).toBe(0);
      expect(entry.previewAssets).toEqual([]);
    }
  });

  test("blocks child collection entries for another owner", async () => {
    const parent = await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Private project",
    });

    await expect(
      listChildCollectionEntries._handler(harness.ctx as never, {
        ownerUserId: "user-2",
        parentFolderId: parent.folderId,
      }),
    ).rejects.toThrow("Parent collection does not belong to this user.");
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

  test("setAssetFolders allows one asset in multiple folders", async () => {
    const folderA = await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Editorial",
    });
    const folderB = await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Reference",
    });
    const assetResult = await createAsset._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      kind: "image",
      tagIds: [],
      sourceUrl: "https://example.com/image.png",
    });

    const result = await setAssetFolders._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      assetId: assetResult.assetId,
      folderIds: [folderA.folderId, folderB.folderId, folderA.folderId],
    });

    expect(result.folderId).toBe(folderA.folderId);
    expect(result.folderIds).toEqual([folderA.folderId, folderB.folderId]);

    const links = harness.db.getTableDocs("assetFolders");
    expect(links.length).toBe(2);

    const folderBResults = await listGalleryAssets._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      folderId: folderB.folderId,
      limit: 20,
    });
    expect(folderBResults.map((asset) => asset._id)).toEqual([
      assetResult.assetId,
    ]);
    expect(folderBResults[0]?.folderIds).toEqual([
      folderA.folderId,
      folderB.folderId,
    ]);
  });

  test("addAssetFolders appends folders without replacing existing links", async () => {
    const folderA = await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Editorial",
    });
    const folderB = await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Reference",
    });
    const folderC = await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Campaign",
    });
    const assetResult = await createAsset._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      kind: "image",
      tagIds: [],
      folderId: folderA.folderId,
      sourceUrl: "https://example.com/image.png",
    });

    const result = await addAssetFolders._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      assetId: assetResult.assetId,
      folderIds: [folderB.folderId, folderC.folderId, folderB.folderId],
    });

    expect(result.folderId).toBe(folderA.folderId);
    expect(result.folderIds).toEqual([
      folderA.folderId,
      folderB.folderId,
      folderC.folderId,
    ]);
    expect(harness.db.getTableDocs("assetFolders").length).toBe(3);
  });

  test("removing assets from a project preserves outside collection memberships", async () => {
    const project = await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Campaign",
      kind: "project",
    });
    const projectInbox = await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Campaign Inbox",
    });
    const outside = await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Favorites",
    });
    await harness.db.insert("projectCollections", {
      ownerUserId: "user-1",
      projectId: project.folderId,
      folderId: projectInbox.folderId,
      createdAt: Date.now(),
    });
    const asset = await createAsset._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      kind: "image",
      tagIds: [],
      folderId: projectInbox.folderId,
    });
    await addAssetFolders._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      assetId: asset.assetId,
      folderIds: [outside.folderId],
    });

    const result = await removeAssetsFromProject._handler(
      harness.ctx as never,
      {
        ownerUserId: "user-1",
        projectId: project.folderId,
        assetIds: [asset.assetId, asset.assetId],
      },
    );

    expect(result).toEqual({ removed: 1, skipped: 0 });
    const updatedAsset = await harness.db.get<Record<string, unknown>>(
      asset.assetId,
    );
    expect(updatedAsset?.folderId).toBe(outside.folderId);
    expect(
      harness.db
        .getTableDocs("assetFolders")
        .map((link) => link.folderId),
    ).toEqual([outside.folderId]);

    const repeated = await removeAssetsFromProject._handler(
      harness.ctx as never,
      {
        ownerUserId: "user-1",
        projectId: project.folderId,
        assetIds: [asset.assetId],
      },
    );
    expect(repeated).toEqual({ removed: 0, skipped: 1 });
  });

  test("blocks removing another owner's assets from a project", async () => {
    const project = await createFolder._handler(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Private Project",
      kind: "project",
    });
    const asset = await createAsset._handler(harness.ctx as never, {
      ownerUserId: "user-2",
      kind: "image",
      tagIds: [],
    });

    await expect(
      removeAssetsFromProject._handler(harness.ctx as never, {
        ownerUserId: "user-1",
        projectId: project.folderId,
        assetIds: [asset.assetId],
      }),
    ).rejects.toThrow("Asset does not belong to this user.");
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
    expect(harness.db.getTableDocs("assetFolders")).toEqual([]);
  });
});
