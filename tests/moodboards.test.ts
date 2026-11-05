import { describe, expect, test } from "bun:test";
import schema from "../convex/schema";
import { moodboardDocValidator } from "../convex/moodboardValidators";
import {
  addMoodboardItems, createMoodboard, deleteMoodboard, detachAssetFromMoodboards, getMoodboard,
  listMoodboardGenerations, listMoodboards, listMoodboardsForAsset, removeMoodboardItems,
  reorderMoodboardItems, setMoodboardMidjourney, updateMoodboard,
} from "../convex/moodboards";
import { internalDeleteAsset } from "../convex/assets";
import { deleteFolder } from "../convex/folders";
import {
  cleanMidjourneyCode, cleanMidjourneyMoodboardId, mentionsMidjourneyTerm, moodboardAgentRequest,
  moodboardSearchTerms, moodboardSyncState, normalizeMoodboardStyleTag,
} from "../lib/moodboards";
import { moodboardExportFileName } from "../lib/moodboard-export";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { callAsOwner } from "./helpers/call-as-owner";

const OWNER = "owner";

const setup = async () => {
  const { db, ctx } = createMockConvexMutationCtx({
    indexOrder: {
      "moodboardItems.by_moodboard_position": ["moodboardId", "position"],
      "moodboards.by_owner_updatedAt": ["ownerUserId", "updatedAt"],
    },
  });
  const world = await db.insert("folders", { ownerUserId: OWNER, name: "DEAR ANNETE", normalizedName: "dear annete" });
  const styles = await db.insert("folders", { ownerUserId: OWNER, name: "DA FILM", normalizedName: "x/da film", parentFolderId: world, group: "Styles", sortOrder: 1 });
  const places = await db.insert("folders", { ownerUserId: OWNER, name: "Tram depot", normalizedName: "x/tram depot", parentFolderId: world, group: "Places" });
  const asset = (fields: Record<string, unknown> = {}) =>
    db.insert("assets", { ownerUserId: OWNER, kind: "image", tagIds: [], createdAt: Date.now(), width: 1200, height: 800, ...fields });
  const call = <F extends Parameters<typeof callAsOwner>[0]>(fn: F, args: Record<string, unknown>) =>
    callAsOwner(fn)(ctx, { ownerUserId: OWNER, ...args });
  return { db, ctx, world, styles, places, asset, call };
};

describe("moodboard helpers", () => {
  test("codes, ids and style tags are cleaned but kept as given", () => {
    expect(cleanMidjourneyCode(" --profile 88ji6bg ")).toBe("88ji6bg");
    expect(cleanMidjourneyCode("--p 0042ab")).toBe("0042ab");
    expect(cleanMidjourneyMoodboardId("m7510337594627371941")).toBe("7510337594627371941");
    expect(cleanMidjourneyMoodboardId("--profile m7510337594627371941")).toBe("7510337594627371941");
    expect(cleanMidjourneyMoodboardId("moodboard-x")).toBe("moodboard-x");
    expect(normalizeMoodboardStyleTag(" DA Film_Look ")).toBe("da-film-look");
    expect(moodboardSearchTerms({ mjCode: "99zz", mjMoodboardId: "751", mjCodeHistory: [{ code: "11aa" }, { code: "88ji6bg" }] }))
      .toEqual(["99zz", "m751", "88ji6bg", "11aa"]);
    expect(mentionsMidjourneyTerm("a tram at dusk --profile 88ji6bg --v 8", "88ji6bg")).toBe(true);
    expect(mentionsMidjourneyTerm("a tram --profile 88ji6bgx", "88ji6bg")).toBe(false);
  });

  test("sync state counts what changed since the last recorded sync", () => {
    const board = { status: "in-midjourney" as const, mjCode: "88ji6bg", mjSyncedAt: 100, mjSyncedItemCount: 4, itemCount: 5 };
    expect(moodboardSyncState(board, [10, 20, 30, 150, 160])).toMatchObject({ synced: true, addedSince: 2, removedSince: 1, upToDate: false });
    expect(moodboardSyncState({ ...board, mjSyncedItemCount: 5, itemCount: 5 }, [10, 20, 30, 40, 50])).toMatchObject({ upToDate: true, addedSince: 0 });
    expect(moodboardSyncState({ status: "draft", itemCount: 3 }, [1, 2, 3])).toMatchObject({ inMidjourney: false, synced: false, addedSince: 0 });
  });

  test("the agent request names the board and the tools that close the loop", () => {
    const fresh = moodboardAgentRequest({ id: "moodboards:1", name: "DA FILM · Golden", itemCount: 12 });
    expect(fresh).toContain("moodboard:moodboards:1");
    expect(fresh).toContain("get_moodboard");
    expect(fresh).toContain("set_moodboard_midjourney");
    expect(fresh).toContain('create a Midjourney moodboard titled "DA FILM · Golden"');
    const synced = moodboardAgentRequest({ id: "b1", name: "Night", itemCount: 1, mjCode: "88ji6bg", mjMoodboardId: "751" });
    expect(synced).toContain("update the existing Midjourney moodboard 751");
    expect(synced).toContain("1 image");
  });

  test("zip entries are numbered in board order with the served extension", () => {
    expect(moodboardExportFileName(0, { assetId: "assets:abcdef123456", kind: "image", fileName: "Dari Golden Hour.png" }, "image/jpeg", "Dari Golden Hour.jpg"))
      .toBe("01-dari-golden-hour.jpg");
    expect(moodboardExportFileName(11, { assetId: "assets:abcdef123456", kind: "image" }, "image/png")).toBe("12-ef123456.png");
  });
});

describe("moodboards backend", () => {
  test("the table and its return validator stay in step", () => {
    const table = (schema as unknown as { tables: Record<string, { validator: { fields: Record<string, { json: unknown }> } }> }).tables.moodboards;
    const { _id, _creationTime, ...docFields } = moodboardDocValidator.fields;
    expect(_id && _creationTime).toBeTruthy();
    expect(Object.keys(docFields).sort()).toEqual(Object.keys(table.validator.fields).sort());
    for (const [name, validator] of Object.entries(table.validator.fields)) {
      expect(JSON.stringify((docFields as Record<string, { json: unknown }>)[name].json)).toBe(JSON.stringify(validator.json));
    }
  });

  test("create is idempotent per collection and only fills empty fields on a retry", async () => {
    const { world, styles, call } = await setup();
    const first = await call(createMoodboard, { folderId: styles, name: "DA FILM · Golden", styleTag: "DA Film" });
    expect(first).toMatchObject({ created: true, revision: 1 });
    const retry = await call(createMoodboard, { folderId: styles, name: "  da film ·  golden ", description: "Warm 35mm exteriors", styleTag: "other" });
    expect(retry).toMatchObject({ moodboardId: first.moodboardId, created: false, revision: 2 });
    const again = await call(createMoodboard, { folderId: styles, name: "DA FILM · Golden", description: "Overwrite attempt" });
    expect(again).toMatchObject({ created: false, revision: 2 });
    const read = await call(getMoodboard, { moodboardId: first.moodboardId });
    expect(read.moodboard).toMatchObject({ styleTag: "da-film", description: "Warm 35mm exteriors", status: "draft", itemCount: 0 });
    expect(read.folderName).toBe("DA FILM");
    expect(read.parentFolderName).toBe("DEAR ANNETE");

    const elsewhere = await call(createMoodboard, { folderId: world, name: "DA FILM · Golden" });
    expect(elsewhere.created).toBe(true);
    expect(elsewhere.moodboardId).not.toBe(first.moodboardId);
    const known = await call(createMoodboard, { folderId: world, name: "Night", mjCode: "--profile 88ji6bg" });
    expect((await call(getMoodboard, { moodboardId: known.moodboardId })).moodboard).toMatchObject({ mjCode: "88ji6bg", status: "in-midjourney" });
  });

  test("boards belong to owned plain collections and validate their fields", async () => {
    const { db, styles, call } = await setup();
    const book = await db.insert("folders", { ownerUserId: OWNER, name: "EP01", normalizedName: "ep01", kind: "storybook" });
    const theirs = await db.insert("folders", { ownerUserId: "other", name: "Theirs", normalizedName: "theirs" });
    await expect(call(createMoodboard, { folderId: book, name: "X" })).rejects.toThrow("not a storybook");
    await expect(call(createMoodboard, { folderId: theirs, name: "X" })).rejects.toThrow("Collection not found");
    await expect(call(createMoodboard, { folderId: styles, name: "  " })).rejects.toThrow("needs a name");
    await expect(call(createMoodboard, { folderId: styles, name: "X", styleTag: "da film!" })).rejects.toThrow("style tag");
    await expect(call(createMoodboard, { folderId: styles, name: "X", mjUrl: "ftp://mj" })).rejects.toThrow("http or https");
    await expect(call(createMoodboard, { folderId: styles, name: "x".repeat(121) })).rejects.toThrow("120 characters");
  });

  test("items append in order, skip duplicates and stay owner-checked", async () => {
    const { db, styles, asset, call } = await setup();
    const tag = await db.insert("tags", { name: "da-film", normalized: "da-film", usageCount: 1, category: "style", source: "agent" });
    const prompt = await db.insert("prompts", { ownerUserId: OWNER, text: "Dari at the tram stop, golden hour --profile 88ji6bg", tagIds: [], createdAt: 1 });
    const [a, b, c] = [await asset({ tagIds: [tag], promptId: prompt, agentDescription: "Dari at dusk" }), await asset(), await asset({ kind: "video" })];
    const theirs = await asset({ ownerUserId: "other" });
    const board = (await call(createMoodboard, { folderId: styles, name: "Golden" })).moodboardId;

    const first = await call(addMoodboardItems, { moodboardId: board, assetIds: [a, b] });
    expect(first).toMatchObject({ added: [a, b], skipped: [], itemCount: 2, revision: 2 });
    const second = await call(addMoodboardItems, { moodboardId: board, assetIds: [b, c, c], note: "night pass" });
    expect(second).toMatchObject({ added: [c], skipped: [b], itemCount: 3 });
    const noop = await call(addMoodboardItems, { moodboardId: board, assetIds: [a] });
    expect(noop).toMatchObject({ added: [], skipped: [a], revision: second.revision });
    await expect(call(addMoodboardItems, { moodboardId: board, assetIds: [theirs] })).rejects.toThrow("Asset not found");
    await expect(call(addMoodboardItems, { moodboardId: board, assetIds: [] })).rejects.toThrow("at least one");
    await expect(call(addMoodboardItems, { moodboardId: board, assetIds: Array.from({ length: 101 }, () => a) })).rejects.toThrow("at most 100");

    const read = await call(getMoodboard, { moodboardId: board });
    expect(read.moodboard.coverAssetId).toBe(a);
    expect(read.items.map((item) => [item.assetId, item.position])).toEqual([[a, 0], [b, 1], [c, 2]]);
    expect(read.items[0]).toMatchObject({ tagNames: ["da-film"], agentDescription: "Dari at dusk", width: 1200, kind: "image" });
    expect(read.items[0].promptText).toContain("--profile 88ji6bg");
    expect(read.items[2]).toMatchObject({ kind: "video", note: "night pass" });
    expect((await call(listMoodboardsForAsset, { assetId: b })).map((row) => row.name)).toEqual(["Golden"]);

    await db.delete(b);
    const gone = await call(getMoodboard, { moodboardId: board });
    expect(gone.missingAssetIds).toEqual([b]);
    expect(gone.items).toHaveLength(2);
  });

  test("reorder takes the full current set only; appends land after the new last item", async () => {
    const { styles, asset, call } = await setup();
    const [a, b, c, d] = [await asset(), await asset(), await asset(), await asset()];
    const board = (await call(createMoodboard, { folderId: styles, name: "Golden" })).moodboardId;
    await call(addMoodboardItems, { moodboardId: board, assetIds: [a, b, c] });
    await expect(call(reorderMoodboardItems, { moodboardId: board, assetIds: [c, a] })).rejects.toThrow("full order");
    await expect(call(reorderMoodboardItems, { moodboardId: board, assetIds: [c, a, d] })).rejects.toThrow("full order");
    await expect(call(reorderMoodboardItems, { moodboardId: board, assetIds: [c, a, a] })).rejects.toThrow("once");
    const moved = await call(reorderMoodboardItems, { moodboardId: board, assetIds: [c, a, b] });
    expect(moved.moved).toBe(3);
    const same = await call(reorderMoodboardItems, { moodboardId: board, assetIds: [c, a, b] });
    expect(same).toMatchObject({ moved: 0, revision: moved.revision });
    await call(addMoodboardItems, { moodboardId: board, assetIds: [d] });
    expect((await call(getMoodboard, { moodboardId: board })).items.map((item) => item.assetId)).toEqual([c, a, b, d]);
  });

  test("remove drops items, fixes the count and falls the cover back to the first item", async () => {
    const { styles, asset, call } = await setup();
    const [a, b, c, stray] = [await asset(), await asset(), await asset(), await asset()];
    const board = (await call(createMoodboard, { folderId: styles, name: "Golden" })).moodboardId;
    await call(addMoodboardItems, { moodboardId: board, assetIds: [a, b, c] });
    await call(updateMoodboard, { moodboardId: board, coverAssetId: b });
    const removed = await call(removeMoodboardItems, { moodboardId: board, assetIds: [b, stray] });
    expect(removed).toMatchObject({ removed: 1, itemCount: 2 });
    const read = await call(getMoodboard, { moodboardId: board });
    expect(read.moodboard.coverAssetId).toBe(a);
    expect(read.items.map((item) => item.assetId)).toEqual([a, c]);
    const none = await call(removeMoodboardItems, { moodboardId: board, assetIds: [stray] });
    expect(none).toMatchObject({ removed: 0, revision: removed.revision });
  });

  test("a recorded sync keeps the code history and sets the board in Midjourney", async () => {
    const { styles, asset, call } = await setup();
    const board = (await call(createMoodboard, { folderId: styles, name: "Golden" })).moodboardId;
    await call(addMoodboardItems, { moodboardId: board, assetIds: [await asset(), await asset()] });
    await expect(call(setMoodboardMidjourney, { moodboardId: board })).rejects.toThrow("code or moodboard id");
    const first = await call(setMoodboardMidjourney, { moodboardId: board, mjCode: "--profile 88ji6bg", mjMoodboardId: "m7510337594627371941", mjUrl: "https://www.midjourney.com/moodboards/751" });
    expect(first).toMatchObject({ status: "in-midjourney", mjCode: "88ji6bg", mjMoodboardId: "7510337594627371941", mjSyncedItemCount: 2, previousCode: undefined });
    await call(setMoodboardMidjourney, { moodboardId: board, mjCode: "88ji6bg" });
    const changed = await call(setMoodboardMidjourney, { moodboardId: board, mjCode: "99zz1ab", syncedItemCount: 1, note: "Rebuilt after removals" });
    expect(changed).toMatchObject({ mjCode: "99zz1ab", previousCode: "88ji6bg", mjSyncedItemCount: 1 });
    const read = await call(getMoodboard, { moodboardId: board });
    expect(read.moodboard.mjCodeHistory?.map((entry) => [entry.code, entry.note])).toEqual([["88ji6bg", "Rebuilt after removals"]]);
    expect(read.moodboard.mjUrl).toBe("https://www.midjourney.com/moodboards/751");
    await expect(call(setMoodboardMidjourney, { moodboardId: board, mjCode: "88 ji" })).rejects.toThrow("one token");
  });

  test("updates guard the revision, keep names unique per collection and move boards", async () => {
    const { styles, places, asset, call } = await setup();
    const golden = (await call(createMoodboard, { folderId: styles, name: "Golden", description: "Warm" })).moodboardId;
    await call(createMoodboard, { folderId: styles, name: "Night" });
    await call(createMoodboard, { folderId: places, name: "Golden" });
    await expect(call(updateMoodboard, { moodboardId: golden, expectedRevision: 9, name: "x" })).rejects.toThrow("Reload");
    await expect(call(updateMoodboard, { moodboardId: golden, name: "night" })).rejects.toThrow("already has a moodboard");
    await expect(call(updateMoodboard, { moodboardId: golden, folderId: places })).rejects.toThrow("already has a moodboard");
    await expect(call(updateMoodboard, { moodboardId: golden, coverAssetId: await asset() })).rejects.toThrow("must be an image on this moodboard");
    const same = await call(updateMoodboard, { moodboardId: golden, expectedRevision: 1, description: "Warm" });
    expect(same.revision).toBe(1);
    const edited = await call(updateMoodboard, { moodboardId: golden, expectedRevision: 1, name: "Golden hour", description: null, status: "archived", mjCode: "88ji6bg" });
    expect(edited.revision).toBe(2);
    await call(updateMoodboard, { moodboardId: golden, mjCode: "99zz" });
    const moved = await call(updateMoodboard, { moodboardId: golden, folderId: places });
    expect(moved.revision).toBe(4);
    const read = await call(getMoodboard, { moodboardId: golden });
    expect(read.moodboard).toMatchObject({ name: "Golden hour", status: "archived", folderId: places, mjCode: "99zz" });
    expect(read.moodboard.description).toBeUndefined();
    expect(read.moodboard.mjSyncedAt).toBeUndefined();
    expect(read.moodboard.mjCodeHistory?.map((entry) => entry.code)).toEqual(["88ji6bg"]);

    // A draft that gets its first code by hand reads as in Midjourney.
    const night = (await call(createMoodboard, { folderId: styles, name: "Night owls" })).moodboardId;
    await call(updateMoodboard, { moodboardId: night, mjCode: "41kq7zz" });
    expect((await call(getMoodboard, { moodboardId: night })).moodboard).toMatchObject({ status: "in-midjourney", mjCode: "41kq7zz" });
    expect((await call(getMoodboard, { moodboardId: night })).moodboard.mjSyncedAt).toBeUndefined();
  });

  test("lists a world's boards child by child, previews cover first, archived on request", async () => {
    const { world, styles, places, asset, call } = await setup();
    const [a, b, c] = [await asset(), await asset(), await asset()];
    const root = (await call(createMoodboard, { folderId: world, name: "World look" })).moodboardId;
    const golden = (await call(createMoodboard, { folderId: styles, name: "Golden" })).moodboardId;
    const depot = (await call(createMoodboard, { folderId: places, name: "Depot" })).moodboardId;
    await call(addMoodboardItems, { moodboardId: golden, assetIds: [a, b, c] });
    await call(updateMoodboard, { moodboardId: golden, coverAssetId: c });
    await call(updateMoodboard, { moodboardId: depot, status: "archived" });

    const rows = await call(listMoodboards, { folderId: world, includeChildren: true });
    expect(rows.map((row) => row._id)).toEqual([root, golden]);
    expect(rows[1]).toMatchObject({ folderName: "DA FILM", folderGroup: "Styles", parentFolderId: world });
    expect(rows[1].previewItems.map((item) => item.assetId)).toEqual([c, a, b]);
    expect((await call(listMoodboards, { folderId: world })).map((row) => row._id)).toEqual([root]);
    expect((await call(listMoodboards, { folderId: world, includeChildren: true, includeArchived: true })).map((row) => row._id)).toEqual([root, golden, depot]);
    expect((await call(listMoodboards, { status: "archived" })).map((row) => row._id)).toEqual([depot]);
    expect((await call(listMoodboards, { folderId: styles, previewLimit: 0 }))[0].previewItems).toEqual([]);
    expect(await call(listMoodboards, { folderId: "folders:999" })).toEqual([]);
  });

  test("made with this board finds prompts carrying the code, earlier codes or m<id>", async () => {
    const { db, styles, asset, call } = await setup();
    const prompt = (text: string, ownerUserId = OWNER) => db.insert("prompts", { ownerUserId, text, tagIds: [], createdAt: 1 });
    const [now, old, byId, near, foreign] = [
      await prompt("tram at dusk --profile 99zz1ab --v 8"),
      await prompt("rain on brass --p 88ji6bg"),
      await prompt("ivory lace --profile m7510337594627371941"),
      await prompt("almost --profile 99zz1abc"),
      await prompt("theirs --profile 99zz1ab", "other"),
    ];
    const made = await asset({ promptId: now, createdAt: 30 });
    const older = await asset({ promptId: old, createdAt: 10 });
    const viaId = await asset({ promptId: byId, createdAt: 20 });
    await asset({ promptId: near, createdAt: 40 });
    await asset({ ownerUserId: "other", promptId: foreign, createdAt: 50 });
    const board = (await call(createMoodboard, { folderId: styles, name: "Golden" })).moodboardId;
    expect(await call(listMoodboardGenerations, { moodboardId: board })).toEqual({ terms: [], assets: [] });
    await call(setMoodboardMidjourney, { moodboardId: board, mjCode: "88ji6bg" });
    await call(setMoodboardMidjourney, { moodboardId: board, mjCode: "99zz1ab", mjMoodboardId: "7510337594627371941" });
    await call(addMoodboardItems, { moodboardId: board, assetIds: [older] });
    const result = await call(listMoodboardGenerations, { moodboardId: board });
    expect(result.terms).toEqual(["99zz1ab", "m7510337594627371941", "88ji6bg"]);
    expect(result.assets.map((entry) => [entry.assetId, entry.matchedTerm, entry.onBoard])).toEqual([
      [made, "99zz1ab", false], [viaId, "m7510337594627371941", false], [older, "88ji6bg", true],
    ]);
    expect((await call(listMoodboardGenerations, { moodboardId: board, limit: 1 })).assets).toHaveLength(1);
  });

  test("deleting an asset takes it off every board with an exact count and a live cover", async () => {
    const { ctx, styles, places, asset, call } = await setup();
    const [a, b] = [await asset(), await asset()];
    const golden = (await call(createMoodboard, { folderId: styles, name: "Golden" })).moodboardId;
    const depot = (await call(createMoodboard, { folderId: places, name: "Depot" })).moodboardId;
    await call(addMoodboardItems, { moodboardId: golden, assetIds: [a, b] });
    await call(addMoodboardItems, { moodboardId: depot, assetIds: [a] });

    await callAsOwner(internalDeleteAsset)({ ...ctx, runMutation: async () => null }, { id: a });
    const read = await call(getMoodboard, { moodboardId: golden });
    expect(read.moodboard).toMatchObject({ itemCount: 1, coverAssetId: b });
    expect(read.items.map((item) => item.assetId)).toEqual([b]);
    const emptied = await call(getMoodboard, { moodboardId: depot });
    expect(emptied.moodboard.itemCount).toBe(0);
    expect(emptied.moodboard.coverAssetId).toBeUndefined();

    await detachAssetFromMoodboards(ctx as never, b as never);
    expect((await call(getMoodboard, { moodboardId: golden })).moodboard.itemCount).toBe(0);
  });

  test("deleting a child collection moves its boards to the world; a root's boards go", async () => {
    const { db, world, styles, asset, call } = await setup();
    const a = await asset();
    const golden = (await call(createMoodboard, { folderId: styles, name: "Golden" })).moodboardId;
    const clash = (await call(createMoodboard, { folderId: styles, name: "World look" })).moodboardId;
    const root = (await call(createMoodboard, { folderId: world, name: "World look" })).moodboardId;
    await call(addMoodboardItems, { moodboardId: golden, assetIds: [a] });

    await call(deleteFolder, { folderId: styles });
    const moved = await call(getMoodboard, { moodboardId: golden });
    expect(moved.moodboard.folderId).toBe(world);
    expect(moved.items.map((item) => item.assetId)).toEqual([a]);
    expect((await call(getMoodboard, { moodboardId: clash })).moodboard).toMatchObject({ folderId: world, name: "World look · DA FILM" });

    await call(deleteFolder, { folderId: world });
    expect(await db.get(root)).toBeNull();
    expect(await db.get(golden)).toBeNull();
    expect(db.getTableDocs("moodboardItems")).toHaveLength(0);
    expect(await db.get(a)).not.toBeNull();
  });

  test("delete removes the board and its items, keeps the assets and is safe to repeat", async () => {
    const { db, styles, asset, call } = await setup();
    const a = await asset();
    const board = (await call(createMoodboard, { folderId: styles, name: "Golden" })).moodboardId;
    await call(addMoodboardItems, { moodboardId: board, assetIds: [a] });
    expect(await call(deleteMoodboard, { moodboardId: board })).toEqual({ deleted: true, removedItems: 1 });
    expect(await call(deleteMoodboard, { moodboardId: board })).toEqual({ deleted: false, removedItems: 0 });
    expect(db.getTableDocs("moodboardItems")).toHaveLength(0);
    expect(await db.get(a)).not.toBeNull();
  });

  test("private to the signed owner", async () => {
    const { ctx, styles, call } = await setup();
    const board = (await call(createMoodboard, { folderId: styles, name: "Golden" })).moodboardId;
    await expect(callAsOwner(listMoodboards)({ ...ctx, auth: { getUserIdentity: async () => null } }, { ownerUserId: OWNER })).rejects.toThrow("Not authenticated");
    const stranger = { ...ctx, auth: { getUserIdentity: async () => ({ subject: "other" }) } };
    await expect(callAsOwner(getMoodboard)(stranger, { ownerUserId: "", moodboardId: board })).rejects.toThrow("Moodboard not found");
    await expect(callAsOwner(deleteMoodboard)(stranger, { ownerUserId: "", moodboardId: board })).rejects.toThrow("Moodboard not found");
    expect(await callAsOwner(listMoodboards)(stranger, { ownerUserId: "" })).toEqual([]);
  });
});
