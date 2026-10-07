import { describe, expect, test } from "bun:test";
import { saveStory, getStory, getStoryLinkStatus, listStories, listStoryRevisions, deleteStory } from "../convex/stories";
import { savePreset, seedPresets, listPresets } from "../convex/galleryPresets";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { callAsOwner } from "./helpers/call-as-owner";
import { storyPatchSchema } from "../lib/story-contract";

const text = { ownerUserId: "owner", ingestKey: "story:one", title: "The missed tram", body: "She is already running when the doors shut.", kind: "script", status: "draft", tagNames: ["relationship"], assetIds: [] };
describe("private textual stories", () => {
  test("a body-only agent patch preserves type, status and source metadata", () => {
    const patch = storyPatchSchema.parse({ body: "Revised text" });
    const current = { kind: "style-lock", status: "ready", tagNames: ["animation"], assetIds: ["source"] };
    expect({ ...current, ...patch }).toEqual({ ...current, body: "Revised text" });
  });
  test("browsing a root world includes its format stories without other worlds", async () => {
    const { ctx, db } = createMockConvexMutationCtx();
    const root = await db.insert("folders", { ownerUserId: "owner", name: "World" });
    const child = await db.insert("folders", { ownerUserId: "owner", name: "Animated", parentFolderId: root });
    await callAsOwner(saveStory)(ctx, { ...text, folderId: child });
    await callAsOwner(saveStory)(ctx, { ...text, ingestKey: "other", body: "Other world" });
    const stories = await callAsOwner(listStories)(ctx, { ownerUserId: "owner", folderId: root });
    expect(stories).toHaveLength(1); expect(stories[0].folderId).toBe(child);
  });
  test("saves without media, deduplicates retries, and keeps old text on revision", async () => {
    const { ctx } = createMockConvexMutationCtx();
    const first = await callAsOwner(saveStory)(ctx, { ...text, expectedRevision: 0 });
    const retry = await callAsOwner(saveStory)(ctx, { ...text, expectedRevision: 0 });
    expect(retry).toEqual({ id: first.id, created: false, revision: 1 });
    const edited = await callAsOwner(saveStory)(ctx, { ...text, body: "She catches his sleeve before the tram moves.", expectedRevision: 1 });
    expect(edited.revision).toBe(2);
    const history = await callAsOwner(listStoryRevisions)(ctx, { ownerUserId: "owner", id: first.id });
    expect(history).toHaveLength(1); expect(history[0].body).toBe(text.body);
    await expect(callAsOwner(saveStory)(ctx, { ...text, body: "Stale overwrite", expectedRevision: 1 })).rejects.toThrow("Story changed");
    await expect(callAsOwner(saveStory)(ctx, { ...text, body: "Stale overwrite without revision" })).rejects.toThrow("expectedRevision is required");
    expect(await callAsOwner(saveStory)(ctx, { ...text, body: "She catches his sleeve before the tram moves." })).toEqual({ id: first.id, created: false, revision: 2 });
    const current = await callAsOwner(getStory)(ctx, { ownerUserId: "owner", id: first.id });
    expect(current.body).toBe("She catches his sleeve before the tram moves.");
    expect((await callAsOwner(listStoryRevisions)(ctx, { ownerUserId: "owner", id: first.id })).length).toBe(1);
  });
  test("rejects another owner's reads, edits and foreign references", async () => {
    const { ctx, db } = createMockConvexMutationCtx();
    const first = await callAsOwner(saveStory)(ctx, text);
    await expect(callAsOwner(getStory)(ctx, { ownerUserId: "intruder", id: first.id })).rejects.toThrow("Story not found");
    expect(await callAsOwner(listStories)(ctx, { ownerUserId: "intruder" })).toEqual([]);
    const folderId = await db.insert("folders", { ownerUserId: "intruder", name: "Private" });
    await expect(callAsOwner(saveStory)(ctx, { ...text, folderId })).rejects.toThrow("Collection not found");
    const assetId = await db.insert("assets", { ownerUserId: "intruder", kind: "image", tagIds: [], createdAt: 1 });
    await expect(callAsOwner(saveStory)(ctx, { ...text, assetIds: [assetId] })).rejects.toThrow("Source asset not found");
    await expect(callAsOwner(deleteStory)(ctx, { ownerUserId: "intruder", id: first.id })).rejects.toThrow("Story not found");
  });
  test("delete is idempotent and removes history as well", async () => {
    const { ctx, db } = createMockConvexMutationCtx();
    const first = await callAsOwner(saveStory)(ctx, text);
    await callAsOwner(saveStory)(ctx, { ...text, body: "New text", expectedRevision: 1 });
    await callAsOwner(deleteStory)(ctx, { ownerUserId: "owner", id: first.id });
    await callAsOwner(deleteStory)(ctx, { ownerUserId: "owner", id: first.id });
    expect(db.getTableDocs("stories")).toHaveLength(0); expect(db.getTableDocs("storyRevisions")).toHaveLength(0);
  });
  test("full saves can clear collection and storybook links", async () => {
    const { ctx, db } = createMockConvexMutationCtx();
    const folderId = await db.insert("folders", { ownerUserId: "owner", name: "World" });
    const storybookId = await db.insert("folders", { ownerUserId: "owner", name: "Book", kind: "storybook" });
    const first = await callAsOwner(saveStory)(ctx, { ...text, folderId, storybookId });
    await callAsOwner(saveStory)(ctx, { ...text, expectedRevision: 1 });
    const current = await callAsOwner(getStory)(ctx, { ownerUserId: "owner", id: first.id });
    expect(current.folderId).toBeUndefined(); expect(current.storybookId).toBeUndefined();
  });
  test("legacy rollout mode never grants unauthenticated access to texts", async () => {
    const { ctx } = createMockConvexMutationCtx();
    const previous = process.env.LEGACY_OWNER_ARG_AUTH;
    process.env.LEGACY_OWNER_ARG_AUTH = "true";
    try {
      await expect(callAsOwner(listStories)({ ...ctx, auth: { getUserIdentity: async () => null } }, { ownerUserId: "owner" })).rejects.toThrow("Not authenticated");
    } finally { if (previous === undefined) delete process.env.LEGACY_OWNER_ARG_AUTH; else process.env.LEGACY_OWNER_ARG_AUTH = previous; }
  });
  test("missing references can be detected and removed without losing text or history", async () => {
    const { ctx, db } = createMockConvexMutationCtx();
    const folderId = await db.insert("folders", { ownerUserId: "owner", name: "Gone world" });
    const assetId = await db.insert("assets", { ownerUserId: "owner", kind: "image", tagIds: [], createdAt: 1 });
    const first = await callAsOwner(saveStory)(ctx, { ...text, folderId, assetIds: [assetId] });
    await db.delete(assetId); await db.delete(folderId);
    expect(await callAsOwner(getStoryLinkStatus)(ctx, { ownerUserId: "owner", id: first.id })).toEqual({ missingAssetIds: [assetId], missingFolder: true, missingStorybook: false });
    await callAsOwner(saveStory)(ctx, { ...text, expectedRevision: 1 });
    expect((await callAsOwner(getStory)(ctx, { ownerUserId: "owner", id: first.id })).body).toBe(text.body);
    expect((await callAsOwner(listStoryRevisions)(ctx, { ownerUserId: "owner", id: first.id }))[0].assetIds).toEqual([assetId]);
  });
});

describe("gallery filter presets", () => {
  test("starter presets are idempotent and no-skills really excludes skill cards", async () => {
    const { ctx, db } = createMockConvexMutationCtx();
    const first = await callAsOwner(seedPresets)(ctx, { ownerUserId: "owner" });
    const retry = await callAsOwner(seedPresets)(ctx, { ownerUserId: "owner" });
    expect(retry).toEqual(first); expect(first).toHaveLength(5);
    expect(db.getTableDocs("menuFilters")).toHaveLength(5);
    const presets = await callAsOwner(listPresets)(ctx, { ownerUserId: "owner" });
    expect(presets.find((p: { name: string }) => p.name === "No skills")?.filters.includeSkills).toBe(false);
    expect(presets.find((p: { name: string }) => p.name === "Animated characters")?.filters.selectedFilterIds).toHaveLength(2);
    expect(await callAsOwner(listPresets)(ctx, { ownerUserId: "intruder" })).toEqual([]);
  });
  test("rejects foreign filter IDs and include/exclude contradictions", async () => {
    const { ctx, db } = createMockConvexMutationCtx();
    const menuId = await db.insert("menuFilters", { ownerUserId: "other", label: "Other", kind: "tag", tagNames: ["animation"], sortOrder: 0, createdAt: 1, updatedAt: 1 });
    const filters = { selectedFilterIds: [menuId], excludedFilterIds: [], onlyLiked: false, includeSkills: false, flattenStacks: true, sortOrder: "newest" };
    await expect(callAsOwner(savePreset)(ctx, { ownerUserId: "owner", name: "Attack", filters })).rejects.toThrow("Filter not found");
    await db.patch(menuId, { ownerUserId: "owner" });
    await expect(callAsOwner(savePreset)(ctx, { ownerUserId: "owner", name: "Unresolved", filters })).rejects.toThrow("no available tags");
    await db.insert("tags", { name: "animation", normalized: "animation", canonicalKey: "animation", usageCount: 0 });
    await expect(callAsOwner(savePreset)(ctx, { ownerUserId: "owner", name: "Conflict", filters: { ...filters, excludedFilterIds: [menuId] } })).rejects.toThrow("both included and excluded");
    const id = await callAsOwner(savePreset)(ctx, { ownerUserId: "owner", name: "My view", filters });
    expect(await callAsOwner(savePreset)(ctx, { ownerUserId: "owner", name: "My view", filters })).toBe(id);
  });
});
