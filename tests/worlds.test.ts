import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  fileWorldAssets, getWorldContext, listWorldChanges, listWorlds, markWorld, readWorldDoc, saveWorldShelf,
  undoWorldChanges, worldDocHistory, writeWorldDoc,
} from "../convex/worlds";
import { addMoodboardItems, createMoodboard, deleteMoodboard } from "../convex/moodboards";
import { listProfiles, saveProfile } from "../convex/mjProfiles";
import { saveStory } from "../convex/stories";
import { setAssetFolders } from "../convex/assets";
import { updateFolder } from "../convex/folders";
import { countLearningEntries, normalizeWorldDocPath, worldDocCapError } from "../lib/world-docs";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { callAsOwner } from "./helpers/call-as-owner";

const realNow = Date.now;
let clock = 1_800_000_000_000;
beforeEach(() => { Date.now = () => (clock += 1000); });
afterEach(() => { Date.now = realNow; });

const owner = "owner";
const indexOrder = {
  "worldChanges.by_owner_world_createdAt": ["ownerUserId", "worldFolderId", "createdAt"],
  "worldChanges.by_owner_session_createdAt": ["ownerUserId", "session", "createdAt"],
  "worldChanges.by_owner_target_createdAt": ["ownerUserId", "targetId", "createdAt"],
  "moodboardItems.by_moodboard_position": ["moodboardId", "position"],
};

const setup = async () => {
  const { db, ctx } = createMockConvexMutationCtx({ indexOrder });
  const dear = await db.insert("folders", { ownerUserId: owner, name: "DEAR ANNETE", normalizedName: "dear annete", memberCount: 0 });
  const daddy = await db.insert("folders", { ownerUserId: owner, name: "DADDY ISSUES", normalizedName: "daddy issues", memberCount: 0 });
  const art = await db.insert("folders", { ownerUserId: owner, name: "ART", normalizedName: "art", memberCount: 0 });
  const film = await db.insert("folders", { ownerUserId: owner, name: "Film · Live Action", parentFolderId: dear, group: "Styles", memberCount: 0 });
  const places = await db.insert("folders", { ownerUserId: owner, name: "Canals", parentFolderId: dear, group: "Places", memberCount: 0 });
  const daddyCast = await db.insert("folders", { ownerUserId: owner, name: "Cast", parentFolderId: daddy, memberCount: 0 });
  await callAsOwner(markWorld)(ctx, { ownerUserId: owner, folderId: dear, worldKey: "dear-annete" });
  await callAsOwner(markWorld)(ctx, { ownerUserId: owner, folderId: daddy, worldKey: "daddy-issues" });
  const asset = async (...folderIds: string[]) => {
    const id = await db.insert("assets", { ownerUserId: owner, kind: "image", tagIds: [], createdAt: Date.now(), folderId: folderIds[0] });
    for (const folderId of folderIds) await db.insert("assetFolders", { ownerUserId: owner, assetId: id, folderId, createdAt: Date.now() });
    return id;
  };
  return { db, ctx, dear, daddy, art, film, places, daddyCast, asset };
};

const links = async (db: Awaited<ReturnType<typeof setup>>["db"], assetId: string) =>
  (await db.query("assetFolders").withIndex("by_asset", (q) => q.eq("assetId", assetId)).collect()).map((row) => row.folderId).sort();

describe("world doc rules", () => {
  test("paths normalize to WORLD.md, LEARNINGS.md or docs/<kebab>.md", () => {
    expect(normalizeWorldDocPath("world.md")).toBe("WORLD.md");
    expect(normalizeWorldDocPath("learnings.MD")).toBe("LEARNINGS.md");
    expect(normalizeWorldDocPath("Midjourney")).toBe("docs/midjourney.md");
    expect(normalizeWorldDocPath("docs/tags.md")).toBe("docs/tags.md");
    expect(normalizeWorldDocPath("../secrets")).toBeNull();
    expect(normalizeWorldDocPath("docs/a/b.md")).toBeNull();
  });

  test("caps refuse an overgrown WORLD.md, LEARNINGS.md or ninth doc", () => {
    expect(worldDocCapError("WORLD.md", "x".repeat(8_001), 0)).toContain("8000");
    expect(worldDocCapError("WORLD.md", "x".repeat(8_000), 0)).toBeNull();
    const learnings = Array.from({ length: 41 }, (_, i) => `- L-${i} · learned`).join("\n");
    expect(countLearningEntries(learnings)).toBe(41);
    expect(worldDocCapError("LEARNINGS.md", learnings, 0)).toContain("Promote");
    expect(worldDocCapError("docs/tags.md", "ok", 8)).toContain("at most 8");
  });
});

describe("worlds", () => {
  test("lists marked roots only and resolves a world by key, name or id", async () => {
    const { ctx, dear } = await setup();
    const worlds = await callAsOwner(listWorlds)(ctx, { ownerUserId: owner });
    expect(worlds.map((world) => world.key)).toEqual(["daddy-issues", "dear-annete"]);
    for (const ref of ["dear-annete", "DEAR ANNETE", dear]) {
      const context = await callAsOwner(getWorldContext)(ctx, { ownerUserId: owner, world: ref });
      expect(context.world.id).toBe(dear);
    }
    await expect(callAsOwner(getWorldContext)(ctx, { ownerUserId: owner, world: "ART" })).rejects.toThrow("No world matches");
  });

  test("a world doc is versioned, capped, journaled and undone", async () => {
    const { ctx } = await setup();
    const first = await callAsOwner(writeWorldDoc)(ctx, { ownerUserId: owner, world: "dear-annete", path: "world.md", body: "# DEAR ANNETE\n\nv1", actor: "agent:test", session: "s1" });
    expect(first).toMatchObject({ path: "WORLD.md", revision: 1, changed: true });
    await expect(callAsOwner(writeWorldDoc)(ctx, { ownerUserId: owner, world: "dear-annete", path: "WORLD.md", body: "v2", expectedRevision: 0 })).rejects.toThrow("changed");
    await callAsOwner(writeWorldDoc)(ctx, { ownerUserId: owner, world: "dear-annete", path: "WORLD.md", body: "# DEAR ANNETE\n\nv2", expectedRevision: 1, session: "s1" });
    await expect(callAsOwner(writeWorldDoc)(ctx, { ownerUserId: owner, world: "dear-annete", path: "WORLD.md", body: "v3" })).rejects.toThrow("expectedRevision");
    await expect(callAsOwner(writeWorldDoc)(ctx, { ownerUserId: owner, world: "dear-annete", path: "WORLD.md", body: "x".repeat(9_000), expectedRevision: 2 })).rejects.toThrow("capped");

    const history = await callAsOwner(worldDocHistory)(ctx, { ownerUserId: owner, world: "dear-annete", path: "WORLD.md" });
    expect(history.map((entry) => entry.revision)).toEqual([2, 1]);

    // A dry run reports through a rolled-back error (the mock has no rollback,
    // so it is checked on a copy of the state further down).
    await callAsOwner(undoWorldChanges)(ctx, { ownerUserId: owner, changeId: history[0].changeId });
    const restored = await callAsOwner(readWorldDoc)(ctx, { ownerUserId: owner, world: "dear-annete", path: "WORLD.md" });
    expect(restored?.body).toContain("v1");
    expect(restored?.revision).toBe(3);
    // The undo is journaled and itself undoable.
    const undoEntry = (await callAsOwner(listWorldChanges)(ctx, { ownerUserId: owner, world: "dear-annete" })).changes[0];
    expect(undoEntry.revertOf).toBe(history[0].changeId);
    await callAsOwner(undoWorldChanges)(ctx, { ownerUserId: owner, changeId: undoEntry.id });
    expect((await callAsOwner(readWorldDoc)(ctx, { ownerUserId: owner, world: "dear-annete", path: "WORLD.md" }))?.body).toContain("v2");
  });

  test("a session that edited one doc twice unwinds both edits", async () => {
    const { ctx } = await setup();
    await callAsOwner(writeWorldDoc)(ctx, { ownerUserId: owner, world: "dear-annete", path: "LEARNINGS.md", body: "- L-001 · a", session: "s2" });
    await callAsOwner(writeWorldDoc)(ctx, { ownerUserId: owner, world: "dear-annete", path: "LEARNINGS.md", body: "- L-001 · a\n- L-002 · b", expectedRevision: 1, session: "s2" });
    await callAsOwner(writeWorldDoc)(ctx, { ownerUserId: owner, world: "dear-annete", path: "docs/tags.md", body: "tags", session: "s2" });
    const result = await callAsOwner(undoWorldChanges)(ctx, { ownerUserId: owner, undoSession: "s2" });
    expect(result.undone).toHaveLength(3);
    expect(await callAsOwner(readWorldDoc)(ctx, { ownerUserId: owner, world: "dear-annete", path: "LEARNINGS.md" })).toBeNull();
  });

  test("a blocked session undo changes nothing and reports why", async () => {
    const { ctx } = await setup();
    await callAsOwner(writeWorldDoc)(ctx, { ownerUserId: owner, world: "dear-annete", path: "LEARNINGS.md", body: "- L-001 · a", session: "s3" });
    // Michael edits the learnings outside the session.
    await callAsOwner(writeWorldDoc)(ctx, { ownerUserId: owner, world: "dear-annete", path: "LEARNINGS.md", body: "- L-001 · a\n- L-002 · b", expectedRevision: 1 });
    const error = await callAsOwner(undoWorldChanges)(ctx, { ownerUserId: owner, undoSession: "s3" }).catch((caught: { data: unknown }) => caught);
    expect((error as { data: { kind: string; blocked: { reason: string }[] } }).data).toMatchObject({ kind: "world-undo-report", blocked: [{ reason: expect.stringContaining("changed since") }] });
  });

  test("an asset can never join a second world; move takes it out of the first", async () => {
    const { ctx, db, art, film, daddyCast, asset } = await setup();
    const piece = await asset(daddyCast, art);
    await expect(callAsOwner(fileWorldAssets)(ctx, { ownerUserId: owner, world: "dear-annete", assetIds: [piece], addTo: ["Film · Live Action"] }))
      .rejects.toThrow("two worlds");
    // The same guard covers the ordinary collection editor. (The mock has no
    // transaction rollback, so this uses its own asset.)
    const other = await asset(daddyCast);
    await expect(callAsOwner(setAssetFolders)(ctx, { ownerUserId: owner, assetId: other, folderIds: [daddyCast, film] })).rejects.toThrow("two worlds");
    // A plain move from one world to the other is allowed there, and journaled.
    await callAsOwner(setAssetFolders)(ctx, { ownerUserId: owner, assetId: other, folderIds: [film] });
    expect(await links(db, other)).toEqual([film]);
    const gallery = (await callAsOwner(listWorldChanges)(ctx, { ownerUserId: owner, world: "dear-annete" })).changes[0];
    expect(gallery).toMatchObject({ op: "assets.file", actor: "gallery" });
    expect(gallery.session).toMatch(/^auto:gallery:/);

    const moved = await callAsOwner(fileWorldAssets)(ctx, { ownerUserId: owner, world: "dear-annete", assetIds: [piece], addTo: ["Film · Live Action"], move: true, session: "move" });
    expect(moved.changed).toBe(1);
    expect(await links(db, piece)).toEqual([art, film].sort());

    await callAsOwner(undoWorldChanges)(ctx, { ownerUserId: owner, undoSession: "move" });
    expect(await links(db, piece)).toEqual([art, daddyCast].sort());
  });

  test("filing adds and removes shelves and tags in one change", async () => {
    const { ctx, db, dear, places, asset } = await setup();
    const piece = await asset(dear);
    const result = await callAsOwner(fileWorldAssets)(ctx, {
      ownerUserId: owner, world: "dear-annete", assetIds: [piece], addTo: ["Canals"], removeFrom: ["root"], addTags: ["canal", "night"], removeTags: ["never-existed"], createTags: true,
    });
    expect(result.results[0]).toMatchObject({ folders: ["Canals"], tags: 2, changed: true });
    expect(await links(db, piece)).toEqual([places]);
    // Removing an unknown tag never creates it.
    expect((await db.query("tags").collect()).map((tag) => tag.name).sort()).toEqual(["canal", "night"]);
    await callAsOwner(undoWorldChanges)(ctx, { ownerUserId: owner, changeId: result.changeId });
    expect(await links(db, piece)).toEqual([dear]);
    expect((await db.get(piece))?.tagIds).toEqual([]);
  });

  test("world_file files an asset into a storybook and keeps its shelf", async () => {
    const { ctx, db, dear, places, asset } = await setup();
    const book = (await callAsOwner(saveWorldShelf)(ctx, { ownerUserId: owner, world: "dear-annete", name: "Apocalypse Teaser", kind: "storybook" })).shelfId;
    const piece = await asset(places);
    await callAsOwner(fileWorldAssets)(ctx, { ownerUserId: owner, world: "dear-annete", assetIds: [piece], addTo: ["Apocalypse Teaser"] });
    expect(await links(db, piece)).toEqual([places, book].sort());
    void dear;
  });

  test("storybooks are children of their world; a stray root storybook is brought in and can go back", async () => {
    const { ctx, db, dear } = await setup();
    const created = await callAsOwner(saveWorldShelf)(ctx, { ownerUserId: owner, world: "dear-annete", name: "Ten to Closing", kind: "storybook" });
    const book = await db.get(created.shelfId);
    expect(book).toMatchObject({ kind: "storybook", parentFolderId: dear, group: "Storybooks" });

    const stray = await db.insert("folders", { ownerUserId: owner, name: "DEAR ANNETE · Lens Cap", normalizedName: "dear annete · lens cap", kind: "storybook" });
    const moved = await callAsOwner(saveWorldShelf)(ctx, { ownerUserId: owner, world: "dear-annete", shelf: stray, name: "Lens Cap" });
    expect(await db.get(stray)).toMatchObject({ parentFolderId: dear, name: "Lens Cap", group: "Storybooks" });
    const context = await callAsOwner(getWorldContext)(ctx, { ownerUserId: owner, world: "dear-annete" });
    expect(context.storybooks.map((entry) => entry.name).sort()).toEqual(["Lens Cap", "Ten to Closing"]);

    await callAsOwner(undoWorldChanges)(ctx, { ownerUserId: owner, changeId: moved.changeId });
    const back = await db.get(stray);
    expect(back?.parentFolderId).toBeUndefined();
    expect(back?.name).toBe("DEAR ANNETE · Lens Cap");
    // An empty shelf created by mistake is removed by undo.
    await callAsOwner(undoWorldChanges)(ctx, { ownerUserId: owner, changeId: created.changeId });
    expect(await db.get(created.shelfId)).toBeNull();
  });

  test("a shelf never moves into another world and a world never nests", async () => {
    const { ctx, dear, daddy, places } = await setup();
    await expect(callAsOwner(updateFolder)(ctx, { ownerUserId: owner, folderId: places, parentFolderId: daddy })).rejects.toThrow("another world");
    await expect(callAsOwner(updateFolder)(ctx, { ownerUserId: owner, folderId: daddy, parentFolderId: dear })).rejects.toThrow("stays a root");
  });

  test("a moodboard only takes pieces of its world and every edit can be undone", async () => {
    const { ctx, db, film, art, daddyCast, asset } = await setup();
    const board = await callAsOwner(createMoodboard)(ctx, { ownerUserId: owner, folderId: film, name: "DA FILM · Golden", session: "mb" });
    const own = await asset(film);
    const reference = await asset(art);
    const foreign = await asset(daddyCast);
    await expect(callAsOwner(addMoodboardItems)(ctx, { ownerUserId: owner, moodboardId: board.moodboardId, assetIds: [foreign] })).rejects.toThrow("only takes pieces of its own world");
    await callAsOwner(addMoodboardItems)(ctx, { ownerUserId: owner, moodboardId: board.moodboardId, assetIds: [own, reference], session: "mb" });
    await callAsOwner(deleteMoodboard)(ctx, { ownerUserId: owner, moodboardId: board.moodboardId, session: "mb2" });
    expect(await db.get(board.moodboardId)).toBeNull();

    // Undo the delete: the board comes back with its items, in order.
    await callAsOwner(undoWorldChanges)(ctx, { ownerUserId: owner, undoSession: "mb2" });
    const context = await callAsOwner(getWorldContext)(ctx, { ownerUserId: owner, world: "dear-annete" });
    expect(context.moodboards).toHaveLength(1);
    expect(context.moodboards[0]).toMatchObject({ name: "DA FILM · Golden", itemCount: 2, collection: "Film · Live Action" });
  });

  test("profiles are owner records with a role per world, journaled where saved", async () => {
    const { ctx } = await setup();
    const dari = await callAsOwner(saveProfile)(ctx, { ownerUserId: owner, world: "dear-annete", name: "DARI", code: "h2eu2z6", role: "Magenta concept-art taste", styleTag: "da-film" });
    await callAsOwner(saveProfile)(ctx, { ownerUserId: owner, world: "daddy-issues", profile: "DARI", role: "Warm faces" });
    const updated = await callAsOwner(saveProfile)(ctx, { ownerUserId: owner, world: "dear-annete", profile: "h2eu2z6", code: "newcode1", codeNote: "re-ranked" });
    const dear = await callAsOwner(listProfiles)(ctx, { ownerUserId: owner, world: "dear-annete" });
    expect(dear[0]).toMatchObject({ code: "newcode1", flag: "--profile newcode1", uses: [{ world: "dear-annete", role: "Magenta concept-art taste", styleTag: "da-film" }] });
    expect(dear[0].codeHistory.map((entry) => entry.code)).toEqual(["h2eu2z6"]);
    const context = await callAsOwner(getWorldContext)(ctx, { ownerUserId: owner, world: "daddy-issues" });
    expect(context.profiles).toEqual([expect.objectContaining({ name: "DARI", role: "Warm faces" })]);
    await callAsOwner(undoWorldChanges)(ctx, { ownerUserId: owner, changeId: updated.changeId! });
    expect((await callAsOwner(listProfiles)(ctx, { ownerUserId: owner, world: "dear-annete" }))[0].code).toBe("h2eu2z6");
    expect(dari.created).toBe(true);
  });

  test("a story stays inside one world: its storybook and new asset links", async () => {
    const { ctx, db, dear, film, daddy, daddyCast, asset } = await setup();
    const book = (await callAsOwner(saveWorldShelf)(ctx, { ownerUserId: owner, world: "dear-annete", name: "Two Pears", kind: "storybook" })).shelfId;
    const foreign = await asset(daddyCast);
    const base = { ownerUserId: owner, title: "Two Pears", body: "Beat one.", kind: "script", status: "draft", tagNames: [] };
    await expect(callAsOwner(saveStory)(ctx, { ...base, ingestKey: "a", folderId: daddy, storybookId: book, assetIds: [] })).rejects.toThrow("same world");
    await expect(callAsOwner(saveStory)(ctx, { ...base, ingestKey: "b", folderId: film, storybookId: book, assetIds: [foreign] })).rejects.toThrow("not to DEAR ANNETE");
    const saved = await callAsOwner(saveStory)(ctx, { ...base, ingestKey: "c", folderId: film, storybookId: book, assetIds: [await asset(film)], session: "story" });
    expect(saved.created).toBe(true);
    const context = await callAsOwner(getWorldContext)(ctx, { ownerUserId: owner, world: dear });
    expect(context.storybooks[0].stories.map((story) => story.title)).toEqual(["Two Pears"]);
    // Undoing a created story archives it; text is never deleted.
    await callAsOwner(undoWorldChanges)(ctx, { ownerUserId: owner, undoSession: "story" });
    expect((await db.get(saved.id))?.status).toBe("archived");
  });
});
