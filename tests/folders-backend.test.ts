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
  updateFolder,
} from "../convex/folders";
import { groupChildCollections, orderChildCollections } from "../lib/collection-groups";
import { createPrompt } from "../convex/prompts";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { callAsOwner } from "./helpers/call-as-owner";

describe("folders backend", () => {
  let harness: ReturnType<typeof createMockConvexMutationCtx>;

  beforeEach(() => {
    harness = createMockConvexMutationCtx();
  });

  test("creates owner-scoped folders and dedupes by normalized name", async () => {
    const first = await callAsOwner(createFolder)(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "  Mood   Board ",
      description: " references ",
    });

    expect(first.created).toBe(true);

    const second = await callAsOwner(createFolder)(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "mood board",
    });

    expect(second.created).toBe(false);
    expect(second.folderId).toBe(first.folderId);

    const third = await callAsOwner(createFolder)(harness.ctx as never, {
      ownerUserId: "user-2",
      name: "mood board",
    });

    expect(third.created).toBe(true);
    expect(third.folderId).not.toBe(first.folderId);
  });

  test("lists folders only for the requested owner", async () => {
    await callAsOwner(createFolder)(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Folder A",
    });
    await callAsOwner(createFolder)(harness.ctx as never, {
      ownerUserId: "user-2",
      name: "Folder B",
    });

    const list = await callAsOwner(listFolders)(harness.ctx as never, {
      ownerUserId: "user-1",
    });

    expect(list.length).toBe(1);
    expect(list[0]?.name).toBe("Folder A");
    expect(list[0]?.ownerUserId).toBe("user-1");
  });

  test("lists child collections as visual entries with previews and counts", async () => {
    const parent = await callAsOwner(createFolder)(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Orpheus",
    });
    const characters = await callAsOwner(createFolder)(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Characters",
      parentFolderId: parent.folderId,
    });
    await callAsOwner(createFolder)(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Locations",
      parentFolderId: parent.folderId,
    });
    await callAsOwner(createFolder)(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Inspirations",
      parentFolderId: parent.folderId,
    });
    await callAsOwner(createFolder)(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Scenes",
      parentFolderId: parent.folderId,
    });
    await callAsOwner(createFolder)(harness.ctx as never, {
      ownerUserId: "user-2",
      name: "Other",
    });

    const first = await callAsOwner(createAsset)(harness.ctx as never, {
      ownerUserId: "user-1",
      kind: "image",
      tagIds: [],
      folderId: characters.folderId,
      sourceUrl: "https://example.com/orpheus.jpg",
    });
    const second = await callAsOwner(createAsset)(harness.ctx as never, {
      ownerUserId: "user-1",
      kind: "image",
      tagIds: [],
      folderId: characters.folderId,
      sourceUrl: "https://example.com/eurydice.jpg",
    });

    const entries = await callAsOwner(listChildCollectionEntries)(
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

  test("child collections carry a display group and list group by group", async () => {
    const owner = { ownerUserId: "user-1" };
    const world = await callAsOwner(createFolder)(harness.ctx as never, { ...owner, name: "Dear Annete" });
    const child = (name: string, extra: Record<string, unknown> = {}) =>
      callAsOwner(createFolder)(harness.ctx as never, { ...owner, name, parentFolderId: world.folderId, ...extra });
    await child("Characters");
    await child("Zeta");
    const golden = await child("DA FILM Golden", { group: " Styles ", sortOrder: 2 });
    await child("DA FILM Night", { group: "styles", sortOrder: 1 });
    await child("Tram depot", { group: "Places" });
    await child("Mood one", { group: "Moods", sortOrder: 0 });

    const entries = await callAsOwner(listChildCollectionEntries)(harness.ctx as never, { ...owner, parentFolderId: world.folderId });
    expect(entries.map((entry) => entry.name)).toEqual([
      "Mood one", "DA FILM Night", "DA FILM Golden", "Tram depot", "Characters", "Zeta",
    ]);
    expect(entries.find((entry) => entry.name === "DA FILM Golden")).toMatchObject({ group: "Styles", sortOrder: 2 });

    // A group change needs no name; null clears; a retry of create keeps it.
    await callAsOwner(updateFolder)(harness.ctx as never, { ...owner, folderId: golden.folderId, group: "Looks" });
    let listed = await callAsOwner(listFolders)(harness.ctx as never, owner);
    expect(listed.find((folder) => folder._id === golden.folderId)).toMatchObject({ name: "DA FILM Golden", group: "Looks", sortOrder: 2 });
    await child("DA FILM Golden");
    listed = await callAsOwner(listFolders)(harness.ctx as never, owner);
    expect(listed.find((folder) => folder._id === golden.folderId)?.group).toBe("Looks");
    await callAsOwner(updateFolder)(harness.ctx as never, { ...owner, folderId: golden.folderId, group: null, sortOrder: null });
    listed = await callAsOwner(listFolders)(harness.ctx as never, owner);
    const cleared = listed.find((folder) => folder._id === golden.folderId);
    expect(cleared?.group).toBeUndefined();
    expect(cleared?.sortOrder).toBeUndefined();

    await expect(
      callAsOwner(updateFolder)(harness.ctx as never, { ...owner, folderId: golden.folderId, group: "x".repeat(41) }),
    ).rejects.toThrow("at most 40 characters");
    await expect(
      callAsOwner(updateFolder)(harness.ctx as never, { ...owner, folderId: golden.folderId, name: "  " }),
    ).rejects.toThrow("Folder name is required.");
  });

  test("group ordering keeps today's order when no child has a group", () => {
    const plain = [{ name: "Scenes" }, { name: "Alpha" }, { name: "Characters" }];
    expect(orderChildCollections(plain).map((child) => child.name)).toEqual(["Characters", "Scenes", "Alpha"]);
    const { groups, ungrouped } = groupChildCollections([
      { name: "B", group: "cast" }, { name: "A", group: "Cast ", sortOrder: 5 }, { name: "C" },
    ]);
    expect(groups).toEqual([{ key: "cast", label: "Cast", members: [{ name: "A", group: "Cast ", sortOrder: 5 }, { name: "B", group: "cast" }] }]);
    expect(ungrouped.map((child) => child.name)).toEqual(["C"]);
  });

  test("blocks child collection entries for another owner", async () => {
    const parent = await callAsOwner(createFolder)(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Private project",
    });

    await expect(
      callAsOwner(listChildCollectionEntries)(harness.ctx as never, {
        ownerUserId: "user-2",
        parentFolderId: parent.folderId,
      }),
    ).rejects.toThrow("Parent collection does not belong to this user.");
  });

  test("rejects assigning another user's folder during asset create", async () => {
    const folder = await callAsOwner(createFolder)(harness.ctx as never, {
      ownerUserId: "user-2",
      name: "Private",
    });

    await expect(
      callAsOwner(createAsset)(harness.ctx as never, {
        ownerUserId: "user-1",
        kind: "image",
        tagIds: [],
        folderId: folder.folderId,
      }),
    ).rejects.toThrow("Folder does not belong to this user.");
  });

  test("setAssetFolder updates folder assignment and blocks cross-user access", async () => {
    const folderA = await callAsOwner(createFolder)(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "To Review",
    });
    const folderB = await callAsOwner(createFolder)(harness.ctx as never, {
      ownerUserId: "user-2",
      name: "Hidden",
    });

    const assetResult = await callAsOwner(createAsset)(harness.ctx as never, {
      ownerUserId: "user-1",
      kind: "image",
      tagIds: [],
    });

    const firstUpdate = await callAsOwner(setAssetFolder)(harness.ctx as never, {
      ownerUserId: "user-1",
      assetId: assetResult.assetId,
      folderId: folderA.folderId,
    });

    expect(firstUpdate.folderId).toBe(folderA.folderId);

    const asset = await harness.db.get<Record<string, unknown>>(assetResult.assetId);
    expect(asset?.folderId).toBe(folderA.folderId);

    await expect(
      callAsOwner(setAssetFolder)(harness.ctx as never, {
        ownerUserId: "user-1",
        assetId: assetResult.assetId,
        folderId: folderB.folderId,
      }),
    ).rejects.toThrow("Folder does not belong to this user.");
  });

  test("setAssetFolders allows one asset in multiple folders", async () => {
    const folderA = await callAsOwner(createFolder)(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Editorial",
    });
    const folderB = await callAsOwner(createFolder)(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Reference",
    });
    const assetResult = await callAsOwner(createAsset)(harness.ctx as never, {
      ownerUserId: "user-1",
      kind: "image",
      tagIds: [],
      sourceUrl: "https://example.com/image.png",
    });

    const result = await callAsOwner(setAssetFolders)(harness.ctx as never, {
      ownerUserId: "user-1",
      assetId: assetResult.assetId,
      folderIds: [folderA.folderId, folderB.folderId, folderA.folderId],
    });

    expect(result.folderId).toBe(folderA.folderId);
    expect(result.folderIds).toEqual([folderA.folderId, folderB.folderId]);

    const links = harness.db.getTableDocs("assetFolders");
    expect(links.length).toBe(2);

    const folderBResults = await callAsOwner(listGalleryAssets)(harness.ctx as never, {
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
    const folderA = await callAsOwner(createFolder)(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Editorial",
    });
    const folderB = await callAsOwner(createFolder)(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Reference",
    });
    const folderC = await callAsOwner(createFolder)(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Campaign",
    });
    const assetResult = await callAsOwner(createAsset)(harness.ctx as never, {
      ownerUserId: "user-1",
      kind: "image",
      tagIds: [],
      folderId: folderA.folderId,
      sourceUrl: "https://example.com/image.png",
    });

    const result = await callAsOwner(addAssetFolders)(harness.ctx as never, {
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

  test("nests folders one level inside a collection", async () => {
    const collection = await callAsOwner(createFolder)(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Cassandra",
    });
    const folder = await callAsOwner(createFolder)(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Balcony",
      parentFolderId: collection.folderId,
    });
    expect(folder.created).toBe(true);
    const stored = await harness.db.get<Record<string, unknown>>(
      folder.folderId,
    );
    expect(stored?.parentFolderId).toBe(collection.folderId);

    // A folder never holds folders of its own.
    await expect(
      callAsOwner(createFolder)(harness.ctx as never, {
        ownerUserId: "user-1",
        name: "Too deep",
        parentFolderId: folder.folderId,
      }),
    ).rejects.toThrow("Sub-collections can't be nested further.");

    // A storybook is a child of its world and stays a leaf.
    const book = await callAsOwner(createFolder)(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "A story",
      kind: "storybook",
      parentFolderId: collection.folderId,
    });
    await expect(
      callAsOwner(createFolder)(harness.ctx as never, {
        ownerUserId: "user-1",
        name: "Inside a story",
        parentFolderId: book.folderId,
      }),
    ).rejects.toThrow("Only plain collections can contain sub-collections.");
  });

  test("deleteFolder clears related asset and prompt references", async () => {
    const folder = await callAsOwner(createFolder)(harness.ctx as never, {
      ownerUserId: "user-1",
      name: "Archive",
    });

    const promptResult = await callAsOwner(createPrompt)(harness.ctx as never, {
      ownerUserId: "user-1",
      text: "Cinematic portrait",
      tagIds: [],
      folderId: folder.folderId,
    });

    const assetResult = await callAsOwner(createAsset)(harness.ctx as never, {
      ownerUserId: "user-1",
      kind: "image",
      tagIds: [],
      folderId: folder.folderId,
      promptId: promptResult.promptId,
    });

    const deletion = await callAsOwner(deleteFolder)(harness.ctx as never, {
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
