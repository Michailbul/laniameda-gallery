import { describe, expect, test } from "bun:test";
import schema from "../convex/schema";
import { inboxStackDocValidator } from "../convex/inboxValidators";
import {
  clearInboxDecision, closeInboxStack, decideInboxCard, deleteInboxStack, getInboxStack, listInboxDecisions,
  listInboxNotes, listInboxStacks, listInboxWorlds, postInboxCards, recordInboxDeletions, setInboxCardComment,
} from "../convex/inbox";
import { addAssetComment, deleteAssetComment, listAssetComments } from "../convex/assetComments";
import { syncPromptAssetPack } from "../convex/assetPackHelpers";
import { bareInboxRef, clampBox, inboxCaption, inboxProgress, nextOpenIndex, shortAssetId } from "../lib/inbox";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { callAsOwner } from "./helpers/call-as-owner";

const OWNER = "owner";
type AnyDoc = Record<string, unknown> & { _id: string };

const setup = async () => {
  const { db, ctx } = createMockConvexMutationCtx({
    indexOrder: {
      "moodboardItems.by_moodboard_position": ["moodboardId", "position"],
      "inboxCards.by_stack_position": ["stackId", "position"],
      "inboxStacks.by_world_status_createdAt": ["worldFolderId", "status", "createdAt"],
      "inboxStacks.by_owner_status_createdAt": ["ownerUserId", "status", "createdAt"],
      "assetComments.by_asset_createdAt": ["assetId", "createdAt"],
    },
  });
  (ctx.db as unknown as { system: { get: (id: string) => Promise<unknown> } }).system = { get: (id: string) => db.get(id) };
  const world = await db.insert("folders", { ownerUserId: OWNER, name: "DEAR ANNETE", normalizedName: "dear annete" });
  const film = await db.insert("folders", { ownerUserId: OWNER, name: "Film · Live Action", normalizedName: "x/film", parentFolderId: world });
  const other = await db.insert("folders", { ownerUserId: OWNER, name: "ANDROMEDA", normalizedName: "andromeda" });
  const golden = await db.insert("moodboards", {
    ownerUserId: OWNER, folderId: world, name: "DA FILM · Golden", normalizedName: "da film · golden",
    status: "draft", itemCount: 0, revision: 1, createdAt: 1, updatedAt: 1,
  });
  const asset = (fields: Record<string, unknown> = {}) =>
    db.insert("assets", { ownerUserId: OWNER, kind: "image", tagIds: [], createdAt: Date.now(), width: 1600, height: 900, ...fields });
  const call = <F extends Parameters<typeof callAsOwner>[0]>(fn: F, args: Record<string, unknown>) =>
    callAsOwner(fn)(ctx, { ownerUserId: OWNER, ...args });
  const stranger = <F extends Parameters<typeof callAsOwner>[0]>(fn: F, args: Record<string, unknown>) =>
    callAsOwner(fn)(ctx, { ownerUserId: "stranger", ...args });
  const doc = async (id: string) => (await db.get(id)) as AnyDoc;
  const upload = (contentType = "audio/webm;codecs=opus", size = 40_000) => db.insert("_storage", { size, contentType });
  const post = (cards: unknown[], extra: Record<string, unknown> = {}) =>
    call(postInboxCards, { worldFolderId: world, stackTitle: "Test stack", cards, ...extra });
  return { db, ctx, world, film, other, golden, asset, call, stranger, doc, upload, post };
};

const sortTargets = (env: Awaited<ReturnType<typeof setup>>) => [
  { kind: "moodboard", moodboardId: env.golden },
  { kind: "collection", folderId: env.film },
  { kind: "option", label: "Neither" },
  { kind: "out" },
];

describe("inbox helpers", () => {
  test("next open card, progress, captions, refs and boxes", () => {
    const ids = ["a", "b", "c"];
    const decided = new Map([["b", { cardId: "b", choice: "skip" as const }]]);
    expect(nextOpenIndex(ids, decided, 0)).toBe(2);
    expect(nextOpenIndex(ids, decided, 2)).toBe(0);
    expect(inboxProgress(ids, [{ cardId: "a", choice: "keep" }, { cardId: "b", choice: "skip" }, { cardId: "c" }]))
      .toEqual({ total: 3, decided: 2, skipped: 1, pending: 1 });
    expect(inboxCaption({ agentDescription: "Dari on the tram at dusk. Kept for light." })).toBe("Dari on the tram at dusk.");
    expect(shortAssetId("k57abc123456")).toBe("123456");
    expect(bareInboxRef("stack:s1")).toBe("s1");
    expect(bareInboxRef("card:c9")).toBe("c9");
    expect(clampBox({ x: -0.2, y: 0.5, w: 2, h: 0.8 })).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 });
  });
});

describe("inbox backend", () => {
  test("the stack table and its validator stay in step", () => {
    const table = (schema as unknown as { tables: Record<string, { validator: { fields: Record<string, unknown> } }> }).tables.inboxStacks;
    const { _id, _creationTime, ...fields } = inboxStackDocValidator.fields;
    expect(_id && _creationTime).toBeTruthy();
    expect(Object.keys(fields).sort()).toEqual(Object.keys(table.validator.fields).sort());
  });

  test("posting checks the world and every card type before writing", async () => {
    const env = await setup();
    const [a1, a2, a3] = [await env.asset(), await env.asset(), await env.asset()];
    await expect(env.call(postInboxCards, { worldFolderId: env.film, stackTitle: "x", cards: [{ type: "ab", assetIds: [a1, a2] }] })).rejects.toThrow("not a world");
    await expect(env.post([{ type: "sort", assetIds: [a1], targets: [{ kind: "option", label: "Only" }] }])).rejects.toThrow("2 to 9 targets");
    await expect(env.post([{ type: "sort", assetIds: [a1, a2], targets: sortTargets(env) }])).rejects.toThrow("exactly 1 image");
    await expect(env.post([{ type: "duplicates", assetIds: [a1] }])).rejects.toThrow("2 to 8 images");
    await expect(env.post([{ type: "ab", assetIds: [a1, a2, a3] }])).rejects.toThrow("exactly 2 images");
    await expect(env.post([{ type: "artifact", assetIds: [a1] }])).rejects.toThrow("evidence.defect");
    await expect(env.post([{ type: "rule", assetIds: [] }])).rejects.toThrow("needs ruleText");
    await expect(env.post([{ type: "ab", assetIds: [a1, a2], targets: sortTargets(env) }])).rejects.toThrow("only sort cards");
    await expect(env.post([{ type: "sort", assetIds: [a1], targets: [{ kind: "out" }, { kind: "out", label: "Again" }] }])).rejects.toThrow("only one Out");
    await expect(env.post([{ type: "ab", assetIds: [a1, a2] }], { stackTitle: undefined })).rejects.toThrow("needs stackTitle");
    expect(env.db.getTableDocs("inboxStacks")).toHaveLength(0);

    const result = await env.post([
      { type: "sort", key: "s1", assetIds: [a1], targets: sortTargets(env) },
      { type: "artifact", assetIds: [a2], evidence: { defect: { box: { x: 0.8, y: 0.8, w: 0.5, h: 0.5 }, note: "six fingers" }, priceUsd: 0.04 } },
      { type: "rule", assetIds: [a1, a3], ruleText: "File storm-poppy fields to Crimson Valley?", evidence: { text: "18 of 18 last week" } },
    ], { ingestKey: "nightly-2026-10-20", agent: "Hygiene" });
    expect(result).toMatchObject({ createdStack: true, skippedKeys: [] });
    const view = await env.call(getInboxStack, { stackId: result.stackId });
    expect(view.worldName).toBe("DEAR ANNETE");
    expect(view.stack.cardTypes).toEqual(["sort", "artifact", "rule"]);
    expect(view.cards[0].targets.map((target: AnyDoc) => [target.hotkey, target.label, target.kind])).toEqual([
      [1, "DA FILM · Golden", "moodboard"], [2, "Film · Live Action", "collection"], [3, "Neither", "option"], [4, "Out", "out"],
    ]);
    expect(view.cards[1].evidence.defect.box).toEqual({ x: 0.8, y: 0.8, w: 0.2, h: 0.2 });

    // Same ingestKey appends to the stack; a repeated card key is skipped.
    const again = await env.post([{ type: "sort", key: "s1", assetIds: [a2], targets: sortTargets(env) }, { type: "ab", assetIds: [a1, a2] }], { ingestKey: "nightly-2026-10-20" });
    expect(again).toMatchObject({ stackId: result.stackId, createdStack: false, skippedKeys: ["s1"] });
    expect(again.added).toHaveLength(1);
    expect((await env.call(getInboxStack, { stackId: result.stackId })).cards.map((card: AnyDoc) => card.position)).toEqual([0, 1, 2, 3]);
    const [world] = await env.call(listInboxWorlds, {});
    expect(world).toMatchObject({ worldName: "DEAR ANNETE", openCards: 4, openStacks: 1 });
  });

  test("sort decisions add to the board, the collection or Out, and undo takes back only that", async () => {
    const env = await setup();
    const a1 = await env.asset();
    const { stackId, added: [card] } = await env.post([{ type: "sort", assetIds: [a1], targets: sortTargets(env) }]);
    expect(await env.call(decideInboxCard, { cardId: card, choice: "target", targetHotkey: 1 })).toMatchObject({ effects: ["added to DA FILM · Golden"] });
    expect(await env.doc(env.golden)).toMatchObject({ itemCount: 1, coverAssetId: a1 });
    expect(await env.call(decideInboxCard, { cardId: card, choice: "target", targetHotkey: 1 })).toMatchObject({ unchanged: true });

    // Changing to the collection takes the image off the board first.
    await env.call(decideInboxCard, { cardId: card, choice: "target", targetHotkey: 2 });
    expect(await env.doc(env.golden)).toMatchObject({ itemCount: 0 });
    expect(await env.doc(a1)).toMatchObject({ folderId: env.film });

    // Out: the world's hidden Out collection, created once.
    expect(await env.call(decideInboxCard, { cardId: card, choice: "target", targetHotkey: 4 })).toMatchObject({ effects: ["added to Out"] });
    const out = env.db.getTableDocs("folders").find((folder) => folder.name === "Out")!;
    expect(out).toMatchObject({ parentFolderId: env.world, hiddenFromGallery: true });
    expect(env.db.getTableDocs("assetFolders").filter((link) => link.assetId === a1).map((link) => link.folderId)).toEqual([out._id]);

    expect(await env.call(listInboxWorlds, {})).toMatchObject([{ openCards: 0 }]);
    expect(await env.call(clearInboxDecision, { cardId: card })).toEqual({ cleared: true, deletedForGood: 0 });
    expect(env.db.getTableDocs("assetFolders").filter((link) => link.assetId === a1)).toHaveLength(0);
    expect((await env.doc(a1)).folderId).toBeUndefined();
    expect(env.db.getTableDocs("inboxDecisions")).toHaveLength(0);
    expect(await env.call(listInboxWorlds, {})).toMatchObject([{ openCards: 1 }]);
    expect((await env.call(listInboxStacks, { worldFolderId: env.world }))[0]).toMatchObject({ _id: stackId, cards: 1, decided: 0 });
  });

  test("artifact, A/B, choose-one and rule cards take only their own answers", async () => {
    const env = await setup();
    const [a1, a2, a3] = [await env.asset(), await env.asset(), await env.asset()];
    const { added: [artifact, ab, choose, rule] } = await env.post([
      { type: "artifact", assetIds: [a1], evidence: { defect: { box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }, priceUsd: 0.04 } },
      { type: "ab", assetIds: [a1, a2], labels: ["Board v1", "Board v2"] },
      { type: "choose", assetIds: [a1, a2, a3] },
      { type: "rule", assetIds: [], ruleText: "File them automatically?" },
    ]);
    await expect(env.call(decideInboxCard, { cardId: artifact, choice: "winner", pickedAssetId: a1 })).rejects.toThrow('does not take "winner"');
    expect(await env.call(decideInboxCard, { cardId: artifact, choice: "fix" })).toMatchObject({ effects: ["recorded: fix"] });
    expect(await env.call(decideInboxCard, { cardId: artifact, choice: "out" })).toMatchObject({ effects: ["sent Out (hidden from the gallery grid)"] });
    await env.call(decideInboxCard, { cardId: artifact, choice: "keep" });
    expect(env.db.getTableDocs("assetFolders")).toHaveLength(0);

    await expect(env.call(decideInboxCard, { cardId: ab, choice: "winner", pickedAssetId: a3 })).rejects.toThrow("Pick one of this card's images");
    await env.call(decideInboxCard, { cardId: ab, choice: "winner", pickedAssetId: a2 });
    await env.call(decideInboxCard, { cardId: choose, choice: "pick", pickedAssetId: a3 });
    await env.call(decideInboxCard, { cardId: rule, choice: "not-yet" });
    await env.call(setInboxCardComment, { cardId: rule, text: "Only for exteriors", audio: { storageId: await env.upload(), durationMs: 1800 } });
    const rows = await env.call(listInboxDecisions, { stackId: (await env.doc(rule)).stackId });
    const byCard = new Map(rows.map((row: AnyDoc) => [row.cardId, row]));
    expect(byCard.get(ab)).toMatchObject({ choice: "winner", pickedAssetId: a2 });
    expect(byCard.get(choose)).toMatchObject({ choice: "pick", pickedAssetId: a3 });
    expect(byCard.get(rule)).toMatchObject({ choice: "not-yet", commentText: "Only for exteriors", audioDurationMs: 1800 });
    expect(String((byCard.get(rule) as AnyDoc).audioUrl)).toContain("convex.test/storage");
  });

  test("duplicates stack under the chosen cover, survive a prompt sync and undo restores the prompt pack", async () => {
    const env = await setup();
    const prompt = await env.db.insert("prompts", { ownerUserId: OWNER, text: "tram depot at dusk", tagIds: [], createdAt: 1 });
    const [d1, d2, d3] = [await env.asset({ promptId: prompt, createdAt: 3 }), await env.asset({ promptId: prompt, createdAt: 2 }), await env.asset({ promptId: prompt, createdAt: 1 })];
    await syncPromptAssetPack(env.ctx as never, { ownerUserId: OWNER, promptId: prompt as never });
    const promptPack = (await env.doc(d1)).assetPackId as string;
    expect(promptPack).toBeTruthy();
    const loose = await env.asset();
    const { added: [card] } = await env.post([{ type: "duplicates", assetIds: [d1, d2, loose], evidence: { matches: [{ kind: "same-prompt", label: "same prompt" }, { kind: "similarity", label: "pixel", score: 0.97 }] } }]);

    await expect(env.call(decideInboxCard, { cardId: card, choice: "stack", coverAssetId: d3 })).rejects.toThrow("Choose a cover");
    await expect(env.call(decideInboxCard, { cardId: card, choice: "stack", coverAssetId: d2, deleteAssetIds: [d1, loose] })).rejects.toThrow("at least two images");
    expect(await env.call(decideInboxCard, { cardId: card, choice: "stack", coverAssetId: loose })).toMatchObject({ effects: ["stacked 3 under one cover"], deleteAssetIds: [] });
    const stackPack = (await env.doc(loose)).assetPackId as string;
    expect(await env.doc(stackPack)).toMatchObject({ kind: "stack", coverAssetId: loose, itemCount: 3 });
    expect([await env.doc(loose), await env.doc(d1), await env.doc(d2)].map((asset) => asset.packSlotIndex)).toEqual([0, 1, 2]);
    // The prompt pack lost two of three members, so it dissolved; d3 is loose.
    expect(await env.db.get(promptPack)).toBeNull();

    // A later prompt sync leaves the stack alone.
    await syncPromptAssetPack(env.ctx as never, { ownerUserId: OWNER, promptId: prompt as never });
    expect((await env.doc(d1)).assetPackId).toBe(stackPack);

    await env.call(clearInboxDecision, { cardId: card });
    expect(await env.db.get(stackPack)).toBeNull();
    expect((await env.doc(loose)).assetPackId).toBeUndefined();
    const rebuilt = (await env.doc(d1)).assetPackId as string;
    expect(rebuilt).toBeTruthy();
    expect((await env.doc(d2)).assetPackId).toBe(rebuilt);
    expect((await env.doc(d3)).assetPackId).toBe(rebuilt);
  });

  test("undoing a stack of images that had no pack leaves them without one", async () => {
    const env = await setup();
    const prompt = await env.db.insert("prompts", { ownerUserId: OWNER, text: "bridge in fog", tagIds: [], createdAt: 1 });
    const [b1, b2] = [await env.asset({ promptId: prompt }), await env.asset({ promptId: prompt })];
    const { added: [card] } = await env.post([{ type: "duplicates", assetIds: [b1, b2] }]);
    await env.call(decideInboxCard, { cardId: card, choice: "stack", coverAssetId: b2 });
    await env.call(clearInboxDecision, { cardId: card });
    expect((await env.doc(b1)).assetPackId).toBeUndefined();
    expect((await env.doc(b2)).assetPackId).toBeUndefined();
    expect(env.db.getTableDocs("assetPacks")).toHaveLength(0);
  });

  test("deleting duplicates is planned by the decision and recorded only once the images are gone", async () => {
    const env = await setup();
    const [a1, a2, a3] = [await env.asset(), await env.asset(), await env.asset()];
    const { stackId, added: [card] } = await env.post([{ type: "duplicates", assetIds: [a1, a2, a3] }]);
    await expect(env.call(decideInboxCard, { cardId: card, choice: "resolve", deleteAssetIds: [a1, a2, a3] })).rejects.toThrow("Keep at least one");
    await expect(env.call(decideInboxCard, { cardId: card, choice: "resolve" })).rejects.toThrow("Mark at least one");
    const decided = await env.call(decideInboxCard, { cardId: card, choice: "resolve", deleteAssetIds: [a2, a3] });
    expect(decided).toMatchObject({ choice: "resolve", deleteAssetIds: [a2, a3], effects: ["recorded: resolve", "delete 2"] });
    await env.db.delete(a2);
    expect(await env.call(recordInboxDeletions, { cardId: card, deletedAssetIds: [a2, a3] })).toEqual({ deleted: 1 });
    await expect(env.call(recordInboxDeletions, { cardId: card, deletedAssetIds: [a1] })).rejects.toThrow("not marked");
    const view = await env.call(getInboxStack, { stackId });
    expect(view.cards[0].assets.map((asset: AnyDoc) => asset.missing)).toEqual([false, true, false]);
    expect(await env.call(clearInboxDecision, { cardId: card })).toEqual({ cleared: true, deletedForGood: 1 });
    const [row] = await env.call(listInboxDecisions, { stackId });
    expect(row).toMatchObject({ deletedAssetIds: [a2] });
    expect(row.choice).toBeUndefined();
  });

  test("notes on images are asset comments with an optional voice note", async () => {
    const env = await setup();
    const a1 = await env.asset();
    const { stackId } = await env.post([{ type: "ab", assetIds: [a1, await env.asset()] }]);
    const audio = await env.upload("audio/mp4");
    await expect(env.call(addAssetComment, { assetId: a1, body: "  " })).rejects.toThrow("needs text");
    const voice = await env.call(addAssetComment, { assetId: a1, body: "", audio: { storageId: audio, durationMs: 2100 }, source: "inbox" });
    expect(voice).toMatchObject({ body: "", audioDurationMs: 2100, audioContentType: "audio/mp4", source: "inbox" });
    await env.call(addAssetComment, { assetId: a1, body: "warmer" });
    const image = await env.upload("image/png");
    await expect(env.call(addAssetComment, { assetId: a1, body: "", audio: { storageId: image, durationMs: 100 } })).rejects.toThrow("must be audio");
    expect((await env.call(listAssetComments, { assetId: a1 })).map((row: AnyDoc) => row.body)).toEqual(["", "warmer"]);
    const notes = await env.call(listInboxNotes, { stackId });
    expect(notes).toHaveLength(1);
    expect(notes[0].notes.map((note: AnyDoc) => Boolean(note.audioUrl))).toEqual([false, true]);
    await env.call(deleteAssetComment, { commentId: voice._id });
    expect(await env.db.get(audio)).toBeNull();
  });

  test("a closed stack refuses answers; delete keeps what decisions did; strangers see nothing", async () => {
    const env = await setup();
    const a1 = await env.asset();
    const { stackId, added: [card] } = await env.post([{ type: "sort", assetIds: [a1], targets: sortTargets(env) }]);
    await env.call(decideInboxCard, { cardId: card, choice: "target", targetHotkey: 1 });
    await env.call(closeInboxStack, { stackId });
    expect(await env.call(listInboxWorlds, {})).toEqual([]);
    await expect(env.call(decideInboxCard, { cardId: card, choice: "skip" })).rejects.toThrow("is closed");
    expect(await env.call(listInboxStacks, { status: "closed" })).toHaveLength(1);
    await env.call(closeInboxStack, { stackId, reopen: true });
    expect(await env.call(listInboxWorlds, {})).toHaveLength(1);

    await expect(env.stranger(getInboxStack, { stackId })).rejects.toThrow("Stack not found");
    await expect(env.stranger(decideInboxCard, { cardId: card, choice: "skip" })).rejects.toThrow("Card not found");
    await expect(env.stranger(postInboxCards, { worldFolderId: env.world, stackTitle: "x", cards: [{ type: "ab", assetIds: [a1, a1] }] })).rejects.toThrow("World not found");
    expect(await env.stranger(listInboxWorlds, {})).toEqual([]);
    const anonymous = { ...env.ctx, auth: { getUserIdentity: async () => null } };
    await expect(callAsOwner(listInboxWorlds)(anonymous, { ownerUserId: OWNER })).rejects.toThrow("Not authenticated");

    expect(await env.call(deleteInboxStack, { stackId })).toEqual({ deleted: true, removedCards: 1 });
    for (const table of ["inboxStacks", "inboxCards", "inboxCounts", "inboxDecisions"]) expect(env.db.getTableDocs(table)).toHaveLength(0);
    expect(env.db.getTableDocs("moodboardItems")).toHaveLength(1);
  });
});
