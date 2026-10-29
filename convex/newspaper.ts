import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { signedOwnerMutation as ownerMutation, signedOwnerQuery as ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { listWorldRoots, worldIdOfFolder, type WorldMemo } from "./worldCore";
import { resolveAssetThumbUrl, resolveAssetUrl } from "./r2_url";
import { newspaperDocValidator, newspaperSummaryValidator } from "./newspaperValidators";
import { resolveTelegramChatId, resolveTelegramNotificationBotToken, sendTelegramMessage } from "./telegram";
import {
  NEWSPAPER_LIMITS, assetPath, excerpt, isDateKey, newspaperUrl, pragueDateKey, stackPath, taskPath,
} from "../lib/newspaper";
import type {
  NewspaperAssetItem, NewspaperFacts, NewspaperNeed, NewspaperStackItem, NewspaperTaskItem, NewspaperWorld,
} from "../lib/newspaper-contract";

// The morning newspaper. A cron (convex/crons.ts, 05:30 UTC = 07:30 Prague)
// compiles one edition a day from the gallery's own tables: what changed in
// every world's journal, what was saved, which tasks finished and which wait
// on Michael, the open Inbox stacks, the boards not yet in Midjourney. Pure
// facts with ids and paths. An agent then reads them (get_newspaper) and adds
// the narrative (write_newspaper). Michael reads it at /newspaper on his phone.
// Nothing here stars, publishes, features or deletes anything.

type Newspaper = Doc<"newspapers">;
type Ctx = QueryCtx | MutationCtx;

const owns = (owner: string, row: { ownerUserId?: string } | null): boolean =>
  Boolean(row && canActorAccessOwnerUserId(owner, row.ownerUserId));

const emptyCounts = () => ({ done: 0, created: 0, blocked: 0, open: 0 });

// The facts' world block, with the typed id kept for the index reads.
type WorldAcc = NewspaperWorld & { worldFolderId: Id<"folders"> };

const newWorld = (root: Doc<"folders">): WorldAcc => ({
  worldFolderId: root._id, key: root.worldKey ?? "", name: root.name,
  changes: { total: 0, byOp: [], summaries: [] },
  assets: { count: 0, items: [] },
  storybooks: [], moodboards: [], characters: [],
  tasks: emptyCounts(), openStacks: 0,
});

const assetItem = async (ctx: Ctx, asset: Doc<"assets">): Promise<NewspaperAssetItem> => ({
  assetId: asset._id, kind: asset.kind,
  thumbUrl: await resolveAssetThumbUrl(ctx, asset),
  url: await resolveAssetUrl(ctx, asset),
  width: asset.width, height: asset.height,
  createdAt: asset.createdAt, path: assetPath(asset._id),
});

const taskItem = (task: Doc<"tasks">, worldName: string): NewspaperTaskItem => ({
  taskId: task._id, title: task.title, worldFolderId: task.worldFolderId, worldName,
  status: task.status, priority: task.priority,
  result: task.result ? excerpt(task.result) : undefined,
  claimedBy: task.claimedBy, updatedAt: task.updatedAt, path: taskPath(task._id),
});

/** Every candidate spelling of the owner, read through one index; deduped by id. */
const readOwned = async <T extends { _id: string }>(owner: string, read: (candidate: string) => Promise<T[]>) => {
  const rows = new Map<string, T>();
  for (const candidate of resolveUserIdCandidates(owner)) {
    for (const row of await read(candidate)) rows.set(row._id, row);
  }
  return [...rows.values()];
};

/**
 * The facts of one edition: everything that happened between `since` and
 * `until`, grouped per world, plus what waits on Michael right now. Reads are
 * bounded (NEWSPAPER_LIMITS.scan rows per table) and index-backed.
 */
export const compileFacts = async (ctx: Ctx, owner: string, since: number, until: number): Promise<NewspaperFacts> => {
  const { scan, summaries, thumbnails } = NEWSPAPER_LIMITS;
  const inWindow = (at: number | undefined) => at !== undefined && at >= since && at <= until;
  const memo: WorldMemo = new Map();
  const roots = await listWorldRoots(ctx, owner);
  const worlds = new Map<Id<"folders">, WorldAcc>(roots.map((root) => [root._id, newWorld(root)]));
  const worldName = (id: Id<"folders"> | undefined) => (id && worlds.get(id)?.name) ?? "Studio";
  const studio = { assets: { count: 0, items: [] as NewspaperAssetItem[] }, tasks: emptyCounts() };

  // The journal, per world: what agents changed.
  for (const world of worlds.values()) {
    const rows = await readOwned(owner, (candidate) => ctx.db.query("worldChanges")
      .withIndex("by_owner_world_createdAt", (q) => q.eq("ownerUserId", candidate).eq("worldFolderId", world.worldFolderId).gte("createdAt", since))
      .order("desc").take(scan));
    const byOp = new Map<string, number>();
    for (const row of rows) {
      if (!inWindow(row.createdAt)) continue;
      world.changes.total += 1;
      byOp.set(row.op, (byOp.get(row.op) ?? 0) + 1);
      if (world.changes.summaries.length < summaries) {
        world.changes.summaries.push({ changeId: row._id, op: row.op, summary: row.summary, actor: row.actor, session: row.session, createdAt: row.createdAt });
      }
    }
    world.changes.byOp = [...byOp].map(([op, count]) => ({ op, count })).sort((a, b) => b.count - a.count || a.op.localeCompare(b.op));
  }

  // Tasks: finished and filed in the window; blocked and open right now.
  const touched = await readOwned(owner, (candidate) => ctx.db.query("tasks")
    .withIndex("by_owner_updatedAt", (q) => q.eq("ownerUserId", candidate).gte("updatedAt", since)).order("desc").take(scan));
  const blockedRows = await readOwned(owner, (candidate) => ctx.db.query("tasks")
    .withIndex("by_owner_status_createdAt", (q) => q.eq("ownerUserId", candidate).eq("status", "blocked")).order("desc").take(scan));
  const openRows = await readOwned(owner, (candidate) => ctx.db.query("tasks")
    .withIndex("by_owner_status_createdAt", (q) => q.eq("ownerUserId", candidate).eq("status", "open")).order("desc").take(scan));
  const claimedRows = await readOwned(owner, (candidate) => ctx.db.query("tasks")
    .withIndex("by_owner_status_createdAt", (q) => q.eq("ownerUserId", candidate).eq("status", "claimed")).order("desc").take(scan));
  const countsOf = (task: Doc<"tasks">) => (task.worldFolderId && worlds.get(task.worldFolderId)?.tasks) ?? studio.tasks;
  const tasks: NewspaperFacts["tasks"] = { done: [], created: [], blocked: [] };
  for (const task of touched.sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (task.status === "done" && inWindow(task.updatedAt)) { countsOf(task).done += 1; tasks.done.push(taskItem(task, worldName(task.worldFolderId))); }
    if (inWindow(task.createdAt)) { countsOf(task).created += 1; tasks.created.push(taskItem(task, worldName(task.worldFolderId))); }
  }
  for (const task of blockedRows.sort((a, b) => b.updatedAt - a.updatedAt)) { countsOf(task).blocked += 1; tasks.blocked.push(taskItem(task, worldName(task.worldFolderId))); }
  for (const task of [...openRows, ...claimedRows]) countsOf(task).open += 1;

  // Open Inbox stacks: his decisions waiting.
  const stackRows = await readOwned(owner, (candidate) => ctx.db.query("inboxStacks")
    .withIndex("by_owner_status_createdAt", (q) => q.eq("ownerUserId", candidate).eq("status", "open")).order("desc").take(scan));
  const stacks: NewspaperStackItem[] = [];
  for (const stack of stackRows.sort((a, b) => b.createdAt - a.createdAt)) {
    const counts = await ctx.db.query("inboxCounts").withIndex("by_stack", (q) => q.eq("stackId", stack._id)).first();
    const world = worlds.get(stack.worldFolderId);
    if (world) world.openStacks += 1;
    stacks.push({
      stackId: stack._id, worldFolderId: stack.worldFolderId, worldName: worldName(stack.worldFolderId),
      title: stack.title, agent: stack.agent, cards: counts?.cards ?? 0, decided: counts?.decided ?? 0,
      createdAt: stack.createdAt, path: stackPath(stack.worldFolderId, stack._id),
    });
  }

  // New assets, per world (by the collections they sit in) or studio-wide.
  const assets = await readOwned(owner, (candidate) => ctx.db.query("assets")
    .withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", candidate).gte("createdAt", since)).order("desc").take(scan));
  for (const asset of assets.sort((a, b) => b.createdAt - a.createdAt)) {
    if (!inWindow(asset.createdAt)) continue;
    const links = await ctx.db.query("assetFolders").withIndex("by_asset", (q) => q.eq("assetId", asset._id)).collect();
    const folderIds = new Set<Id<"folders">>(links.map((link) => link.folderId));
    if (asset.folderId) folderIds.add(asset.folderId);
    let bucket: { count: number; items: NewspaperAssetItem[] } = studio.assets;
    for (const folderId of folderIds) {
      const worldId = await worldIdOfFolder(ctx, folderId, memo);
      const world = worldId ? worlds.get(worldId) : undefined;
      if (world) { bucket = world.assets; break; }
    }
    bucket.count += 1;
    if (bucket.items.length < thumbnails) bucket.items.push(await assetItem(ctx, asset));
  }

  // Moodboards: changed in the window, and every draft with candidates (needs him).
  const boards = await readOwned(owner, (candidate) => ctx.db.query("moodboards")
    .withIndex("by_owner_updatedAt", (q) => q.eq("ownerUserId", candidate)).order("desc").take(scan));
  const draftBoards: Array<{ board: Doc<"moodboards">; worldName: string }> = [];
  for (const board of boards.sort((a, b) => b.updatedAt - a.updatedAt)) {
    const worldId = await worldIdOfFolder(ctx, board.folderId, memo);
    const world = worldId ? worlds.get(worldId) : undefined;
    if (board.status === "draft" && board.itemCount > 0) draftBoards.push({ board, worldName: world?.name ?? "Studio" });
    if (!world || !inWindow(board.updatedAt)) continue;
    world.moodboards.push({
      moodboardId: board._id, name: board.name, status: board.status, itemCount: board.itemCount,
      syncedItemCount: board.mjSyncedItemCount, drift: board.mjCode ? board.itemCount - (board.mjSyncedItemCount ?? 0) : 0,
      mjCode: board.mjCode, isNew: inWindow(board.createdAt), updatedAt: board.updatedAt,
    });
  }

  // Characters created or changed.
  const characters = await readOwned(owner, (candidate) => ctx.db.query("characters")
    .withIndex("by_owner_updatedAt", (q) => q.eq("ownerUserId", candidate).gte("updatedAt", since)).order("desc").take(scan));
  for (const character of characters.sort((a, b) => b.updatedAt - a.updatedAt)) {
    const world = worlds.get(character.worldFolderId);
    if (!world || !inWindow(character.updatedAt)) continue;
    world.characters.push({ characterId: character._id, code: character.code, name: character.name, isNew: inWindow(character.createdAt), updatedAt: character.updatedAt });
  }

  // Storybooks created or changed: child collections of kind storybook.
  const storybooks = await readOwned(owner, (candidate) => ctx.db.query("folders")
    .withIndex("by_owner_kind", (q) => q.eq("ownerUserId", candidate).eq("kind", "storybook")).take(scan));
  for (const book of storybooks) {
    const updatedAt = book.updatedAt ?? book.createdAt ?? book._creationTime;
    if (!inWindow(updatedAt)) continue;
    const worldId = await worldIdOfFolder(ctx, book.parentFolderId, memo);
    const world = worldId ? worlds.get(worldId) : undefined;
    if (!world) continue;
    world.storybooks.push({ folderId: book._id, name: book.name, isNew: inWindow(book.createdAt ?? book._creationTime), updatedAt });
  }
  for (const world of worlds.values()) world.storybooks.sort((a, b) => b.updatedAt - a.updatedAt);

  // What waits on him: open stacks, blocked tasks, draft boards with candidates.
  const needsYou: NewspaperNeed[] = [
    ...stacks.map((stack): NewspaperNeed => ({
      kind: "stack", id: stack.stackId, title: stack.title, worldName: stack.worldName,
      detail: stack.cards === 0 ? "No cards yet" : stack.decided === 0 ? `${stack.cards} card${stack.cards === 1 ? "" : "s"} waiting` : `${stack.decided} of ${stack.cards} cards decided`,
      path: stack.path,
    })),
    ...tasks.blocked.map((task): NewspaperNeed => ({
      kind: "task", id: task.taskId, title: task.title, worldName: task.worldName,
      detail: task.result ? excerpt(task.result, 140) : "Needs your answer", path: task.path,
    })),
    ...draftBoards.map(({ board, worldName: name }): NewspaperNeed => ({
      kind: "moodboard", id: board._id, title: board.name, worldName: name,
      detail: `${board.itemCount} image${board.itemCount === 1 ? "" : "s"}, draft, not in Midjourney yet`,
    })),
  ];

  const worldList = [...worlds.values()].sort((a, b) =>
    (b.changes.total + b.assets.count + b.tasks.done) - (a.changes.total + a.assets.count + a.tasks.done) || a.name.localeCompare(b.name));
  const sum = (pick: (world: WorldAcc) => number) => worldList.reduce((total, world) => total + pick(world), 0);
  return {
    version: 1, since, until,
    totals: {
      done: tasks.done.length, created: tasks.created.length, blocked: tasks.blocked.length,
      open: sum((world) => world.tasks.open) + studio.tasks.open,
      changes: sum((world) => world.changes.total),
      assets: sum((world) => world.assets.count) + studio.assets.count,
      openStacks: stacks.length, needsYou: needsYou.length,
    },
    worlds: worldList, studio, tasks, stacks, needsYou,
  };
};

/* ── Editions ────────────────────────────────────────────────────────────── */

const findEdition = async (ctx: Ctx, owner: string, date: string) => {
  for (const candidate of resolveUserIdCandidates(owner)) {
    const hit = await ctx.db.query("newspapers").withIndex("by_owner_date", (q) => q.eq("ownerUserId", candidate).eq("date", date)).first();
    if (hit && owns(owner, hit)) return hit;
  }
  return null;
};

// The latest edition is the newest date (the key sorts as text), not the last
// compile: a recompiled old edition does not jump to the front.
const latestEdition = async (ctx: Ctx, owner: string) => {
  let latest: Newspaper | null = null;
  for (const candidate of resolveUserIdCandidates(owner)) {
    const hit = await ctx.db.query("newspapers").withIndex("by_owner_date", (q) => q.eq("ownerUserId", candidate)).order("desc").first();
    if (hit && owns(owner, hit) && (!latest || hit.date > latest.date)) latest = hit;
  }
  return latest;
};

const requireDate = (value: string | undefined, now: number) => {
  const date = value?.trim() || pragueDateKey(now);
  if (!isDateKey(date)) throw new ConvexError(`"${value}" is not a date; use YYYY-MM-DD (Europe/Prague).`);
  return date;
};

/**
 * The end of an edition's window: now for today's paper; for an earlier date,
 * 07:30 Prague on that day (the hour the cron runs).
 */
export const editionUntil = (date: string, now: number) => {
  if (date >= pragueDateKey(now)) return now;
  const [y, m, d] = date.split("-").map(Number);
  let at = Date.UTC(y!, m! - 1, d!, 5, 30);
  if (pragueDateKey(at) > date) at -= 60 * 60 * 1000;
  else if (pragueDateKey(at) < date) at += 60 * 60 * 1000;
  return at;
};

/**
 * Compile (or recompile) one edition. Idempotent on (owner, date): a second
 * run replaces the facts and keeps the agent's prose.
 */
export const compileEdition = async (ctx: MutationCtx, owner: string, input: { date?: string; now?: number; compiledBy: string }) => {
  const now = input.now ?? Date.now();
  const date = requireDate(input.date, now);
  const until = editionUntil(date, now);
  const since = until - NEWSPAPER_LIMITS.windowMs;
  const facts = await compileFacts(ctx, owner, since, until);
  const existing = await findEdition(ctx, owner, date);
  const patch = {
    compiledAt: now, since, until, facts: JSON.stringify(facts),
    done: facts.totals.done, needsYou: facts.totals.needsYou, saved: facts.totals.assets,
    compiledBy: input.compiledBy.trim().slice(0, 80) || "cron", updatedAt: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return (await ctx.db.get(existing._id))!;
  }
  const _id = await ctx.db.insert("newspapers", { ownerUserId: owner, date, ...patch, status: "compiled", createdAt: now });
  return (await ctx.db.get(_id))!;
};

const summaryOf = (paper: Newspaper) => ({
  _id: paper._id, date: paper.date, compiledAt: paper.compiledAt, status: paper.status,
  done: paper.done, needsYou: paper.needsYou, saved: paper.saved,
});

/** The cron's step for one owner, also callable from the CLI: `newspaper:compileNewspaper`. */
export const compileNewspaper = internalMutation({
  args: { ownerUserId: v.string(), date: v.optional(v.string()), compiledBy: v.optional(v.string()) },
  returns: newspaperSummaryValidator,
  handler: async (ctx, args) => summaryOf(await compileEdition(ctx, args.ownerUserId, { date: args.date, compiledBy: args.compiledBy ?? "cron" })),
});

/**
 * The daily cron: compile today's edition for the configured owner
 * (KB_OWNER_USER_ID, or the comma-separated NEWSPAPER_OWNER_USER_IDS) and
 * hand it to `notify`. Without an owner configured it logs and does nothing.
 */
export const compileAll = internalMutation({
  args: {},
  returns: v.array(newspaperSummaryValidator),
  handler: async (ctx) => {
    const owners = (process.env.NEWSPAPER_OWNER_USER_IDS ?? process.env.KB_OWNER_USER_ID ?? "")
      .split(",").map((value) => value.trim()).filter(Boolean);
    if (owners.length === 0) {
      console.log("newspaper: no owner configured (KB_OWNER_USER_ID); nothing compiled.");
      return [];
    }
    const out = [];
    for (const owner of owners) {
      const paper = await compileEdition(ctx, owner, { compiledBy: "cron" });
      await ctx.scheduler.runAfter(0, internal.newspaper.notify, { ownerUserId: owner, date: paper.date, done: paper.done, needsYou: paper.needsYou });
      out.push(summaryOf(paper));
    }
    return out;
  },
});

/**
 * "Morning newspaper <date>: N done, M need you — <link>" to the owner's
 * Telegram chat, through the same bot as the ingest notifications. With no
 * TELEGRAM_NOTIFY_BOT_TOKEN in the Convex env it logs one line and stops.
 */
export const notify = internalAction({
  args: { ownerUserId: v.string(), date: v.string(), done: v.number(), needsYou: v.number() },
  returns: v.boolean(),
  handler: async (_ctx, args) => {
    const token = resolveTelegramNotificationBotToken();
    const chatId = resolveTelegramChatId(args.ownerUserId);
    if (!token || !chatId) {
      console.log(`newspaper ${args.date}: Telegram not configured (TELEGRAM_NOTIFY_BOT_TOKEN${chatId ? "" : ", chat id"}); notification skipped.`);
      return false;
    }
    const text = `Morning newspaper ${args.date}: ${args.done} done, ${args.needsYou} need you — ${newspaperUrl(args.date)}`;
    return await sendTelegramMessage(token, chatId, text, "newspaper");
  },
});

/** On demand: compile today's (or a given date's) edition now. The UI's "Compile now" and the compile_newspaper tool. */
export const compile = ownerMutation({
  args: { ownerUserId: v.string(), date: v.optional(v.string()), compiledBy: v.optional(v.string()) },
  returns: newspaperDocValidator,
  handler: async (ctx, args) => compileEdition(ctx, args.ownerUserId, { date: args.date, compiledBy: args.compiledBy ?? "owner" }),
});

/** One edition: by date, or the latest. Null when nothing has been compiled yet. */
export const getNewspaper = ownerQuery({
  args: { ownerUserId: v.string(), date: v.optional(v.string()) },
  returns: v.union(newspaperDocValidator, v.null()),
  handler: async (ctx, args) => {
    const date = args.date?.trim();
    if (date) {
      if (!isDateKey(date)) throw new ConvexError(`"${date}" is not a date; use YYYY-MM-DD.`);
      return await findEdition(ctx, args.ownerUserId, date);
    }
    return await latestEdition(ctx, args.ownerUserId);
  },
});

/** The editions that exist, newest first: the date picker. */
export const listNewspapers = ownerQuery({
  args: { ownerUserId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(newspaperSummaryValidator),
  handler: async (ctx, args) => {
    const limit = Math.min(NEWSPAPER_LIMITS.list, Math.max(1, Math.floor(args.limit ?? NEWSPAPER_LIMITS.list)));
    const rows = await readOwned(args.ownerUserId, (candidate) => ctx.db.query("newspapers")
      .withIndex("by_owner_date", (q) => q.eq("ownerUserId", candidate)).order("desc").take(limit));
    return rows.filter((row) => owns(args.ownerUserId, row)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit).map(summaryOf);
  },
});

/** The agent's editorial for an edition. Replaces earlier prose; the facts stay. */
export const writeNewspaper = ownerMutation({
  args: { ownerUserId: v.string(), date: v.string(), prose: v.string(), writtenBy: v.optional(v.string()) },
  returns: newspaperDocValidator,
  handler: async (ctx, args) => {
    const date = args.date.trim();
    if (!isDateKey(date)) throw new ConvexError(`"${args.date}" is not a date; use YYYY-MM-DD.`);
    const prose = args.prose.trim();
    if (!prose) throw new ConvexError("The prose is empty.");
    if (prose.length > NEWSPAPER_LIMITS.prose) throw new ConvexError(`The prose is limited to ${NEWSPAPER_LIMITS.prose} characters.`);
    const paper = await findEdition(ctx, args.ownerUserId, date);
    if (!paper) throw new ConvexError(`No edition for ${date}. Compile it first (compile_newspaper), then write.`);
    const now = Date.now();
    await ctx.db.patch(paper._id, {
      prose, writtenAt: now, writtenBy: args.writtenBy?.trim().slice(0, NEWSPAPER_LIMITS.writtenBy) || "agent", status: "written", updatedAt: now,
    });
    return (await ctx.db.get(paper._id))!;
  },
});
