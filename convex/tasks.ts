import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { signedOwnerMutation as ownerMutation, signedOwnerQuery as ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { recordWorldChange, resolveWorld } from "./worldCore";
import { resolveAssetThumbUrl } from "./r2_url";
import {
  taskDocValidator, taskEventDocValidator, taskLinkValidator, taskPriorityValidator, taskSourceValidator, taskStatusValidator,
} from "./taskValidators";
import { TASK_ACTIVE_STATUSES, TASK_LIMITS, isOwnerActor, leaseActive, type TaskStatus } from "../lib/tasks";

// The agent task queue ("Tasks" in the gallery). Michael comments on an asset
// or answers an Inbox stack, or someone files a task by hand; an agent lists
// the open tasks, claims one (a lease), works, and completes it with a result
// that names what it produced; Michael reads the result in /tasks and either
// closes the loop or comments, which reopens the task for rework.

type Task = Doc<"tasks">;
type TaskEvent = Doc<"taskEvents">;
type Link = Task["links"][number];

const text = (value: string | null | undefined, max: number, label: string) => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) throw new ConvexError(`${label} is limited to ${max} characters.`);
  return trimmed;
};

const owns = (owner: string, row: { ownerUserId?: string } | null): boolean =>
  Boolean(row && canActorAccessOwnerUserId(owner, row.ownerUserId));

const requireWorld = async (ctx: QueryCtx, owner: string, folderId: Id<"folders">) => {
  const folder = await ctx.db.get(folderId);
  if (!folder || !owns(owner, folder)) throw new ConvexError("World not found.");
  if (folder.parentFolderId !== undefined || folder.kind !== undefined) {
    throw new ConvexError(`"${folder.name}" is not a world: a task belongs to a root collection or to the studio.`);
  }
  return folder;
};

const requireTask = async (ctx: QueryCtx, owner: string, taskId: Id<"tasks">) => {
  const task = await ctx.db.get(taskId);
  if (!task || !owns(owner, task)) throw new ConvexError("Task not found.");
  return task;
};

const cleanActor = (value: string | undefined, fallback = "owner") => {
  const actor = value?.trim().slice(0, TASK_LIMITS.createdBy);
  return actor || fallback;
};

const cleanLinks = (links: Link[] | undefined): Link[] => {
  const seen = new Set<string>();
  const out: Link[] = [];
  for (const link of links ?? []) {
    const id = link.id.trim();
    if (!id) continue;
    const key = `${link.kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: link.kind, id, ...(link.label ? { label: link.label.trim().slice(0, TASK_LIMITS.linkLabel) } : {}) });
    if (out.length >= TASK_LIMITS.links) break;
  }
  return out;
};

const mergeLinks = (current: Link[], added: Link[] | undefined) => cleanLinks([...current, ...(added ?? [])]);

const worldNameOf = async (ctx: QueryCtx, worldFolderId: Id<"folders"> | undefined) =>
  worldFolderId ? ((await ctx.db.get(worldFolderId))?.name ?? "Unknown world") : undefined;

const addEvent = (ctx: MutationCtx, task: Task, event: Omit<TaskEvent, "_id" | "_creationTime" | "ownerUserId" | "taskId" | "createdAt">) =>
  ctx.db.insert("taskEvents", { ownerUserId: task.ownerUserId, taskId: task._id, createdAt: Date.now(), ...event });

// A world task is journaled so it reads next to the filings and doc edits of
// the same session. Studio-wide tasks have no world to journal in.
const journal = async (ctx: MutationCtx, op: "task.create" | "task.update", before: Task | null, after: Task, actor: string, session?: string) => {
  if (!after.worldFolderId) return;
  await recordWorldChange(ctx, {
    ownerUserId: after.ownerUserId, worldFolderId: after.worldFolderId, op, targetType: "tasks", targetId: `task:${after._id}`,
    summary: op === "task.create" ? `Task filed: ${after.title}` : `Task ${after.status}: ${after.title}`,
    before: before ?? undefined, after, actor, session,
  });
};

const findByIngestKey = async (ctx: QueryCtx, owner: string, ingestKey: string) => {
  for (const candidate of resolveUserIdCandidates(owner)) {
    const hit = await ctx.db.query("tasks")
      .withIndex("by_owner_ingestKey", (q) => q.eq("ownerUserId", candidate).eq("ingestKey", ingestKey)).first();
    if (hit) return hit;
  }
  return null;
};

export type NewTask = {
  worldFolderId?: Id<"folders">;
  title: string;
  brief?: string;
  priority?: 1 | 2 | 3;
  createdBy: string;
  assignee?: string;
  links?: Link[];
  source: Task["source"];
  sourceRef?: string;
  ingestKey?: string;
  dueAt?: number;
  session?: string;
};

/**
 * Insert a task, or return the one that already carries its ingestKey. Used by
 * createTask and by the hooks that turn an owner comment or an Inbox answer
 * into work. The world, when given, must be a root collection Michael owns.
 */
export const upsertTask = async (ctx: MutationCtx, owner: string, input: NewTask): Promise<{ task: Task; created: boolean }> => {
  const ingestKey = text(input.ingestKey, TASK_LIMITS.ingestKey, "ingestKey");
  if (ingestKey) {
    const existing = await findByIngestKey(ctx, owner, ingestKey);
    if (existing) return { task: existing, created: false };
  }
  const world = input.worldFolderId ? await requireWorld(ctx, owner, input.worldFolderId) : null;
  const title = text(input.title, TASK_LIMITS.title, "Title");
  if (!title) throw new ConvexError("A task needs a title.");
  const now = Date.now();
  const doc = {
    ownerUserId: world?.ownerUserId ?? owner,
    worldFolderId: world?._id,
    title,
    brief: text(input.brief, TASK_LIMITS.brief, "Brief"),
    status: "open" as const,
    priority: input.priority ?? 2,
    createdBy: cleanActor(input.createdBy),
    assignee: text(input.assignee, TASK_LIMITS.assignee, "Assignee"),
    links: cleanLinks(input.links),
    source: input.source,
    sourceRef: text(input.sourceRef, TASK_LIMITS.sourceRef, "sourceRef"),
    ingestKey,
    dueAt: input.dueAt,
    createdAt: now,
    updatedAt: now,
  };
  const _id = await ctx.db.insert("tasks", doc);
  const task = (await ctx.db.get(_id))!;
  await addEvent(ctx, task, { kind: "create", author: task.createdBy, to: "open" });
  await journal(ctx, "task.create", null, task, task.createdBy, input.session);
  return { task, created: true };
};

const patchTask = async (ctx: MutationCtx, task: Task, patch: Partial<Task>) => {
  await ctx.db.patch(task._id, { ...patch, updatedAt: Date.now() });
  return (await ctx.db.get(task._id))!;
};

const taskRowValidator = v.object({ ...taskDocValidator.fields, worldName: v.optional(v.string()) });
const withWorld = async (ctx: QueryCtx, task: Task) => ({ ...task, worldName: await worldNameOf(ctx, task.worldFolderId) });

const statusFilterValidator = v.union(taskStatusValidator, v.literal("active"), v.literal("all"));
const ALL_STATUSES: TaskStatus[] = ["open", "claimed", "blocked", "done", "archived"];
const STATUS_RANK: Record<TaskStatus, number> = { blocked: 0, claimed: 1, open: 2, done: 3, archived: 4 };

/** Queue order: what needs Michael, then what is in flight, then open by priority; newest first inside a group. */
export const sortTasks = <T extends { status: TaskStatus; priority: number; createdAt: number }>(rows: T[]) =>
  [...rows].sort((a, b) =>
    STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.priority - b.priority || b.createdAt - a.createdAt);

/**
 * Tasks, queue order. status defaults to active (open, claimed, blocked);
 * "all" includes done and archived. With worldFolderId: that world's tasks;
 * without: every task, studio-wide ones included.
 */
export const listTasks = ownerQuery({
  args: {
    ownerUserId: v.string(),
    worldFolderId: v.optional(v.id("folders")),
    // Alternative to worldFolderId: a world key, name or collection id.
    world: v.optional(v.string()),
    status: v.optional(statusFilterValidator),
    assignee: v.optional(v.string()),
    source: v.optional(taskSourceValidator),
    limit: v.optional(v.number()),
  },
  returns: v.array(taskRowValidator),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const limit = Math.min(TASK_LIMITS.list, Math.max(1, Math.floor(args.limit ?? TASK_LIMITS.listDefault)));
    const statuses: TaskStatus[] = args.status === undefined || args.status === "active"
      ? [...TASK_ACTIVE_STATUSES] : args.status === "all" ? ALL_STATUSES : [args.status];
    const rows: Task[] = [];
    const worldFolderId = args.worldFolderId ?? (args.world ? (await resolveWorld(ctx, owner, args.world))._id : undefined);
    if (worldFolderId) {
      await requireWorld(ctx, owner, worldFolderId);
      for (const status of statuses) {
        rows.push(...await ctx.db.query("tasks")
          .withIndex("by_world_status_createdAt", (q) => q.eq("worldFolderId", worldFolderId).eq("status", status))
          .order("desc").take(limit));
      }
    } else {
      for (const candidate of resolveUserIdCandidates(owner)) {
        for (const status of statuses) {
          rows.push(...await ctx.db.query("tasks")
            .withIndex("by_owner_status_createdAt", (q) => q.eq("ownerUserId", candidate).eq("status", status))
            .order("desc").take(limit));
        }
      }
    }
    const assignee = args.assignee?.trim();
    const visible = [...new Map(rows.filter((task) => owns(owner, task)).map((task) => [task._id, task])).values()]
      .filter((task) => !assignee || task.assignee === assignee || task.claimedBy === assignee)
      .filter((task) => !args.source || task.source === args.source);
    const out = [];
    for (const task of sortTasks(visible).slice(0, limit)) out.push(await withWorld(ctx, task));
    return out;
  },
});

/** Open, claimed and blocked counts per world, plus one studio-wide row (no worldFolderId), for badges. */
export const countOpenTasks = ownerQuery({
  args: { ownerUserId: v.string() },
  returns: v.array(v.object({
    worldFolderId: v.optional(v.id("folders")),
    worldName: v.string(),
    open: v.number(),
    claimed: v.number(),
    blocked: v.number(),
  })),
  handler: async (ctx, args) => {
    const byWorld = new Map<string, { worldFolderId?: Id<"folders">; open: number; claimed: number; blocked: number }>();
    const seen = new Set<string>();
    for (const candidate of resolveUserIdCandidates(args.ownerUserId)) {
      for (const status of TASK_ACTIVE_STATUSES) {
        const rows = await ctx.db.query("tasks")
          .withIndex("by_owner_status_createdAt", (q) => q.eq("ownerUserId", candidate).eq("status", status)).take(500);
        for (const row of rows) {
          if (seen.has(row._id)) continue;
          seen.add(row._id);
          const key = row.worldFolderId ?? "";
          const entry = byWorld.get(key) ?? { worldFolderId: row.worldFolderId, open: 0, claimed: 0, blocked: 0 };
          if (row.status === "open" || row.status === "claimed" || row.status === "blocked") entry[row.status] += 1;
          byWorld.set(key, entry);
        }
      }
    }
    const result = [];
    for (const entry of byWorld.values()) {
      if (entry.worldFolderId) {
        const world = await ctx.db.get(entry.worldFolderId);
        if (!world || !owns(args.ownerUserId, world)) continue;
        result.push({ ...entry, worldName: world.name });
      } else {
        result.push({ ...entry, worldName: "Studio" });
      }
    }
    return result.sort((a, b) => b.blocked - a.blocked || b.open - a.open || a.worldName.localeCompare(b.worldName));
  },
});

const resolvedLinkValidator = v.object({
  ...taskLinkValidator.fields,
  // Filled for gallery objects that still exist: a title and, for assets, a thumbnail.
  title: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
  missing: v.optional(v.boolean()),
});

const resolveLink = async (ctx: QueryCtx, owner: string, link: Link) => {
  const out: { kind: Link["kind"]; id: string; label?: string; title?: string; thumbUrl?: string; missing?: boolean } = { ...link };
  const lookup = async <T extends "assets" | "stories" | "inboxStacks" | "moodboards" | "characters" | "folders">(table: T) => {
    const id = ctx.db.normalizeId(table, link.id);
    const row = id ? await ctx.db.get(id) : null;
    return row && owns(owner, row as { ownerUserId?: string }) ? (row as Doc<T>) : null;
  };
  switch (link.kind) {
    case "asset": {
      const asset = await lookup("assets");
      if (!asset) out.missing = true;
      else {
        out.thumbUrl = await resolveAssetThumbUrl(ctx, asset);
        out.title = asset.agentDescription?.slice(0, 120) ?? asset.description?.slice(0, 120);
      }
      break;
    }
    case "story": { const row = await lookup("stories"); if (row) out.title = row.title; else out.missing = true; break; }
    case "stack": { const row = await lookup("inboxStacks"); if (row) out.title = row.title; else out.missing = true; break; }
    case "moodboard": { const row = await lookup("moodboards"); if (row) out.title = row.name; else out.missing = true; break; }
    case "character": { const row = await lookup("characters"); if (row) out.title = `${row.code} ${row.name}`; else out.missing = true; break; }
    case "collection": { const row = await lookup("folders"); if (row) out.title = row.name; else out.missing = true; break; }
    default: break;
  }
  return out;
};

/** One task in full: its row, world name, resolved links and its timeline, oldest first. */
export const getTask = ownerQuery({
  args: { ownerUserId: v.string(), taskId: v.id("tasks") },
  returns: v.object({
    task: taskRowValidator,
    links: v.array(resolvedLinkValidator),
    events: v.array(taskEventDocValidator),
  }),
  handler: async (ctx, args) => {
    const task = await requireTask(ctx, args.ownerUserId, args.taskId);
    const events = await ctx.db.query("taskEvents")
      .withIndex("by_task_createdAt", (q) => q.eq("taskId", task._id)).order("asc").take(TASK_LIMITS.events);
    const links = [];
    for (const link of task.links) links.push(await resolveLink(ctx, args.ownerUserId, link));
    return { task: await withWorld(ctx, task), links, events };
  },
});

export const createTask = ownerMutation({
  args: {
    ownerUserId: v.string(),
    worldFolderId: v.optional(v.id("folders")),
    // Alternative to worldFolderId: a world key, name or collection id.
    world: v.optional(v.string()),
    title: v.string(),
    brief: v.optional(v.string()),
    priority: v.optional(taskPriorityValidator),
    createdBy: v.optional(v.string()),
    assignee: v.optional(v.string()),
    links: v.optional(v.array(taskLinkValidator)),
    source: v.optional(taskSourceValidator),
    sourceRef: v.optional(v.string()),
    ingestKey: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    session: v.optional(v.string()),
  },
  returns: v.object({ task: taskRowValidator, created: v.boolean() }),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const worldFolderId = args.worldFolderId ?? (args.world ? (await resolveWorld(ctx, owner, args.world))._id : undefined);
    const { task, created } = await upsertTask(ctx, owner, {
      worldFolderId, title: args.title, brief: args.brief, priority: args.priority,
      createdBy: cleanActor(args.createdBy), assignee: args.assignee, links: args.links,
      source: args.source ?? "manual", sourceRef: args.sourceRef, ingestKey: args.ingestKey, dueAt: args.dueAt, session: args.session,
    });
    return { task: await withWorld(ctx, task), created };
  },
});

/**
 * Take a task: an open one, one whose claim lapsed, or one you already hold
 * (which renews the lease). Refused while another claimant's lease holds and
 * once the task is done, blocked or archived.
 */
export const claimTask = ownerMutation({
  args: {
    ownerUserId: v.string(),
    taskId: v.id("tasks"),
    claimedBy: v.string(),
    leaseMinutes: v.optional(v.number()),
  },
  returns: v.object({ claimed: v.boolean(), renewed: v.boolean(), task: taskRowValidator }),
  handler: async (ctx, args) => {
    const task = await requireTask(ctx, args.ownerUserId, args.taskId);
    const claimedBy = cleanActor(args.claimedBy, "agent:unnamed");
    const minutes = Math.min(TASK_LIMITS.leaseMinutesMax, Math.max(1, Math.floor(args.leaseMinutes ?? TASK_LIMITS.leaseMinutesDefault)));
    const now = Date.now();
    const leaseUntil = now + minutes * 60_000;
    if (task.status === "claimed") {
      if (task.claimedBy === claimedBy) {
        const renewed = await patchTask(ctx, task, { leaseUntil });
        return { claimed: true, renewed: true, task: await withWorld(ctx, renewed) };
      }
      if (leaseActive(task, now)) {
        throw new ConvexError(`task:${task._id} is claimed by ${task.claimedBy} until ${new Date(task.leaseUntil!).toISOString()}.`);
      }
    } else if (task.status !== "open") {
      throw new ConvexError(`task:${task._id} is ${task.status}; only an open task (or a lapsed claim) can be claimed.`);
    }
    const claimed = await patchTask(ctx, task, { status: "claimed", claimedBy, claimedAt: now, leaseUntil, assignee: task.assignee ?? claimedBy });
    await addEvent(ctx, task, {
      kind: "claim", author: claimedBy, from: task.status, to: "claimed",
      body: task.status === "claimed" ? `took over from ${task.claimedBy} (lease lapsed)` : undefined,
    });
    return { claimed: true, renewed: false, task: await withWorld(ctx, claimed) };
  },
});

const mayAct = (task: Task, actor: string, now = Date.now()) =>
  isOwnerActor(actor) || task.status !== "claimed" || task.claimedBy === actor || !leaseActive(task, now);

/** Give a claimed task back to the queue. The claimant, or Michael, or anyone once the lease lapsed. */
export const releaseTask = ownerMutation({
  args: { ownerUserId: v.string(), taskId: v.id("tasks"), actor: v.optional(v.string()), note: v.optional(v.string()) },
  returns: taskRowValidator,
  handler: async (ctx, args) => {
    const task = await requireTask(ctx, args.ownerUserId, args.taskId);
    const actor = cleanActor(args.actor);
    if (task.status !== "claimed") return await withWorld(ctx, task);
    if (!mayAct(task, actor)) throw new ConvexError(`task:${task._id} is held by ${task.claimedBy}; its lease has not lapsed.`);
    const released = await patchTask(ctx, task, { status: "open", claimedBy: undefined, claimedAt: undefined, leaseUntil: undefined });
    await addEvent(ctx, task, { kind: "release", author: actor, from: "claimed", to: "open", body: text(args.note, TASK_LIMITS.comment, "Note") });
    return await withWorld(ctx, released);
  },
});

/**
 * Finish a task: done with a result that names what was produced (links), or
 * blocked with the question Michael has to answer. A blocked task shows under
 * Needs you; his comment reopens it.
 */
export const completeTask = ownerMutation({
  args: {
    ownerUserId: v.string(),
    taskId: v.id("tasks"),
    result: v.string(),
    status: v.optional(v.union(v.literal("done"), v.literal("blocked"))),
    links: v.optional(v.array(taskLinkValidator)),
    actor: v.optional(v.string()),
    session: v.optional(v.string()),
  },
  returns: taskRowValidator,
  handler: async (ctx, args) => {
    const task = await requireTask(ctx, args.ownerUserId, args.taskId);
    const actor = cleanActor(args.actor);
    const status = args.status ?? "done";
    const result = text(args.result, TASK_LIMITS.result, "Result");
    if (!result) throw new ConvexError(status === "done" ? "Say what was done and name the asset:/story:/stack: ids produced." : "Say what you need from Michael.");
    if (task.status === "archived") throw new ConvexError(`task:${task._id} is archived.`);
    if (task.status === status && task.result === result) return await withWorld(ctx, task);
    if (!mayAct(task, actor)) throw new ConvexError(`task:${task._id} is held by ${task.claimedBy}; claim it first or wait for the lease to lapse.`);
    const finished = await patchTask(ctx, task, {
      status, result, links: mergeLinks(task.links, args.links),
      claimedBy: undefined, claimedAt: undefined, leaseUntil: undefined,
      needsRework: undefined,
      assignee: task.assignee ?? (isOwnerActor(actor) ? undefined : actor),
    });
    await addEvent(ctx, task, { kind: "status", author: actor, from: task.status, to: status, body: result });
    await journal(ctx, "task.update", task, finished, actor, args.session);
    return await withWorld(ctx, finished);
  },
});

/**
 * A note on the task's timeline. Michael's comment on a done or blocked task
 * reopens it (done: flagged needs rework); the claimant's comment renews the
 * lease, so progress notes keep the claim alive.
 */
export const commentTask = ownerMutation({
  args: { ownerUserId: v.string(), taskId: v.id("tasks"), body: v.string(), author: v.optional(v.string()) },
  returns: v.object({ task: taskRowValidator, reopened: v.boolean() }),
  handler: async (ctx, args) => {
    const task = await requireTask(ctx, args.ownerUserId, args.taskId);
    const author = cleanActor(args.author);
    const body = text(args.body, TASK_LIMITS.comment, "Comment");
    if (!body) throw new ConvexError("A comment needs text.");
    await addEvent(ctx, task, { kind: "comment", author, body });
    let updated = task;
    let reopened = false;
    if (isOwnerActor(author) && (task.status === "done" || task.status === "blocked")) {
      updated = await patchTask(ctx, task, { status: "open", needsRework: task.status === "done" ? true : task.needsRework });
      await addEvent(ctx, task, { kind: "status", author, from: task.status, to: "open", body: task.status === "done" ? "reopened for rework" : "answered" });
      await journal(ctx, "task.update", task, updated, author);
      reopened = true;
    } else if (task.status === "claimed" && task.claimedBy === author) {
      updated = await patchTask(ctx, task, { leaseUntil: Date.now() + TASK_LIMITS.leaseMinutesDefault * 60_000 });
    } else {
      updated = await patchTask(ctx, task, {});
    }
    return { task: await withWorld(ctx, updated), reopened };
  },
});

/** Michael's edits from the queue: close, reopen, archive, or change title, brief, priority, due date. */
export const updateTask = ownerMutation({
  args: {
    ownerUserId: v.string(),
    taskId: v.id("tasks"),
    status: v.optional(v.union(v.literal("open"), v.literal("done"), v.literal("archived"))),
    title: v.optional(v.string()),
    brief: v.optional(v.union(v.string(), v.null())),
    priority: v.optional(taskPriorityValidator),
    dueAt: v.optional(v.union(v.number(), v.null())),
    actor: v.optional(v.string()),
  },
  returns: taskRowValidator,
  handler: async (ctx, args) => {
    const task = await requireTask(ctx, args.ownerUserId, args.taskId);
    const actor = cleanActor(args.actor);
    const patch: Partial<Task> = {};
    if (args.title !== undefined) {
      const title = text(args.title, TASK_LIMITS.title, "Title");
      if (!title) throw new ConvexError("A task needs a title.");
      patch.title = title;
    }
    if (args.brief !== undefined) patch.brief = args.brief === null ? undefined : text(args.brief, TASK_LIMITS.brief, "Brief");
    if (args.priority !== undefined) patch.priority = args.priority;
    if (args.dueAt !== undefined) patch.dueAt = args.dueAt === null ? undefined : args.dueAt;
    const edited = Object.keys(patch).length > 0;
    if (args.status !== undefined && args.status !== task.status) {
      if (!mayAct(task, actor)) throw new ConvexError(`task:${task._id} is held by ${task.claimedBy}; its lease has not lapsed.`);
      patch.status = args.status;
      patch.claimedBy = undefined; patch.claimedAt = undefined; patch.leaseUntil = undefined;
      if (args.status !== "open") patch.needsRework = undefined;
    }
    if (!edited && patch.status === undefined) return await withWorld(ctx, task);
    const updated = await patchTask(ctx, task, patch);
    if (edited) await addEvent(ctx, task, { kind: "edit", author: actor, body: Object.keys(patch).filter((key) => key !== "status").join(", ") });
    if (patch.status) {
      await addEvent(ctx, task, { kind: "status", author: actor, from: task.status, to: patch.status });
      await journal(ctx, "task.update", task, updated, actor);
    }
    return await withWorld(ctx, updated);
  },
});

/** Counts and the newest open tasks of one world, for open_world and the AGENT view. */
export const worldTaskSummary = async (ctx: QueryCtx, worldFolderId: Id<"folders">) => {
  const counts = { open: 0, claimed: 0, blocked: 0 };
  const open: Task[] = [];
  for (const status of TASK_ACTIVE_STATUSES) {
    const rows = await ctx.db.query("tasks")
      .withIndex("by_world_status_createdAt", (q) => q.eq("worldFolderId", worldFolderId).eq("status", status))
      .order("desc").take(200);
    if (status === "open" || status === "claimed" || status === "blocked") counts[status] = rows.length;
    if (status === "open") open.push(...rows);
  }
  return {
    ...counts,
    next: sortTasks(open).slice(0, TASK_LIMITS.worldPreview).map((task) => ({ id: task._id, title: task.title, priority: task.priority })),
  };
};

export const worldTaskSummaryValidator = v.object({
  open: v.number(), claimed: v.number(), blocked: v.number(),
  next: v.array(v.object({ id: v.id("tasks"), title: v.string(), priority: taskPriorityValidator })),
});

/**
 * Part of the asset delete cascade: a task keeps its text, but a link to an
 * asset that is gone is dropped so results never point at nothing.
 */
export const stripAssetFromTasks = async (ctx: MutationCtx, owner: string, assetId: Id<"assets">) => {
  for (const candidate of resolveUserIdCandidates(owner)) {
    for (const status of ALL_STATUSES) {
      const rows = await ctx.db.query("tasks")
        .withIndex("by_owner_status_createdAt", (q) => q.eq("ownerUserId", candidate).eq("status", status)).take(500);
      for (const row of rows) {
        if (!row.links.some((link) => link.kind === "asset" && link.id === assetId)) continue;
        await ctx.db.patch(row._id, { links: row.links.filter((link) => !(link.kind === "asset" && link.id === assetId)), updatedAt: Date.now() });
      }
    }
  }
};

/* ── Review deck ─────────────────────────────────────────────────────────── */

const taskCardValidator = v.object({
  ...taskRowValidator.fields,
  // The pictures the task is about: its asset links that still exist, first four.
  thumbs: v.array(v.object({
    assetId: v.id("assets"),
    url: v.string(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  })),
});

/** Review order: what needs Michael, then finished work to accept, then open by priority, then in flight. */
const DECK_RANK: Record<TaskStatus, number> = { blocked: 0, done: 1, open: 2, claimed: 3, archived: 4 };

/**
 * The review deck (/tasks, Human view): every task Michael can act on, as a
 * card with its pictures. Done tasks stay until he accepts (archives) them or
 * sends them back with a comment.
 */
export const listTaskCards = ownerQuery({
  args: {
    ownerUserId: v.string(),
    worldFolderId: v.optional(v.id("folders")),
    limit: v.optional(v.number()),
  },
  returns: v.array(taskCardValidator),
  handler: async (ctx, args) => {
    const owner = args.ownerUserId;
    const limit = Math.min(TASK_LIMITS.list, Math.max(1, Math.floor(args.limit ?? TASK_LIMITS.listDefault)));
    const statuses: TaskStatus[] = ["blocked", "done", "open", "claimed"];
    const rows: Task[] = [];
    if (args.worldFolderId) {
      await requireWorld(ctx, owner, args.worldFolderId);
      for (const status of statuses) {
        rows.push(...await ctx.db.query("tasks")
          .withIndex("by_world_status_createdAt", (q) => q.eq("worldFolderId", args.worldFolderId!).eq("status", status))
          .order("desc").take(limit));
      }
    } else {
      for (const candidate of resolveUserIdCandidates(owner)) {
        for (const status of statuses) {
          rows.push(...await ctx.db.query("tasks")
            .withIndex("by_owner_status_createdAt", (q) => q.eq("ownerUserId", candidate).eq("status", status))
            .order("desc").take(limit));
        }
      }
    }
    const visible = [...new Map(rows.filter((task) => owns(owner, task)).map((task) => [task._id, task])).values()]
      .sort((a, b) => DECK_RANK[a.status] - DECK_RANK[b.status] || a.priority - b.priority || b.updatedAt - a.updatedAt)
      .slice(0, limit);
    const out = [];
    for (const task of visible) {
      // Every picture the task is about, in this order: its asset links, the
      // asset:<id> references in its result and brief, and for a task filed
      // from an Inbox stack the images of that stack's cards. Michael's rule:
      // if images are related, they are shown. Eight at most.
      const candidates: string[] = task.links.filter((link) => link.kind === "asset").map((link) => link.id);
      for (const match of `${task.result ?? ""}\n${task.brief ?? ""}`.matchAll(/asset:([a-z0-9]{20,40})/g)) candidates.push(match[1]!);
      if (task.source === "inbox" && task.sourceRef) {
        const stackId = ctx.db.normalizeId("inboxStacks", task.sourceRef);
        if (stackId) {
          const cards = await ctx.db.query("inboxCards").withIndex("by_stack_position", (q) => q.eq("stackId", stackId)).take(8);
          candidates.push(...cards.flatMap((card) => card.assetIds as string[]));
        }
      }
      const thumbs = [];
      const seenAssets = new Set<string>();
      for (const candidate of candidates) {
        if (thumbs.length >= 8) break;
        const id = ctx.db.normalizeId("assets", candidate);
        if (!id || seenAssets.has(id)) continue;
        seenAssets.add(id);
        const asset = await ctx.db.get(id);
        if (!asset || !owns(owner, asset)) continue;
        const url = await resolveAssetThumbUrl(ctx, asset);
        if (url) thumbs.push({ assetId: asset._id, url, width: asset.width ?? undefined, height: asset.height ?? undefined });
      }
      out.push({ ...(await withWorld(ctx, task)), thumbs });
    }
    return out;
  },
});
