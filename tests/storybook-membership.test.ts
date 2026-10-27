import { describe, expect, test } from "bun:test";
import { addAssetFolders } from "../convex/assets";
import { saveStory } from "../convex/stories";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { callAsOwner } from "./helpers/call-as-owner";

const owner = "owner";
const base = { ownerUserId: owner, ingestKey: "story:apocalypse", title: "Apocalypse Teaser", body: "The city ends at dusk.", kind: "script", status: "draft", tagNames: [] };

const setup = async () => {
  const { ctx, db } = createMockConvexMutationCtx();
  const shelf = await db.insert("folders", { ownerUserId: owner, name: "Style shelf" });
  const book = await db.insert("folders", { ownerUserId: owner, name: "Apocalypse Teaser", kind: "storybook" });
  const assetId = await db.insert("assets", { ownerUserId: owner, kind: "image", tagIds: [], createdAt: 1, folderId: shelf, isLiked: false });
  await db.insert("assetFolders", { ownerUserId: owner, assetId, folderId: shelf, createdAt: 1 });
  const members = async (folderId: string) =>
    (await db.query("assetFolders").withIndex("by_asset", (q: any) => q.eq("assetId", assetId)).collect()).filter((l: any) => l.folderId === folderId);
  return { ctx, db, shelf, book, assetId, members };
};

describe("storybook membership", () => {
  test("saving a story links its assets into the storybook and keeps the shelf", async () => {
    const { ctx, db, shelf, book, assetId, members } = await setup();
    const first = await callAsOwner(saveStory)(ctx, { ...base, storybookId: book, assetIds: [] });
    expect(await members(book)).toHaveLength(0);
    await callAsOwner(saveStory)(ctx, { ...base, storybookId: book, assetIds: [assetId], expectedRevision: first.revision });
    expect(await members(book)).toHaveLength(1);
    expect(await members(shelf)).toHaveLength(1);
    const asset = await db.get(assetId);
    expect(asset.folderId).toBe(shelf);
    expect(asset.isLiked).toBe(false);
    // exact retry stays at one link
    await callAsOwner(saveStory)(ctx, { ...base, storybookId: book, assetIds: [assetId] });
    expect(await members(book)).toHaveLength(1);
  });

  test("agent additive filing adds the storybook without dropping the shelf", async () => {
    const { ctx, shelf, book, assetId, members } = await setup();
    const result = await callAsOwner(addAssetFolders)(ctx, { ownerUserId: owner, assetId, folderIds: [book] });
    expect(result.folderIds).toContain(book);
    expect(result.folderIds).toContain(shelf);
    expect(await members(book)).toHaveLength(1);
    expect(await members(shelf)).toHaveLength(1);
  });
});
