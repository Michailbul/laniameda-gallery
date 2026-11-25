import { ConvexError, v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { signedOwnerMutation as ownerMutation, signedOwnerQuery as ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { resolveAssetThumbUrl } from "./r2_url";
import {
  batchRows, cleanCodes, mjQueueItemOutValidator, ownedRows, personalProfileCodes, resolveRef, text, toOut,
} from "./mjQueue";
import { mjRecipeValidator, mjThreadRoleValidator } from "./mjQueueValidators";
import { MJ_QUEUE_LIMITS, MJ_THREAD_ID, batchKeyOf, threadIdOf } from "../lib/mj-queue";
import { versionedParams } from "../lib/mj-version";
import {
  MJ_THREAD_LIMITS, applyRecipe, cleanRecipe, recipeIsEmpty, recipeLabel, runSettings, settingsLabel, threadOpening,
  type MjChatOp, type MjRecipe,
} from "../lib/mj-thread";

// A Midjourney queue thread as runs and a chat (23 Nov 2026). A rerun copies
// prompts into the next run with a new recipe; the earlier runs keep their
// sent commands, job ids and filed frames. The chat holds what Michael and the
// agent said and what each answer changed. Nothing here sends anything to
// Midjourney.

type Item = Doc<"mjQueueItems">;
type Ctx = QueryCtx | MutationCtx;
type Message = Doc<"mjThreadMessages">;
type RunRow = Doc<"mjThreadRuns">;

const runOf = (row: Pick<Item, "run">) => row.run ?? 1;
const isOpen = (row: Item) => row.status === "queued" || row.status === "injected";

/** A thread by its label, batch key or id thr-xxxxxxxx: its key and its prompts in order. */
export async function threadFor(ctx: Ctx, owner: string, ref: string) {
  const raw = ref.trim();
  if (!raw) throw new ConvexError("Name the thread (its label or thr-xxxxxxxx).");
  let batchKey = batchKeyOf(raw);
  if (MJ_THREAD_ID.test(raw.toLowerCase())) {
    const match = (await ownedRows(ctx, owner)).find((row) => threadIdOf(row.batchKey) === raw.toLowerCase());
    if (!match) throw new ConvexError(`No Midjourney queue thread ${raw}.`);
    batchKey = match.batchKey;
  }
  const rows = await batchRows(ctx, owner, batchKey);
  if (!rows.length) throw new ConvexError(`No Midjourney queue thread ${raw}.`);
  return { batchKey, batch: rows[0]!.batch, worldKey: rows.find((row) => row.worldKey)?.worldKey, worldFolderId: rows.find((row) => row.worldFolderId)?.worldFolderId, rows };
}

async function runRows(ctx: Ctx, owner: string, batchKey: string) {
  const out: RunRow[] = [];
  for (const candidate of resolveUserIdCandidates(owner)) {
    out.push(...await ctx.db.query("mjThreadRuns")
      .withIndex("by_owner_batchKey_run", (q) => q.eq("ownerUserId", candidate).eq("batchKey", batchKey)).take(200));
  }
  return out.sort((a, b) => a.run - b.run);
}

async function messageRows(ctx: Ctx, owner: string, batchKey: string, limit: number = MJ_THREAD_LIMITS.messagesRead) {
  const out: Message[] = [];
  for (const candidate of resolveUserIdCandidates(owner)) {
    out.push(...await ctx.db.query("mjThreadMessages")
      .withIndex("by_owner_batchKey_createdAt", (q) => q.eq("ownerUserId", candidate).eq("batchKey", batchKey))
      .order("desc").take(limit));
  }
  return out.sort((a, b) => a.createdAt - b.createdAt).slice(-limit);
}

const runOutValidator = v.object({
  run: v.number(),
  fromRun: v.optional(v.number()),
  count: v.number(),
  queued: v.number(),
  sent: v.number(),
  skipped: v.number(),
  // What its prompts carry ("e6pj8eo ejo6q4d · stylize 300 · chaos 25 · 16:9 · hd").
  settings: v.string(),
  opening: v.string(),
  mixed: v.array(v.string()),
  // What the rerun changed, in a few words; run 1 has none.
  label: v.optional(v.string()),
  recipe: v.optional(mjRecipeValidator),
  note: v.optional(v.string()),
  createdBy: v.optional(v.string()),
  createdAt: v.number(),
});
type RunOut = Infer<typeof runOutValidator>;

function runsOut(rows: Item[], runs: RunRow[]): RunOut[] {
  const byRun = new Map<number, Item[]>();
  for (const row of rows) {
    const list = byRun.get(runOf(row)) ?? [];
    list.push(row);
    byRun.set(runOf(row), list);
  }
  const numbers = [...new Set([...byRun.keys(), ...runs.map((run) => run.run)])].sort((a, b) => a - b);
  return numbers.map((n) => {
    const items = byRun.get(n) ?? [];
    const record = runs.find((run) => run.run === n);
    const settings = runSettings(items.map((item) => ({ prompt: item.prompt, profileCodes: item.profileCodes, params: item.params, styleRefs: item.styleRefs })));
    return {
      run: n,
      fromRun: record?.fromRun,
      count: items.length,
      queued: items.filter(isOpen).length,
      sent: items.filter((item) => item.status === "sent").length,
      skipped: items.filter((item) => item.status === "skipped").length,
      settings: settingsLabel(settings),
      opening: settings.opening,
      mixed: settings.mixed,
      label: record?.label,
      recipe: record?.recipe,
      note: record?.note,
      createdBy: record?.createdBy ?? items[0]?.createdBy,
      createdAt: record?.createdAt ?? Math.min(...items.map((item) => item.createdAt)),
    };
  });
}

const messageOutValidator = v.object({
  id: v.id("mjThreadMessages"),
  role: mjThreadRoleValidator,
  author: v.string(),
  text: v.string(),
  changes: v.optional(v.array(v.string())),
  run: v.optional(v.number()),
  replyTo: v.optional(v.id("mjThreadMessages")),
  status: v.optional(v.union(v.literal("waiting"), v.literal("answered"))),
  error: v.optional(v.string()),
  model: v.optional(v.string()),
  createdAt: v.number(),
});
const messageOut = (row: Message): Infer<typeof messageOutValidator> => ({
  id: row._id, role: row.role, author: row.author, text: row.text, changes: row.changes, run: row.run,
  replyTo: row.replyTo, status: row.status, error: row.error, model: row.model, createdAt: row.createdAt,
});

const threadStateValidator = v.object({
  batch: v.string(),
  batchKey: v.string(),
  threadId: v.string(),
  worldKey: v.optional(v.string()),
  runs: v.array(runOutValidator),
  latestRun: v.number(),
  messages: v.array(messageOutValidator),
  // Michael's messages no one has answered yet (the writer failed, or he left it for an agent).
  waiting: v.number(),
});

async function stateOf(ctx: Ctx, owner: string, ref: string) {
  const thread = await threadFor(ctx, owner, ref);
  const [runs, messages] = await Promise.all([runRows(ctx, owner, thread.batchKey), messageRows(ctx, owner, thread.batchKey)]);
  const runList = runsOut(thread.rows, runs);
  return {
    batch: thread.batch,
    batchKey: thread.batchKey,
    threadId: threadIdOf(thread.batchKey),
    worldKey: thread.worldKey,
    runs: runList,
    latestRun: runList.reduce((max, run) => Math.max(max, run.run), 1),
    messages: messages.map(messageOut),
    waiting: messages.filter((message) => message.role === "michael" && message.status === "waiting").length,
  };
}

/** A thread's runs (with what each carries) and its chat. */
export const threadState = ownerQuery({
  args: { ownerUserId: v.string(), batch: v.string() },
  returns: threadStateValidator,
  handler: async (ctx, args) => stateOf(ctx, args.ownerUserId, args.batch),
});

// ── Rerun and edit ──

const recipeArg = mjRecipeValidator;
const promptPatchArg = v.array(v.object({ itemId: v.string(), prompt: v.string() }));

function checkedRecipe(recipe: MjRecipe | undefined) {
  try {
    return cleanRecipe(recipe ?? {});
  } catch (error) {
    throw new ConvexError(error instanceof Error ? error.message : String(error));
  }
}

async function srefRefs(ctx: MutationCtx, owner: string, srefs: string[]) {
  const out = [];
  for (const [index, entry] of srefs.entries()) {
    if (/^https?:\/\//.test(entry)) out.push(await resolveRef(ctx, owner, { url: entry }, `Style reference ${index + 1}`));
    else {
      const [code, weight] = entry.split("::");
      out.push(await resolveRef(ctx, owner, { code, weight: weight ? Number(weight) : undefined }, `Style reference ${index + 1}`));
    }
  }
  return out;
}

// A prompt whose look changed (profiles, srefs, opening, params) is no longer
// its world style's or preset's recipe: it leaves them, so file_restyle_results
// and file_run_results never file its frames as that style or preset cell. It
// keeps its place, seed and its own exact settings, which name its combination.
const detachedLook = { styleId: undefined, styleLabel: undefined, presetId: undefined, presetLabel: undefined, runId: undefined } as const;

const rowIdIn = (rows: Item[], ref: string) => {
  const bare = ref.trim().replace(/^mjq(?:ueue)?:/, "");
  return rows.find((row) => row._id === bare);
};

type RerunInput = {
  fromRun?: number;
  itemIds?: string[];
  recipe?: MjRecipe;
  prompts?: Array<{ itemId: string; prompt: string }>;
  note?: string;
  createdBy: string;
  messageId?: Id<"mjThreadMessages">;
};

/** Copies prompts of a thread into its next run with the recipe applied. */
export async function rerun(ctx: MutationCtx, owner: string, thread: Awaited<ReturnType<typeof threadFor>>, input: RerunInput) {
  const rows = thread.rows;
  const latest = rows.reduce((max, row) => Math.max(max, runOf(row)), 1);
  const existingRuns = await runRows(ctx, owner, thread.batchKey);
  const next = Math.max(latest, ...existingRuns.map((run) => run.run)) + 1;
  let sources: Item[];
  if (input.itemIds?.length) {
    sources = [];
    for (const ref of input.itemIds) {
      const row = rowIdIn(rows, ref);
      if (!row) throw new ConvexError(`${ref} is not a prompt of this thread.`);
      if (!sources.includes(row)) sources.push(row);
    }
  } else {
    const fromRun = input.fromRun ?? latest;
    sources = rows.filter((row) => runOf(row) === fromRun && row.status !== "skipped");
    if (!sources.length) throw new ConvexError(`Run ${fromRun} has no prompts to rerun.`);
  }
  if (rows.length + sources.length > MJ_QUEUE_LIMITS.itemsPerBatch) {
    throw new ConvexError(`A thread holds at most ${MJ_QUEUE_LIMITS.itemsPerBatch} prompts; this rerun would make ${rows.length + sources.length}. Rerun fewer prompts, or queue a new thread.`);
  }
  const recipe = checkedRecipe(input.recipe);
  const opening = threadOpening(sources.map((row) => row.prompt));
  const styleRefs = recipe.srefs ? await srefRefs(ctx, owner, recipe.srefs) : undefined;
  const promptFor = new Map<string, string>();
  for (const patch of input.prompts ?? []) {
    const row = rowIdIn(rows, patch.itemId);
    if (!row) throw new ConvexError(`${patch.itemId} is not a prompt of this thread.`);
    const prompt = text(patch.prompt, MJ_QUEUE_LIMITS.prompt, "Prompt text");
    if (prompt) promptFor.set(row._id, prompt);
  }
  let order = rows.reduce((max, row) => Math.max(max, row.order), 0);
  const now = Date.now();
  const out = [];
  const fromRuns = new Set<number>();
  for (const source of sources) {
    fromRuns.add(runOf(source));
    const applied = applyRecipe({ prompt: promptFor.get(source._id) ?? source.prompt, profileCodes: source.profileCodes, params: source.params }, recipe, opening);
    const versioned = versionedParams(applied.params);
    const {
      _id, _creationTime, status: _s, injectedAt: _i, sentAt: _t, sentCommand: _c, jobId: _j, ingestKey: _k, archivedAt: _a, ...fields
    } = source;
    void _creationTime; void _s; void _i; void _t; void _c; void _j; void _k; void _a;
    order += 1;
    const id = await ctx.db.insert("mjQueueItems", {
      ...fields,
      prompt: applied.prompt,
      profileCodes: cleanCodes(applied.profileCodes),
      params: versioned.params,
      replacedVersion: versioned.replacedVersion,
      styleRefs: styleRefs ?? fields.styleRefs,
      ...(recipeIsEmpty(recipe) ? {} : detachedLook),
      order,
      run: next,
      requeuedFrom: source.requeuedFrom ?? _id,
      status: "queued" as const,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    });
    out.push(toOut((await ctx.db.get(id))!, await personalProfileCodes(ctx, owner)));
  }
  // An archived thread comes back with its rerun.
  for (const row of rows) if (row.archivedAt !== undefined) await ctx.db.patch(row._id, { archivedAt: undefined });
  const edited = promptFor.size ? `${promptFor.size} prompt${promptFor.size === 1 ? "" : "s"} rewritten` : "";
  const label = [recipeIsEmpty(recipe) ? "" : recipeLabel(recipe), edited].filter(Boolean).join(" · ") || "same settings";
  const fromRun = fromRuns.size === 1 ? [...fromRuns][0]! : latest;
  await ctx.db.insert("mjThreadRuns", {
    ownerUserId: owner, batchKey: thread.batchKey, batch: thread.batch, worldKey: thread.worldKey,
    run: next, fromRun, recipe, label: label.slice(0, MJ_THREAD_LIMITS.runLabel),
    note: text(input.note, MJ_THREAD_LIMITS.note, "A note"), itemCount: out.length,
    messageId: input.messageId, createdBy: input.createdBy, createdAt: now,
  });
  return { run: next, fromRun, label, items: out };
}

/** Applies a recipe in place to prompts still to send (all, or the ones named). Sent ones keep theirs. */
async function editOpen(ctx: MutationCtx, owner: string, rows: Item[], recipeInput: MjRecipe, targets?: Item[]) {
  const recipe = checkedRecipe(recipeInput);
  if (recipeIsEmpty(recipe)) throw new ConvexError("Say what to change: a profile, sref, stylize, chaos, aspect, raw, hd or the opening.");
  const chosen = targets ?? rows;
  const open = chosen.filter(isOpen);
  const opening = threadOpening(open.map((row) => row.prompt));
  const styleRefs = recipe.srefs ? await srefRefs(ctx, owner, recipe.srefs) : undefined;
  const now = Date.now();
  let changed = 0;
  for (const row of open) {
    const applied = applyRecipe({ prompt: row.prompt, profileCodes: row.profileCodes, params: row.params }, recipe, opening);
    const versioned = versionedParams(applied.params);
    const patch: Partial<Item> = {};
    if (applied.prompt !== row.prompt) patch.prompt = applied.prompt;
    const codes = cleanCodes(applied.profileCodes);
    if (codes.join(" ") !== row.profileCodes.join(" ")) patch.profileCodes = codes;
    if (versioned.params !== row.params) { patch.params = versioned.params; patch.replacedVersion = versioned.replacedVersion; }
    if (styleRefs) patch.styleRefs = styleRefs;
    if (Object.keys(patch).length) {
      Object.assign(patch, detachedLook);
      await ctx.db.patch(row._id, { ...patch, updatedAt: now });
      changed += 1;
    }
  }
  return { changed, leftAlone: chosen.length - open.length, label: recipeLabel(recipe) };
}

const createdByArg = v.optional(v.string());

/**
 * Rerun a thread: chosen prompts (default: every prompt of the latest run, or
 * of fromRun, skipped ones left out) are copied into the next run with the
 * recipe and prompt rewrites applied, queued for Michael to send. The earlier
 * runs stay as they were, with their jobs and frames.
 */
export const rerunThread = ownerMutation({
  args: {
    ownerUserId: v.string(),
    batch: v.string(),
    fromRun: v.optional(v.number()),
    itemIds: v.optional(v.array(v.string())),
    recipe: v.optional(recipeArg),
    prompts: v.optional(promptPatchArg),
    note: v.optional(v.string()),
    createdBy: createdByArg,
  },
  returns: v.object({ batch: v.string(), batchKey: v.string(), run: v.number(), fromRun: v.number(), label: v.string(), items: v.array(mjQueueItemOutValidator) }),
  handler: async (ctx, args) => {
    const thread = await threadFor(ctx, args.ownerUserId, args.batch);
    const createdBy = text(args.createdBy, 80, "createdBy") ?? "rerun";
    const result = await rerun(ctx, args.ownerUserId, thread, { ...args, createdBy });
    return { batch: thread.batch, batchKey: thread.batchKey, ...result };
  },
});

/** Change the recipe of a thread's prompts still to send, in place (no new run). */
export const editThread = ownerMutation({
  args: {
    ownerUserId: v.string(),
    batch: v.string(),
    recipe: recipeArg,
    itemIds: v.optional(v.array(v.string())),
  },
  returns: v.object({ batchKey: v.string(), changed: v.number(), leftAlone: v.number(), label: v.string() }),
  handler: async (ctx, args) => {
    const thread = await threadFor(ctx, args.ownerUserId, args.batch);
    const targets = args.itemIds?.length ? args.itemIds.map((ref) => {
      const row = rowIdIn(thread.rows, ref);
      if (!row) throw new ConvexError(`${ref} is not a prompt of this thread.`);
      return row;
    }) : undefined;
    const result = await editOpen(ctx, args.ownerUserId, thread.rows, args.recipe, targets);
    return { batchKey: thread.batchKey, ...result };
  },
});

// ── Chat ──

async function insertMessage(ctx: MutationCtx, owner: string, thread: { batchKey: string; batch: string; worldKey?: string }, input: {
  role: "michael" | "agent"; author: string; text: string; changes?: string[]; run?: number; replyTo?: Id<"mjThreadMessages">; model?: string;
}) {
  const body = text(input.text, input.role === "michael" ? MJ_THREAD_LIMITS.message : MJ_THREAD_LIMITS.reply, "A message");
  if (!body) throw new ConvexError("Write something first.");
  const changes = (input.changes ?? []).map((line) => line.trim().slice(0, MJ_THREAD_LIMITS.change)).filter(Boolean).slice(0, MJ_THREAD_LIMITS.changes);
  const now = Date.now();
  const id = await ctx.db.insert("mjThreadMessages", {
    ownerUserId: owner, batchKey: thread.batchKey, batch: thread.batch, worldKey: thread.worldKey,
    role: input.role, author: input.author.slice(0, 80), text: body,
    changes: changes.length ? changes : undefined, run: input.run, replyTo: input.replyTo,
    status: input.role === "michael" ? "waiting" : undefined, model: input.model?.slice(0, 80), createdAt: now,
  });
  if (input.role === "agent") {
    // An answer closes the message it replies to; one with no replyTo closes every waiting one.
    const waiting = (await messageRows(ctx, owner, thread.batchKey, 40)).filter((row) => row.role === "michael" && row.status === "waiting");
    for (const row of waiting) {
      if (!input.replyTo || row._id === input.replyTo) await ctx.db.patch(row._id, { status: "answered", error: undefined });
    }
  }
  return (await ctx.db.get(id))!;
}

async function messageFor(ctx: Ctx, owner: string, ref: string) {
  const id = ctx.db.normalizeId("mjThreadMessages", ref.trim().replace(/^msg:/, ""));
  const row = id ? await ctx.db.get(id) : null;
  if (!row || !canActorAccessOwnerUserId(owner, row.ownerUserId)) throw new ConvexError(`No thread message ${ref}.`);
  return row;
}

/**
 * A message in a thread's chat: Michael's (waiting for an answer) or an
 * agent's answer (with what it changed). An agent's answer closes the message
 * it replies to, or every waiting one.
 */
export const postMessage = ownerMutation({
  args: {
    ownerUserId: v.string(),
    batch: v.string(),
    role: mjThreadRoleValidator,
    text: v.string(),
    author: v.optional(v.string()),
    changes: v.optional(v.array(v.string())),
    run: v.optional(v.number()),
    replyTo: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  returns: messageOutValidator,
  handler: async (ctx, args) => {
    const thread = await threadFor(ctx, args.ownerUserId, args.batch);
    const replyTo = args.replyTo ? (await messageFor(ctx, args.ownerUserId, args.replyTo))._id : undefined;
    const row = await insertMessage(ctx, args.ownerUserId, thread, {
      role: args.role, author: text(args.author, 80, "author") ?? (args.role === "michael" ? "Michael" : "agent"),
      text: args.text, changes: args.changes, run: args.run, replyTo, model: args.model,
    });
    return messageOut(row);
  },
});

async function markFailed(ctx: MutationCtx, owner: string, messageId: string, error: string) {
  const row = await messageFor(ctx, owner, messageId);
  if (row.status === "waiting") await ctx.db.patch(row._id, { error: error.trim().slice(0, 300) || "The writer failed." });
  return null;
}

/** The writer could not answer: the message stays waiting, with why (the extension's This Mac runs). */
export const markWriterFailed = ownerMutation({
  args: { ownerUserId: v.string(), messageId: v.string(), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => markFailed(ctx, args.ownerUserId, args.messageId, args.error),
});

export const writerFailed = internalMutation({
  args: { ownerUserId: v.string(), messageId: v.string(), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => markFailed(ctx, args.ownerUserId, args.messageId, args.error),
});

// ── The chat writer's side (convex/mjThreadChat.ts) ──

type LookEntry = { code: string; name: string; kind: "moodboard" | "profile" | "code"; used: boolean; thumbUrl?: string };

/**
 * The thread's moodboard and profile codes by name (unknown codes keep the
 * code as their name), then the world's other moodboards and active profiles:
 * what the rerun card and the chat writer offer by name.
 */
async function lookOf(ctx: Ctx, owner: string, thread: { rows: Item[]; worldFolderId?: Id<"folders"> }): Promise<LookEntry[]> {
  const out: LookEntry[] = [];
  const seen = new Set<string>();
  const add = (entry: LookEntry) => {
    if (!entry.code || seen.has(entry.code)) return;
    seen.add(entry.code);
    out.push(entry);
  };
  // A board's cover picture, small, so the card shows the look, not a code.
  const coverOf = async (assetId: Id<"assets"> | undefined) => {
    const asset = assetId ? await ctx.db.get(assetId) : null;
    return asset ? (await resolveAssetThumbUrl(ctx, asset)) ?? undefined : undefined;
  };
  const candidates = resolveUserIdCandidates(owner);
  for (const code of new Set(thread.rows.flatMap((row) => row.profileCodes))) {
    let named: LookEntry | null = null;
    for (const candidate of candidates) {
      if (named) break;
      const board = await ctx.db.query("moodboards").withIndex("by_owner_mjCode", (q) => q.eq("ownerUserId", candidate).eq("mjCode", code)).first();
      if (board) { named = { code, name: board.name, kind: "moodboard", used: true, thumbUrl: await coverOf(board.coverAssetId) }; break; }
      const profile = await ctx.db.query("mjProfiles").withIndex("by_owner_code", (q) => q.eq("ownerUserId", candidate).eq("code", code)).first();
      if (profile) named = { code, name: profile.name, kind: "profile", used: true };
    }
    add(named ?? { code, name: code, kind: "code", used: true });
  }
  const root = thread.worldFolderId;
  if (root) {
    // A world's boards sit on its root or one collection below it.
    const inWorld = new Map<string, boolean>();
    const belongs = async (folderId: Id<"folders">) => {
      if (folderId === root) return true;
      if (!inWorld.has(folderId)) inWorld.set(folderId, (await ctx.db.get(folderId))?.parentFolderId === root);
      return inWorld.get(folderId)!;
    };
    for (const candidate of candidates) {
      const boards = await ctx.db.query("moodboards").withIndex("by_owner_updatedAt", (q) => q.eq("ownerUserId", candidate)).order("desc").take(300);
      for (const board of boards) {
        if (board.mjCode && !seen.has(board.mjCode) && await belongs(board.folderId)) {
          add({ code: board.mjCode, name: board.name, kind: "moodboard", used: false, thumbUrl: await coverOf(board.coverAssetId) });
        }
      }
      const all = await ctx.db.query("mjProfiles").withIndex("by_owner_normalizedName", (q) => q.eq("ownerUserId", candidate)).take(300);
      for (const profile of all) {
        if (profile.status === "active" && profile.uses.some((use) => use.worldFolderId === root)) add({ code: profile.code, name: profile.name, kind: "profile", used: false });
      }
    }
  }
  return out;
}

const lookEntryValidator = v.object({
  code: v.string(), name: v.string(), kind: v.union(v.literal("moodboard"), v.literal("profile"), v.literal("code")), used: v.boolean(),
  thumbUrl: v.optional(v.string()),
});

/** The thread's codes by name and the world's moodboards and profiles (the rerun card's picker). Read once per thread opened. */
export const threadLook = ownerQuery({
  args: { ownerUserId: v.string(), batch: v.string() },
  returns: v.object({ batchKey: v.string(), codes: v.array(lookEntryValidator) }),
  handler: async (ctx, args) => {
    const thread = await threadFor(ctx, args.ownerUserId, args.batch);
    return { batchKey: thread.batchKey, codes: await lookOf(ctx, args.ownerUserId, thread) };
  },
});

/** What the writer is shown: the prompts, runs, chat so far and the world's profiles and moodboards. */
export const chatContext = internalQuery({
  args: { ownerUserId: v.string(), batch: v.string(), messageId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const state = await stateOf(ctx, owner, args.batch);
    const thread = await threadFor(ctx, owner, state.batchKey);
    const message = await messageFor(ctx, owner, args.messageId);
    if (message.batchKey !== thread.batchKey) throw new ConvexError("That message belongs to another thread.");
    const history = state.messages.filter((entry) => entry.createdAt < message.createdAt || (entry.createdAt === message.createdAt && entry.id !== message._id))
      .map((entry) => ({ role: entry.role, text: entry.text, changes: entry.changes }));
    const profiles = (await lookOf(ctx, owner, thread)).map(({ name, code, kind }) => ({ name, code, kind }));
    return {
      batch: thread.batch,
      batchKey: thread.batchKey,
      worldKey: thread.worldKey,
      text: message.text,
      items: thread.rows.map((row, index) => ({
        n: index + 1, status: row.status, run: runOf(row), title: row.title, prompt: row.prompt,
        profileCodes: row.profileCodes, params: row.params, srefs: row.styleRefs.map((ref) => ref.code || ref.url || "").filter(Boolean),
      })),
      runs: state.runs.map((run) => ({ run: run.run, count: run.count, label: [run.settings, run.label ? `changed: ${run.label}` : ""].filter(Boolean).join(" · ") })),
      history,
      profiles,
    };
  },
});

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The writer's operations applied to the thread (checked one by one: a bad
 * one is reported, the rest still apply), then its reply posted with what
 * changed. Prompts are named by their number in the thread as it was shown.
 */
export const applyChatAnswer = internalMutation({
  args: {
    ownerUserId: v.string(),
    batch: v.string(),
    messageId: v.string(),
    reply: v.string(),
    ops: v.any(),
    dropped: v.array(v.string()),
    author: v.string(),
    model: v.optional(v.string()),
  },
  returns: v.object({ message: messageOutValidator, changes: v.array(v.string()), run: v.optional(v.number()) }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const thread = await threadFor(ctx, owner, args.batch);
    const message = await messageFor(ctx, owner, args.messageId);
    const rows = thread.rows;
    const byN = (n: number) => rows[n - 1];
    const changes: string[] = [];
    let run: number | undefined;
    const now = Date.now();
    const latestRun = rows.reduce((max, row) => Math.max(max, runOf(row)), 1);
    const ops = (Array.isArray(args.ops) ? args.ops : []) as MjChatOp[];
    // Positions after the edits: adds and moves rebuild the order once at the end.
    const order: Array<Item | Id<"mjQueueItems">> = [...rows];
    let reorder = false;

    for (const op of ops) {
      try {
        if (op.op === "edit") {
          const row = byN(op.item);
          if (!row) throw new Error(`#${op.item} does not exist`);
          if (!isOpen(row)) throw new Error(`#${op.item} is ${row.status}: rerun it to change it`);
          const patch: Partial<Item> = {};
          if (op.prompt) patch.prompt = text(op.prompt, MJ_QUEUE_LIMITS.prompt, "Prompt text")!;
          if (op.title) patch.title = text(op.title, MJ_QUEUE_LIMITS.title, "A title");
          if (op.note) patch.note = text(op.note, MJ_QUEUE_LIMITS.note, "A note");
          if (op.profileCodes) patch.profileCodes = cleanCodes(op.profileCodes);
          if (op.params !== undefined) {
            const versioned = versionedParams(text(op.params, MJ_QUEUE_LIMITS.params, "Params"));
            patch.params = versioned.params;
            patch.replacedVersion = versioned.replacedVersion;
          }
          if (!Object.keys(patch).length) continue;
          if (patch.profileCodes || patch.params !== undefined) Object.assign(patch, detachedLook);
          await ctx.db.patch(row._id, { ...patch, updatedAt: now });
          changes.push(`Edited #${op.item}${patch.prompt ? "" : ` (${Object.keys(patch).join(", ")})`}`);
        } else if (op.op === "add") {
          if (rows.length + 1 > MJ_QUEUE_LIMITS.itemsPerBatch) throw new Error("the thread is full");
          const after = op.after ? byN(op.after) : rows[rows.length - 1];
          const model = after ?? rows[rows.length - 1]!;
          const prompt = text(op.prompt, MJ_QUEUE_LIMITS.prompt, "Prompt text")!;
          const versioned = op.params !== undefined ? versionedParams(text(op.params, MJ_QUEUE_LIMITS.params, "Params")) : { params: model.params, replacedVersion: model.replacedVersion };
          const id = await ctx.db.insert("mjQueueItems", {
            ownerUserId: model.ownerUserId, worldFolderId: model.worldFolderId, worldKey: model.worldKey,
            batch: thread.batch, batchKey: thread.batchKey, order: model.order + 0.5,
            title: text(op.title, MJ_QUEUE_LIMITS.title, "A title"),
            prompt, imagePrompts: [], styleRefs: model.styleRefs,
            profileCodes: op.profileCodes ? cleanCodes(op.profileCodes) : model.profileCodes,
            params: versioned.params, replacedVersion: versioned.replacedVersion,
            note: text(op.note, MJ_QUEUE_LIMITS.note, "A note"),
            run: latestRun > 1 ? latestRun : undefined,
            status: "queued", createdBy: args.author, createdAt: now, updatedAt: now,
          });
          const at = after ? order.indexOf(after) + 1 : order.length;
          order.splice(at, 0, id);
          reorder = true;
          changes.push(`Added "${(op.title || prompt).slice(0, 60)}"${op.after ? ` after #${op.after}` : ""}`);
        } else if (op.op === "skip" || op.op === "restore") {
          const done: number[] = [];
          for (const n of op.items) {
            const row = byN(n);
            if (!row) continue;
            if (op.op === "skip" && isOpen(row)) await ctx.db.patch(row._id, { status: "skipped", updatedAt: now });
            else if (op.op === "restore" && row.status === "skipped") await ctx.db.patch(row._id, { status: "queued", updatedAt: now });
            else continue;
            done.push(n);
          }
          if (done.length) changes.push(`${op.op === "skip" ? "Skipped" : "Restored"} ${done.map((n) => `#${n}`).join(" ")}`);
        } else if (op.op === "move") {
          const row = byN(op.item);
          if (!row) throw new Error(`#${op.item} does not exist`);
          const from = order.indexOf(row);
          order.splice(from, 1);
          order.splice(Math.max(0, Math.min(order.length, op.to - 1)), 0, row);
          reorder = true;
          changes.push(`Moved #${op.item} to place ${op.to}`);
        } else if (op.op === "recipe") {
          const targets = op.items?.length ? op.items.map(byN).filter((row): row is Item => Boolean(row)) : undefined;
          const result = await editOpen(ctx, owner, rows, op.recipe, targets);
          changes.push(`${result.label} on ${plural(result.changed, "prompt")} to send${result.leftAlone ? ` (${result.leftAlone} sent or skipped left alone)` : ""}`);
        } else if (op.op === "rerun") {
          const itemIds = op.items?.length ? op.items.map(byN).filter((row): row is Item => Boolean(row)).map((row) => row._id) : undefined;
          const prompts = (op.prompts ?? []).map((entry) => ({ itemId: byN(entry.item)?._id ?? "", prompt: entry.prompt })).filter((entry) => entry.itemId);
          const fresh = await threadFor(ctx, owner, thread.batchKey);
          const result = await rerun(ctx, owner, fresh, {
            itemIds, fromRun: op.fromRun, recipe: op.recipe, prompts, note: op.note ?? message.text.slice(0, 300),
            createdBy: args.author, messageId: message._id,
          });
          run = result.run;
          changes.push(`Run ${result.run} queued: ${plural(result.items.length, "prompt")} from run ${result.fromRun} · ${result.label}`);
        }
      } catch (error) {
        changes.push(`Not done: ${error instanceof Error ? error.message : String(error)}`.slice(0, MJ_THREAD_LIMITS.change));
      }
    }
    if (reorder) {
      // The thread as ordered here, then anything a rerun in this answer appended, numbered 1, 2 …
      const placed = order.map((entry) => (typeof entry === "string" ? entry : entry._id));
      const rest = (await batchRows(ctx, owner, thread.batchKey)).filter((row) => !placed.includes(row._id)).map((row) => row._id);
      for (const [index, id] of [...placed, ...rest].entries()) {
        const current = await ctx.db.get(id);
        if (current && current.order !== index + 1) await ctx.db.patch(id, { order: index + 1 });
      }
    }
    for (const reason of args.dropped) changes.push(`Not done: ${reason}`.slice(0, MJ_THREAD_LIMITS.change));
    const posted = await insertMessage(ctx, owner, thread, {
      role: "agent", author: args.author, text: args.reply || (changes.length ? "Done." : "No change."),
      changes, run, replyTo: message._id, model: args.model,
    });
    return { message: messageOut(posted), changes, run };
  },
});

export type MjThreadState = Infer<typeof threadStateValidator>;
