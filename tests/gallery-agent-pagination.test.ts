import { beforeEach, describe, expect, test } from "bun:test";
import { listAssetsPage } from "../convex/agentAssets";
import { listGalleryAssets } from "../convex/assets";
import { validateOwnedFolders } from "../convex/folders";
import { galleryAssetPageInputSchema } from "../lib/gallery-pagination";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { callAsOwner } from "./helpers/call-as-owner";

const OWNER = "42";
describe("scoped complete asset paging", () => {
  let harness: ReturnType<typeof createMockConvexMutationCtx>;
  beforeEach(() => { harness = createMockConvexMutationCtx(); });
  const asset = (extra: Record<string, unknown> = {}) => harness.db.insert("assets", { ownerUserId: OWNER, kind: "image", tagIds: [], createdAt: 1, ...extra });
  const page = (args: Record<string, unknown> = {}) => callAsOwner(listAssetsPage)(harness.ctx, { ownerUserId: OWNER, pageSize: 200, ...args });
  const all = async (filters: Record<string, unknown> = {}) => {
    const rows: string[] = [];
    let cursor: string | null = null;
    for (let count = 0; count < 100; count++) {
      const result = await page({ ...filters, cursor });
      rows.push(...result.assets.map(asset => asset._id));
      if (result.isDone) return rows;
      cursor = result.cursor;
    }
    throw new Error("Incomplete test inventory");
  };
  test("passes convenience-list caps and same-time ties across both owner spellings", async () => {
    const ids = [];
    for (let index = 0; index < 2001; index++) ids.push(await asset());
    ids.push(await asset({ ownerUserId: "telegram:42" }));
    await asset({ ownerUserId: "foreign" });
    const found = await all();
    expect(new Set(found)).toEqual(new Set(ids));
    expect(found).toHaveLength(2002);
  });
  test("empty filtered page continues to a later caption match", async () => {
    const wanted = await asset({ description: "Moonlit courtyard", createdAt: 0 });
    for (let index = 0; index < 201; index++) await asset({ createdAt: index + 1 });
    const first = await page({ search: "moonlit" });
    expect(first.assets).toEqual([]);
    expect(first.isDone).toBe(false);
    expect(await all({ search: "moonlit" })).toEqual([wanted]);
  });
  test("retrieves captions, agent descriptions, prompts, tags and bookmark prose", async () => {
    const promptId = await harness.db.insert("prompts", { text: "prompt needle" });
    const tagId = await harness.db.insert("tags", { name: "Tag needle" });
    const bookmarkId = await harness.db.insert("bookmarks", { text: "bookmark needle", quotedPost: { text: "quote needle" }, userNote: "note needle" });
    const id = await asset({ description: "caption needle", agentDescription: "agent needle", promptId, tagIds: [tagId], bookmarkId });
    for (const search of ["caption needle", "agent needle", "prompt needle", "tag needle", "bookmark needle", "quote needle", "note needle"]) {
      expect(await all({ search })).toEqual([id]);
      const old = await callAsOwner(listGalleryAssets)(harness.ctx, { ownerUserId: OWNER, limit: 5, search });
      expect(old.map(asset => asset._id)).toEqual([id]);
    }
  });
  test("all scope includes hidden collections but leaves Skill examples out unless asked", async () => {
    const root = await harness.db.insert("folders", { ownerUserId: OWNER, name: "Hidden", hiddenFromGallery: true });
    const child = await harness.db.insert("folders", { ownerUserId: OWNER, name: "Child", parentFolderId: root });
    const direct = await asset({ folderId: root });
    const descendant = await asset({ folderId: child });
    const step = await asset({ assetRole: "workflow_asset" });
    expect(new Set(await all())).toEqual(new Set([direct, descendant]));
    expect(new Set(await all({ includeSkillExamples: true }))).toEqual(new Set([direct, descendant, step]));
    expect(await all({ folderId: root })).toEqual([direct]);
    expect(new Set(await all({ folderId: root, includeDescendants: true }))).toEqual(new Set([direct, descendant]));
    expect(new Set(await all({ includeWorkflowAssets: false }))).toEqual(new Set([direct, descendant]));
    expect(await all({ excludeFolderIds: [root, child], includeSkillExamples: true })).toEqual([step]);
  });
  test("cursor rejects changed filters and invalid page budgets", async () => {
    await asset();
    const first = await page();
    expect(first.isDone).toBe(false); // second owner spelling still needs a page
    await expect(page({ cursor: first.cursor, search: "changed" })).rejects.toThrow("filters changed");
    for (const pageSize of [0, 1.5, 201]) await expect(page({ pageSize })).rejects.toThrow("pageSize");
  });
  test("requires signed identity and validates folder ownership even in legacy mode", async () => {
    const previous = process.env.LEGACY_OWNER_ARG_AUTH;
    process.env.LEGACY_OWNER_ARG_AUTH = "true";
    try {
      await expect(listAssetsPage._handler(harness.ctx as never, { ownerUserId: OWNER } as never)).rejects.toThrow("Not authenticated");
      const own = await harness.db.insert("folders", { ownerUserId: OWNER });
      const other = await harness.db.insert("folders", { ownerUserId: "foreign" });
      await expect(page({ folderId: other })).rejects.toThrow("Collection not found");
      expect(await callAsOwner(validateOwnedFolders)(harness.ctx, { ownerUserId: OWNER, folderIds: [own, own] })).toEqual([own]);
      await expect(callAsOwner(validateOwnedFolders)(harness.ctx, { ownerUserId: OWNER, folderIds: [own, other] })).rejects.toThrow("Collection not found");
    } finally {
      if (previous === undefined) delete process.env.LEGACY_OWNER_ARG_AUTH;
      else process.env.LEGACY_OWNER_ARG_AUTH = previous;
    }
  });
});

test("HTTP and MCP paging filters reject typo/owner overrides rather than broadening scope", () => {
  for (const input of [{ pieceType: "charcter" }, { ownerUserId: "foreign" }, { pageSize: 201 }, { includeWorkflowAssets: "false" }, { unexpected: true }]) expect(galleryAssetPageInputSchema.safeParse(input).success).toBe(false);
  expect(galleryAssetPageInputSchema.parse({ includeWorkflowAssets: false })).toEqual({ includeWorkflowAssets: false });
});
