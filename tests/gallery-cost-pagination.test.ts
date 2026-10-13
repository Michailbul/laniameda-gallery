import { describe, expect, spyOn, test } from "bun:test";
import { listFolderAssetsPage, listGalleryAssetsPage, listPublicGalleryAssetsPage } from "../convex/assets";
import { callAsOwner } from "./helpers/call-as-owner";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

describe("bounded gallery filter pages", () => {
  test("sparse AND/OR and exclusion filters reach old rows after empty pages", async () => {
    const h = createMockConvexMutationCtx();
    const a = await h.db.insert("tags", { name: "A" });
    const b = await h.db.insert("tags", { name: "B" });
    const excluded = await h.db.insert("tags", { name: "Excluded" });
    const target = await h.db.insert("assets", {
      ownerUserId: "123", kind: "image", tagIds: [a, b], createdAt: 1,
    });
    for (let i = 0; i < 650; i++) {
      await h.db.insert("assets", {
        ownerUserId: "123", kind: "image", tagIds: i % 2 ? [a] : [a, b, excluded], createdAt: i + 2,
      });
    }
    const found: string[] = [];
    let cursor: string | null = null;
    let first = true;
    for (;;) {
      const page = await callAsOwner(listGalleryAssetsPage)(h.ctx, {
        ownerUserId: "123", tagIdGroups: [[a], [b]], excludeTagIds: [excluded],
        paginationOpts: { cursor, numItems: 60 },
      });
      if (first) { expect(page.page).toEqual([]); expect(page.isDone).toBe(false); first = false; }
      found.push(...page.page.map((asset: { _id: string }) => asset._id));
      if (page.isDone) break;
      expect(page.continueCursor).not.toBe(cursor);
      cursor = page.continueCursor;
    }
    expect(found).toEqual([target]);
  });

  test("a world beyond 2,000 items is complete, deduplicated and hydrates only one page", async () => {
    const h = createMockConvexMutationCtx();
    const root = await h.db.insert("folders", { ownerUserId: "123", name: "World", createdAt: 0 });
    const child = await h.db.insert("folders", { ownerUserId: "123", name: "Child", parentFolderId: root, createdAt: 0 });
    for (let i = 0; i < 2005; i++) {
      const assetId = await h.db.insert("assets", {
        ownerUserId: "123", kind: "image", tagIds: [], folderId: i % 2 ? child : root, createdAt: i,
      });
      // Some items belong to both, while others only have the legacy pointer.
      if (i % 10 === 0) await h.db.insert("assetFolders", { ownerUserId: "123", assetId, folderId: child, createdAt: i });
    }
    await h.db.insert("assets", { ownerUserId: "foreign", kind: "image", tagIds: [], folderId: root, createdAt: 9999 });
    await h.db.insert("assets", { ownerUserId: "123", kind: "image", tagIds: [], createdAt: 9998 });
    const found: string[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page = await callAsOwner(listGalleryAssetsPage)(h.ctx, {
        ownerUserId: "123", folderId: root, includeDescendants: true,
        paginationOpts: { cursor, numItems: 60 },
      });
      expect(page.page.length).toBeLessThanOrEqual(60);
      found.push(...page.page.map((asset: { _id: string }) => asset._id));
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(found.length).toBe(2005);
    expect(new Set(found).size).toBe(2005);
  });

  test("folder filters retain owner scope and only read the requested membership page", async () => {
    const h = createMockConvexMutationCtx();
    const folderId = await h.db.insert("folders", { ownerUserId: "123", name: "Folder" });
    for (let i = 0; i < 120; i++) {
      const assetId = await h.db.insert("assets", {
        ownerUserId: i === 119 ? "foreign" : "123", kind: "image", tagIds: [],
        isLiked: i % 2 === 0, modelName: "Model", createdAt: i,
      });
      await h.db.insert("assetFolders", { ownerUserId: "123", assetId, folderId, createdAt: i });
    }
    const reads = spyOn(h.db, "get");
    const result = await callAsOwner(listFolderAssetsPage)(h.ctx, {
      ownerUserId: "123", folderId, onlyLiked: true, modelName: "Model",
      paginationOpts: { cursor: null, numItems: 60 },
    });
    expect(result.page.length).toBe(30);
    expect(result.isDone).toBe(false);
    expect(reads.mock.calls.filter(([id]) => id.startsWith("assets:")).length).toBe(60);
    expect(result.page.every((asset: { ownerUserId?: string }) => asset.ownerUserId === "123")).toBe(true);
  });

  test("public filters cannot reveal private rows and exclusions beat legacy membership", async () => {
    const h = createMockConvexMutationCtx();
    const folderId = await h.db.insert("folders", { name: "Excluded" });
    const tags = [await h.db.insert("tags", { name: "A" }), await h.db.insert("tags", { name: "B" })];
    const base = { kind: "image", tagIds: tags, createdAt: 1 };
    await h.db.insert("assets", { ...base, isPublic: false });
    await h.db.insert("assets", { ...base, isPublic: true, folderId });
    const allowed = await h.db.insert("assets", { ...base, isPublic: true });
    const result = await callAsOwner(listPublicGalleryAssetsPage)(h.ctx, {
      tagIdGroups: tags.map((tag) => [tag]), excludeFolderIds: [folderId],
      paginationOpts: { cursor: null, numItems: 60 },
    });
    expect(result.page.map((asset: { _id: string }) => asset._id)).toEqual([allowed]);
  });
});
