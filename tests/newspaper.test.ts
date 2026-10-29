import { describe, expect, test } from "bun:test";
import schema from "../convex/schema";
import { newspaperDocValidator } from "../convex/newspaperValidators";
import { compile, compileAll, compileEdition, compileFacts, editionUntil, getNewspaper, listNewspapers, writeNewspaper } from "../convex/newspaper";
import crons from "../convex/crons";
import { NEWSPAPER_LIMITS, dateKeyLabel, excerpt, isDateKey, pragueDateKey, shiftDateKey, stackPath, taskPath } from "../lib/newspaper";
import { newspaperFactsSchema, newspaperGetSchema, newspaperWriteSchema, parseNewspaperFacts, presentNewspaper } from "../lib/newspaper-contract";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { callAsOwner } from "./helpers/call-as-owner";

const OWNER = "telegram:1";
const HOUR = 60 * 60 * 1000;
// The compile mutations read the clock, so the fixture hangs off the real now.
const NOW = Date.now();
const TODAY = pragueDateKey(NOW);
const daysAgo = (n: number) => shiftDateKey(TODAY, -n);
const since = NOW - NEWSPAPER_LIMITS.windowMs;
const fresh = (hoursAgo: number) => NOW - hoursAgo * HOUR;
const stale = since - 3 * HOUR;

// A small vault: one world with a shelf, a storybook, a board, a character,
// a day of journal entries, saved pieces, tasks in every state, an open stack.
const setup = async () => {
  const { db, ctx } = createMockConvexMutationCtx({
    indexOrder: {
      "worldChanges.by_owner_world_createdAt": ["ownerUserId", "worldFolderId", "createdAt"],
      "tasks.by_owner_updatedAt": ["ownerUserId", "updatedAt"],
      "tasks.by_owner_status_createdAt": ["ownerUserId", "status", "createdAt"],
      "inboxStacks.by_owner_status_createdAt": ["ownerUserId", "status", "createdAt"],
      "inboxCounts.by_stack": ["stackId"],
      "assets.by_owner_createdAt": ["ownerUserId", "createdAt"],
      "assetFolders.by_asset": ["assetId"],
      "moodboards.by_owner_updatedAt": ["ownerUserId", "updatedAt"],
      "characters.by_owner_updatedAt": ["ownerUserId", "updatedAt"],
      "folders.by_owner_kind": ["ownerUserId", "kind"],
      "folders.by_owner_worldKey": ["ownerUserId", "worldKey"],
      "newspapers.by_owner_date": ["ownerUserId", "date"],
    },
  });
  const world = await db.insert("folders", { ownerUserId: OWNER, name: "DEAR ANNETE", normalizedName: "dear annete", worldKey: "dear-annete", createdAt: stale });
  const quiet = await db.insert("folders", { ownerUserId: OWNER, name: "ANDROMEDA", normalizedName: "andromeda", worldKey: "andromeda", createdAt: stale });
  const shelf = await db.insert("folders", { ownerUserId: OWNER, name: "Cast", normalizedName: "x/cast", parentFolderId: world, createdAt: stale });
  const art = await db.insert("folders", { ownerUserId: OWNER, name: "ART", normalizedName: "art", createdAt: stale });
  const book = await db.insert("folders", { ownerUserId: OWNER, name: "Episode 3", normalizedName: "x/episode 3", parentFolderId: world, kind: "storybook", createdAt: fresh(5), updatedAt: fresh(5) });
  await db.insert("folders", { ownerUserId: OWNER, name: "Old episode", normalizedName: "x/old", parentFolderId: world, kind: "storybook", createdAt: stale, updatedAt: stale });

  const asset = async (createdAt: number, folderId?: string) => {
    const id = await db.insert("assets", { ownerUserId: OWNER, kind: "image", tagIds: [], createdAt, width: 1600, height: 900, thumbR2Key: `thumbs/${createdAt}.webp`, folderId });
    if (folderId) await db.insert("assetFolders", { ownerUserId: OWNER, assetId: id, folderId, createdAt });
    return id;
  };
  const worldAssets = [];
  for (let i = 0; i < 14; i += 1) worldAssets.push(await asset(fresh(1 + i * 0.5), shelf));
  const studioAsset = await asset(fresh(2), art);
  await asset(stale, shelf); // outside the window

  for (const [i, op] of ["assets.file", "assets.file", "doc.write", "moodboard.items"].entries()) {
    await db.insert("worldChanges", { ownerUserId: OWNER, worldFolderId: world, op, targetType: "x", targetId: `t${i}`, summary: `Change ${i} (${op})`, actor: "agent:claude-eallin", session: "hands", createdAt: fresh(2 + i) });
  }
  await db.insert("worldChanges", { ownerUserId: OWNER, worldFolderId: world, op: "assets.file", targetType: "x", targetId: "old", summary: "Yesterday's filing", actor: "owner", createdAt: stale });

  const task = (fields: Record<string, unknown>) => db.insert("tasks", {
    ownerUserId: OWNER, worldFolderId: world, title: "Task", status: "open", priority: 2, createdBy: "owner", links: [], source: "manual", createdAt: fresh(3), updatedAt: fresh(3), ...fields,
  });
  const done = await task({ title: "Repair the hands", status: "done", result: "Repaired with Krea 3: asset:a2. $0.06.", claimedBy: "agent:claude-eallin", createdAt: stale, updatedAt: fresh(1) });
  const blocked = await task({ title: "Which lamp?", status: "blocked", result: "Two lamps fit the lock: the brass one or the paper one. Which?", createdAt: stale, updatedAt: fresh(4) });
  await task({ title: "Fresh open task", status: "open", createdAt: fresh(1), updatedAt: fresh(1) });
  await task({ title: "Old open task", status: "open", createdAt: stale, updatedAt: stale });
  await task({ title: "Studio chore", status: "done", worldFolderId: undefined, result: "Rebuilt thumbnails.", createdAt: stale, updatedAt: fresh(2) });
  await task({ title: "Done long ago", status: "done", result: "x", createdAt: stale, updatedAt: stale });

  const stack = await db.insert("inboxStacks", { ownerUserId: OWNER, worldFolderId: world, title: "Sort the tram shots", agent: "Hygiene routine", status: "open", cardTypes: ["sort"], createdAt: fresh(6), updatedAt: fresh(6) });
  await db.insert("inboxCounts", { ownerUserId: OWNER, stackId: stack, worldFolderId: world, status: "open", cards: 8, decided: 3 });
  await db.insert("inboxStacks", { ownerUserId: OWNER, worldFolderId: world, title: "Closed", status: "closed", cardTypes: ["sort"], createdAt: stale, updatedAt: stale, closedAt: stale });

  const board = await db.insert("moodboards", { ownerUserId: OWNER, folderId: world, name: "DA FILM", normalizedName: "da film", status: "in-midjourney", mjCode: "88ji6bg", mjSyncedItemCount: 10, itemCount: 12, revision: 3, createdAt: stale, updatedAt: fresh(3) });
  const draft = await db.insert("moodboards", { ownerUserId: OWNER, folderId: shelf, name: "Lamp study", normalizedName: "lamp study", status: "draft", itemCount: 7, revision: 1, createdAt: stale, updatedAt: stale });
  await db.insert("moodboards", { ownerUserId: OWNER, folderId: world, name: "Empty draft", normalizedName: "empty draft", status: "draft", itemCount: 0, revision: 1, createdAt: stale, updatedAt: stale });

  await db.insert("characters", { ownerUserId: OWNER, worldFolderId: world, code: "DA-CH-004", prefix: "DA-CH", number: 4, name: "Dari", normalizedName: "dari", otherNames: [], status: "active", costumes: [], lastCostumeNumber: 0, linkCount: 0, revision: 1, createdAt: fresh(7), updatedAt: fresh(7) });

  const call = <F extends Parameters<typeof callAsOwner>[0]>(fn: F, args: Record<string, unknown>) => callAsOwner(fn)(ctx, { ownerUserId: OWNER, ...args });
  return { db, ctx, world, quiet, shelf, book, worldAssets, studioAsset, done, blocked, stack, board, draft, call };
};

describe("newspaper helpers", () => {
  test("dates, paths and excerpts", () => {
    expect(pragueDateKey(Date.UTC(2026, 9, 29, 23, 30))).toBe("2026-10-30"); // 00:30 Prague the next day
    expect(pragueDateKey(Date.UTC(2026, 6, 1, 22, 30))).toBe("2026-07-02"); // CEST: 00:30 the next day
    expect(isDateKey("2026-10-30")).toBe(true);
    expect(isDateKey("2026-13-01")).toBe(false);
    expect(isDateKey("30-10-2026")).toBe(false);
    expect(shiftDateKey("2026-10-31", 1)).toBe("2026-11-01");
    expect(dateKeyLabel("2026-10-30")).toBe("Friday, 30 October 2026");
    expect(taskPath("t1")).toBe("/tasks?task=t1");
    expect(stackPath("w1", "s1")).toBe("/inbox/w1/s1");
    expect(excerpt("a\n\nb   c")).toBe("a b c");
    expect(excerpt("word ".repeat(100), 40).length).toBeLessThanOrEqual(40);
    expect(editionUntil(TODAY, NOW)).toBe(NOW);
    expect(pragueDateKey(editionUntil("2026-07-02", NOW))).toBe("2026-07-02");
    expect(pragueDateKey(editionUntil("2026-01-15", NOW))).toBe("2026-01-15");
    expect(editionUntil(daysAgo(3), NOW)).toBeLessThan(NOW);
  });

  test("the contract: dates are validated, prose is capped, facts parse", () => {
    expect(newspaperGetSchema.parse({})).toEqual({});
    expect(() => newspaperGetSchema.parse({ date: "yesterday" })).toThrow();
    expect(newspaperWriteSchema.parse({ date: "2026-10-30", prose: "Hello" }).prose).toBe("Hello");
    expect(() => newspaperWriteSchema.parse({ date: "2026-10-30", prose: "x".repeat(NEWSPAPER_LIMITS.prose + 1) })).toThrow();
    expect(parseNewspaperFacts("not json")).toBeNull();
    expect(parseNewspaperFacts(JSON.stringify({ version: 2 }))).toBeNull();
  });

  test("the schema carries the table and the cron compiles at 05:30 UTC", () => {
    expect(schema.tables.newspapers).toBeDefined();
    expect(newspaperDocValidator.fields.status).toBeDefined();
    const jobs = (crons as unknown as { crons: Record<string, { schedule: { type: string; hourUTC: number; minuteUTC: number } }> }).crons;
    const job = jobs["compile the morning newspaper"];
    expect(job).toBeDefined();
    expect(job.schedule).toMatchObject({ type: "daily", hourUTC: 5, minuteUTC: 30 });
  });
});

describe("compileFacts", () => {
  test("groups the last 24 hours per world and lists what waits on Michael", async () => {
    const { ctx, world, quiet, book, worldAssets, studioAsset, done, blocked, stack, board, draft } = await setup();
    const facts = await compileFacts(ctx, OWNER, since, NOW);
    expect(newspaperFactsSchema.safeParse(facts).success).toBe(true);

    expect(facts.totals).toEqual({ done: 2, created: 1, blocked: 1, open: 2, changes: 4, assets: 15, openStacks: 1, needsYou: 3 });

    const da = facts.worlds.find((entry) => entry.worldFolderId === world)!;
    expect(facts.worlds[0].worldFolderId).toBe(world); // the busiest world first
    expect(facts.worlds.find((entry) => entry.worldFolderId === quiet)).toMatchObject({ changes: { total: 0 }, assets: { count: 0 } });

    expect(da.changes.total).toBe(4);
    expect(da.changes.byOp).toEqual([{ op: "assets.file", count: 2 }, { op: "doc.write", count: 1 }, { op: "moodboard.items", count: 1 }]);
    expect(da.changes.summaries.map((change) => change.summary)).toEqual(["Change 0 (assets.file)", "Change 1 (assets.file)", "Change 2 (doc.write)", "Change 3 (moodboard.items)"]);
    expect(da.changes.summaries[0]).toMatchObject({ actor: "agent:claude-eallin", session: "hands" });

    expect(da.assets.count).toBe(14);
    expect(da.assets.items).toHaveLength(NEWSPAPER_LIMITS.thumbnails);
    expect(da.assets.items[0].assetId).toBe(worldAssets[0]); // newest first
    expect(da.assets.items[0].kind).toBe("image"); // thumbUrl needs the R2 public base, unset in tests
    expect(da.assets.items[0].path).toMatch(/^\/\?asset=/);
    expect(facts.studio.assets).toMatchObject({ count: 1 });
    expect(facts.studio.assets.items[0].assetId).toBe(studioAsset);

    expect(da.tasks).toEqual({ done: 1, created: 1, blocked: 1, open: 2 });
    expect(facts.studio.tasks).toEqual({ done: 1, created: 0, blocked: 0, open: 0 });
    expect(facts.tasks.done.map((task) => task.taskId)).toEqual([done, expect.any(String)]);
    expect(facts.tasks.done[0]).toMatchObject({ worldName: "DEAR ANNETE", result: "Repaired with Krea 3: asset:a2. $0.06.", claimedBy: "agent:claude-eallin", path: `/tasks?task=${done}` });
    expect(facts.tasks.blocked[0]).toMatchObject({ taskId: blocked, result: expect.stringContaining("Two lamps") });
    expect(facts.tasks.created.map((task) => task.title)).toEqual(["Fresh open task"]);

    expect(facts.stacks).toHaveLength(1);
    expect(facts.stacks[0]).toMatchObject({ stackId: stack, cards: 8, decided: 3, agent: "Hygiene routine", path: `/inbox/${world}/${stack}` });
    expect(da.openStacks).toBe(1);

    expect(da.storybooks).toEqual([{ folderId: book, name: "Episode 3", isNew: true, updatedAt: fresh(5) }]);
    expect(da.moodboards).toEqual([expect.objectContaining({ moodboardId: board, drift: 2, syncedItemCount: 10, itemCount: 12, isNew: false, mjCode: "88ji6bg" })]);
    expect(da.characters).toEqual([expect.objectContaining({ code: "DA-CH-004", name: "Dari", isNew: true })]);

    expect(facts.needsYou.map((need) => [need.kind, need.id])).toEqual([["stack", stack], ["task", blocked], ["moodboard", draft]]);
    expect(facts.needsYou[0].detail).toBe("3 of 8 cards decided");
    expect(facts.needsYou[1].detail).toContain("Two lamps");
    expect(facts.needsYou[2]).toMatchObject({ worldName: "DEAR ANNETE", detail: "7 images, draft, not in Midjourney yet" });
    expect(facts.needsYou[2].path).toBeUndefined();
  });

  test("another owner's vault compiles empty", async () => {
    const { ctx } = await setup();
    const facts = await compileFacts(ctx, "telegram:2", since, NOW);
    expect(facts.worlds).toHaveLength(0);
    expect(facts.totals.assets).toBe(0);
    expect(facts.needsYou).toHaveLength(0);
  });
});

describe("editions", () => {
  test("compile is idempotent per date, keeps prose, and the agent presentation carries urls", async () => {
    const { ctx, call, world } = await setup();
    const first = await compileEdition(ctx, OWNER, { now: NOW, compiledBy: "cron" });
    expect(first.date).toBe(TODAY);
    expect(first).toMatchObject({ status: "compiled", done: 2, needsYou: 3, saved: 15, since, until: NOW, compiledBy: "cron" });

    const written = await call(writeNewspaper, { date: TODAY, prose: "A good day for the hands.", writtenBy: "agent:claude-artist" });
    expect(written).toMatchObject({ _id: first._id, status: "written", prose: "A good day for the hands.", writtenBy: "agent:claude-artist" });
    expect(written.writtenAt).toBeGreaterThan(0);

    const again = await call(compile, { date: TODAY, compiledBy: "owner" });
    expect(again._id).toBe(first._id);
    expect(again).toMatchObject({ status: "written", prose: "A good day for the hands.", compiledBy: "owner" });
    expect(again.compiledAt).toBeGreaterThanOrEqual(first.compiledAt);

    const presented = presentNewspaper(again);
    expect(presented.url).toBe(`https://gallery.laniameda.space/newspaper/${TODAY}`);
    expect(presented.facts?.needsYou[0].url).toBe(`https://gallery.laniameda.space/inbox/${world}/${presented.facts?.needsYou[0].id}`);
    expect(presented.facts?.tasks.done[0].url).toMatch(/^https:\/\/gallery\.laniameda\.space\/tasks\?task=/);
    expect(presented.counts).toEqual({ done: 2, needsYou: 3, saved: 15 });
  });

  test("get returns the latest or one date; list is newest first; write needs an edition", async () => {
    const { ctx, call } = await setup();
    expect(await call(getNewspaper, {})).toBeNull();
    await compileEdition(ctx, OWNER, { date: daysAgo(2), now: NOW, compiledBy: "cron" });
    await compileEdition(ctx, OWNER, { date: TODAY, now: NOW, compiledBy: "cron" });
    await compileEdition(ctx, OWNER, { date: daysAgo(1), now: NOW, compiledBy: "cron" });
    expect((await call(getNewspaper, {}))?.date).toBe(TODAY);
    expect((await call(getNewspaper, { date: daysAgo(1) }))?.date).toBe(daysAgo(1));
    expect(await call(getNewspaper, { date: daysAgo(40) })).toBeNull();
    await expect(call(getNewspaper, { date: "soon" })).rejects.toThrow(/not a date/);
    expect((await call(listNewspapers, {})).map((row) => row.date)).toEqual([TODAY, daysAgo(1), daysAgo(2)]);
    await expect(call(writeNewspaper, { date: daysAgo(40), prose: "x" })).rejects.toThrow(/Compile it first/);
    await expect(call(writeNewspaper, { date: TODAY, prose: "   " })).rejects.toThrow(/empty/);
    // An earlier date's window ends at 07:30 Prague that day, so later rows stay out.
    const older = await call(getNewspaper, { date: daysAgo(2) });
    expect(parseNewspaperFacts(older!.facts)?.totals.assets).toBe(0);
    // Another owner sees none of it.
    expect(await callAsOwner(getNewspaper)(ctx, { ownerUserId: "telegram:2" })).toBeNull();
  });

  test("compileAll reads the owner from the environment and schedules the notification", async () => {
    const { ctx } = await setup();
    const scheduled: unknown[][] = [];
    (ctx.scheduler as { runAfter: (...args: unknown[]) => Promise<null> }).runAfter = async (...args) => { scheduled.push(args); return null; };
    const previous = process.env.KB_OWNER_USER_ID;
    const previousList = process.env.NEWSPAPER_OWNER_USER_IDS;
    try {
      delete process.env.NEWSPAPER_OWNER_USER_IDS;
      delete process.env.KB_OWNER_USER_ID;
      expect(await (compileAll as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown[]> })._handler(ctx, {})).toEqual([]);
      process.env.KB_OWNER_USER_ID = OWNER;
      const rows = await (compileAll as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<Array<{ date: string; done: number }>> })._handler(ctx, {});
      expect(rows).toHaveLength(1);
      expect(rows[0].date).toBe(pragueDateKey());
      expect(scheduled).toHaveLength(1);
      expect(scheduled[0][2]).toMatchObject({ ownerUserId: OWNER, date: rows[0].date });
    } finally {
      if (previous === undefined) delete process.env.KB_OWNER_USER_ID; else process.env.KB_OWNER_USER_ID = previous;
      if (previousList !== undefined) process.env.NEWSPAPER_OWNER_USER_IDS = previousList;
    }
  });
});
