import { describe, expect, test } from "bun:test";
import schema from "../convex/schema";
import { taskDocValidator, taskEventDocValidator } from "../convex/taskValidators";
import {
  claimTask, commentTask, completeTask, countOpenTasks, createTask, getTask, listTasks, releaseTask, sortTasks, stripAssetFromTasks,
  updateTask, worldTaskSummary,
} from "../convex/tasks";
import { addAssetComment } from "../convex/assetComments";
import { decideInboxCard, postInboxCards, setInboxCardComment } from "../convex/inbox";
import { getWorldContext } from "../convex/worlds";
import {
  TASK_LIMITS, agentActor, bareTaskRef, leaseActive, linkRef, parseLinkRef, taskAge, taskRef, titleFromText,
} from "../lib/tasks";
import { taskCompleteSchema, taskCreateSchema, taskListSchema } from "../lib/tasks-contract";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";
import { callAsOwner } from "./helpers/call-as-owner";

const OWNER = "owner";
type AnyDoc = Record<string, unknown> & { _id: string };

const setup = async () => {
  const { db, ctx } = createMockConvexMutationCtx({
    indexOrder: {
      "tasks.by_owner_status_createdAt": ["ownerUserId", "status", "createdAt"],
      "tasks.by_world_status_createdAt": ["worldFolderId", "status", "createdAt"],
      "tasks.by_owner_ingestKey": ["ownerUserId", "ingestKey"],
      "taskEvents.by_task_createdAt": ["taskId", "createdAt"],
      "inboxCards.by_stack_position": ["stackId", "position"],
      "assetComments.by_asset_createdAt": ["assetId", "createdAt"],
      "worldChanges.by_owner_world_createdAt": ["ownerUserId", "worldFolderId", "createdAt"],
    },
  });
  (ctx.db as unknown as { system: { get: (id: string) => Promise<unknown> } }).system = { get: (id: string) => db.get(id) };
  const world = await db.insert("folders", { ownerUserId: OWNER, name: "DEAR ANNETE", normalizedName: "dear annete", worldKey: "dear-annete" });
  const shelf = await db.insert("folders", { ownerUserId: OWNER, name: "Cast", normalizedName: "x/cast", parentFolderId: world });
  const asset = (fields: Record<string, unknown> = {}) =>
    db.insert("assets", { ownerUserId: OWNER, kind: "image", tagIds: [], createdAt: Date.now(), width: 1600, height: 900, ...fields });
  const call = <F extends Parameters<typeof callAsOwner>[0]>(fn: F, args: Record<string, unknown>) =>
    callAsOwner(fn)(ctx, { ownerUserId: OWNER, ...args });
  const stranger = <F extends Parameters<typeof callAsOwner>[0]>(fn: F, args: Record<string, unknown>) =>
    callAsOwner(fn)(ctx, { ownerUserId: "stranger", ...args });
  const doc = async (id: string) => (await db.get(id)) as AnyDoc;
  const create = (fields: Record<string, unknown> = {}) =>
    call(createTask, { worldFolderId: world, title: "Fix the hands", createdBy: "agent:claude-eallin", ...fields });
  return { db, ctx, world, shelf, asset, call, stranger, doc, create };
};

describe("task helpers", () => {
  test("refs, links, actors, titles and ages", () => {
    expect(taskRef("t1")).toBe("task:t1");
    expect(bareTaskRef(" task:t1 ")).toBe("t1");
    expect(parseLinkRef("asset:k57abc")).toEqual({ kind: "asset", id: "k57abc" });
    expect(parseLinkRef("folder:f1")).toEqual({ kind: "collection", id: "f1" });
    expect(parseLinkRef("https://x.com/p/1")).toEqual({ kind: "url", id: "https://x.com/p/1" });
    expect(parseLinkRef("k57bare")).toEqual({ kind: "asset", id: "k57bare" });
    expect(parseLinkRef("story:")).toBeNull();
    expect(linkRef({ kind: "story", id: "s1" })).toBe("story:s1");
    expect(linkRef({ kind: "url", id: "https://a.b" })).toBe("https://a.b");
    expect(agentActor("claude-eallin")).toBe("agent:claude-eallin");
    expect(agentActor("   ")).toBe("agent:unnamed");
    expect(leaseActive({ status: "claimed", leaseUntil: Date.now() + 1000 })).toBe(true);
    expect(leaseActive({ status: "claimed", leaseUntil: Date.now() - 1 })).toBe(false);
    expect(leaseActive({ status: "open" })).toBe(false);
    expect(titleFromText("Fix the hands\n\nand the lamp")).toBe("Fix the hands");
    expect(titleFromText("a".repeat(200), 40).length).toBeLessThanOrEqual(40);
    expect(taskAge(Date.now() - 90 * 60000)).toBe("2h");
    expect(sortTasks([
      { status: "open", priority: 2, createdAt: 2 }, { status: "blocked", priority: 3, createdAt: 1 },
      { status: "open", priority: 1, createdAt: 1 }, { status: "claimed", priority: 1, createdAt: 1 },
    ]).map((row) => `${row.status}${row.priority}`)).toEqual(["blocked3", "claimed1", "open1", "open2"]);
  });

  test("the zod contract names the loop and accepts handles", () => {
    expect(taskListSchema.parse({ status: "active", world: "dear-annete" })).toMatchObject({ status: "active" });
    expect(() => taskListSchema.parse({ status: "waiting" })).toThrow();
    expect(taskCreateSchema.parse({ title: "x", links: [{ kind: "asset", id: "asset:a1" }] }).links).toHaveLength(1);
    expect(() => taskCreateSchema.parse({ title: "x".repeat(TASK_LIMITS.title + 1) })).toThrow();
    expect(taskCompleteSchema.parse({ taskId: "task:t1", result: "done", blocked: true })).toMatchObject({ blocked: true });
  });
});

describe("tasks backend", () => {
  test("the tables and their validators stay in step", () => {
    const tables = (schema as unknown as { tables: Record<string, { validator: { fields: Record<string, unknown> } }> }).tables;
    for (const [table, validator] of [["tasks", taskDocValidator], ["taskEvents", taskEventDocValidator]] as const) {
      const { _id, _creationTime, ...fields } = validator.fields;
      expect(_id && _creationTime).toBeTruthy();
      expect(Object.keys(fields).sort()).toEqual(Object.keys(tables[table].validator.fields).sort());
    }
  });

  test("create checks the world, dedupes on ingestKey and journals world tasks", async () => {
    const env = await setup();
    await expect(env.create({ worldFolderId: env.shelf })).rejects.toThrow("not a world");
    await expect(env.create({ title: "   " })).rejects.toThrow("needs a title");
    const first = await env.create({ ingestKey: "nightly:1", links: [{ kind: "asset", id: "a1" }, { kind: "asset", id: "a1" }], brief: "Look at asset:a1" });
    expect(first.created).toBe(true);
    expect(first.task).toMatchObject({ status: "open", priority: 2, worldName: "DEAR ANNETE", createdBy: "agent:claude-eallin", links: [{ kind: "asset", id: "a1" }] });
    const again = await env.create({ ingestKey: "nightly:1", title: "Different title" });
    expect(again).toMatchObject({ created: false, task: { _id: first.task._id, title: "Fix the hands" } });
    const studio = await env.call(createTask, { title: "Clean the Pinterest shelf", createdBy: "owner" });
    expect(studio.task.worldFolderId).toBeUndefined();
    expect(studio.task.worldName).toBeUndefined();
    const byKey = await env.call(createTask, { world: "dear-annete", title: "By key", createdBy: "owner" });
    expect(byKey.task.worldFolderId).toBe(env.world);
    expect(env.db.getTableDocs("tasks")).toHaveLength(3);
    const journal = env.db.getTableDocs("worldChanges");
    expect(journal.map((row) => [row.op, row.actor])).toEqual([["task.create", "agent:claude-eallin"], ["task.create", "owner"]]);
    expect(journal[0]).toMatchObject({ targetType: "tasks", targetId: `task:${first.task._id}`, summary: "Task filed: Fix the hands" });
    await expect(env.stranger(getTask, { taskId: first.task._id })).rejects.toThrow("Task not found");
  });

  test("claims hold a lease, renew for the same agent and lapse for another", async () => {
    const env = await setup();
    const { task } = await env.create();
    const claim = await env.call(claimTask, { taskId: task._id, claimedBy: "agent:claude-eallin", leaseMinutes: 30 });
    expect(claim).toMatchObject({ claimed: true, renewed: false, task: { status: "claimed", claimedBy: "agent:claude-eallin", assignee: "agent:claude-eallin" } });
    expect(claim.task.leaseUntil! - claim.task.claimedAt!).toBe(30 * 60_000);
    await expect(env.call(claimTask, { taskId: task._id, claimedBy: "agent:claude-artist" })).rejects.toThrow("is claimed by agent:claude-eallin until");
    const renewed = await env.call(claimTask, { taskId: task._id, claimedBy: "agent:claude-eallin" });
    expect(renewed.renewed).toBe(true);
    expect(renewed.task.leaseUntil!).toBeGreaterThan(claim.task.leaseUntil!);
    // The lease lapses: another agent takes over and the timeline says so.
    await env.db.patch(task._id, { leaseUntil: Date.now() - 1 });
    const takeover = await env.call(claimTask, { taskId: task._id, claimedBy: "agent:claude-artist" });
    expect(takeover.task).toMatchObject({ claimedBy: "agent:claude-artist", assignee: "agent:claude-eallin" });
    const events = (await env.call(getTask, { taskId: task._id })).events;
    expect(events.map((event: AnyDoc) => event.kind)).toEqual(["create", "claim", "claim"]);
    expect(events[2].body).toContain("took over from agent:claude-eallin");
    // Release puts it back; a done task cannot be claimed.
    await expect(env.call(releaseTask, { taskId: task._id, actor: "agent:claude-eallin" })).rejects.toThrow("held by agent:claude-artist");
    expect((await env.call(releaseTask, { taskId: task._id, actor: "owner", note: "not now" })).status).toBe("open");
    await env.call(completeTask, { taskId: task._id, result: "Done: asset:a2", actor: "agent:claude-artist" });
    await expect(env.call(claimTask, { taskId: task._id, claimedBy: "agent:claude-artist" })).rejects.toThrow("is done");
  });

  test("complete writes the result and links; blocked waits for Michael; his comment reopens", async () => {
    const env = await setup();
    const a2 = await env.asset({ agentDescription: "The repaired hands." });
    const { task } = await env.create({ links: [{ kind: "asset", id: "a1" }] });
    await env.call(claimTask, { taskId: task._id, claimedBy: "agent:claude-eallin" });
    await expect(env.call(completeTask, { taskId: task._id, result: "x", actor: "agent:claude-artist" })).rejects.toThrow("held by agent:claude-eallin");
    await expect(env.call(completeTask, { taskId: task._id, result: "  ", actor: "agent:claude-eallin" })).rejects.toThrow("name the asset");
    const blocked = await env.call(completeTask, { taskId: task._id, result: "Which hand: left or right?", status: "blocked", actor: "agent:claude-eallin" });
    expect(blocked).toMatchObject({ status: "blocked", claimedBy: undefined, result: "Which hand: left or right?" });
    expect(await env.call(countOpenTasks, {})).toEqual([{ worldFolderId: env.world, worldName: "DEAR ANNETE", open: 0, claimed: 0, blocked: 1 }]);
    // Michael answers: the task is open again, without the rework flag.
    const answered = await env.call(commentTask, { taskId: task._id, body: "Left.", author: "owner" });
    expect(answered).toMatchObject({ reopened: true, task: { status: "open", needsRework: undefined } });
    await env.call(claimTask, { taskId: task._id, claimedBy: "agent:claude-eallin" });
    const done = await env.call(completeTask, {
      taskId: task._id, result: `Repaired: asset:${a2}`, links: [{ kind: "asset", id: a2 }], actor: "agent:claude-eallin", session: "hands-2026-10-29",
    });
    expect(done).toMatchObject({ status: "done", links: [{ kind: "asset", id: "a1" }, { kind: "asset", id: a2 }] });
    const full = await env.call(getTask, { taskId: task._id });
    expect(full.links[1]).toMatchObject({ kind: "asset", id: a2, title: "The repaired hands." });
    expect(full.links[0]).toMatchObject({ kind: "asset", id: "a1", missing: true });
    expect(full.events.at(-1)).toMatchObject({ kind: "status", from: "claimed", to: "done", author: "agent:claude-eallin" });
    const journal = env.db.getTableDocs("worldChanges").filter((row) => row.op === "task.update");
    expect(journal.at(-1)).toMatchObject({ session: "hands-2026-10-29", summary: "Task done: Fix the hands" });
    // His comment on a done task reopens it for rework; an agent's does not.
    expect((await env.call(commentTask, { taskId: task._id, body: "noted", author: "agent:claude-eallin" })).reopened).toBe(false);
    const rework = await env.call(commentTask, { taskId: task._id, body: "Still six fingers.", author: "owner" });
    expect(rework.task).toMatchObject({ status: "open", needsRework: true });
    expect(await env.call(countOpenTasks, {})).toMatchObject([{ open: 1, blocked: 0 }]);
    // Michael closes and archives from the queue.
    expect((await env.call(updateTask, { taskId: task._id, status: "done", actor: "owner" })).needsRework).toBeUndefined();
    expect((await env.call(updateTask, { taskId: task._id, status: "archived", priority: 3 })).status).toBe("archived");
    await expect(env.call(completeTask, { taskId: task._id, result: "late" })).rejects.toThrow("is archived");
  });

  test("list and count read the queue in order, per world or studio-wide; open_world carries the summary", async () => {
    const env = await setup();
    const other = await env.db.insert("folders", { ownerUserId: OWNER, name: "ANDROMEDA", normalizedName: "andromeda", worldKey: "andromeda" });
    const later = await env.create({ title: "Later", priority: 3 });
    const now = await env.create({ title: "Now", priority: 1 });
    const flight = await env.create({ title: "In flight" });
    await env.call(claimTask, { taskId: flight.task._id, claimedBy: "agent:claude-bul" });
    const stuck = await env.create({ title: "Stuck" });
    await env.call(completeTask, { taskId: stuck.task._id, result: "?", status: "blocked", actor: "agent:claude-bul" });
    const studio = await env.call(createTask, { title: "Studio chore", createdBy: "owner", source: "manual" });
    const elsewhere = await env.call(createTask, { worldFolderId: other, title: "Elsewhere", createdBy: "owner" });
    const finished = await env.create({ title: "Finished" });
    await env.call(completeTask, { taskId: finished.task._id, result: "ok" });

    const active = await env.call(listTasks, {});
    expect(active.map((row: AnyDoc) => row.title)).toEqual(["Stuck", "In flight", "Now", "Elsewhere", "Studio chore", "Later"]);
    expect(active.find((row: AnyDoc) => row.title === "Studio chore").worldName).toBeUndefined();
    expect((await env.call(listTasks, { worldFolderId: env.world })).map((row: AnyDoc) => row.title)).toEqual(["Stuck", "In flight", "Now", "Later"]);
    expect((await env.call(listTasks, { world: "andromeda" })).map((row: AnyDoc) => row._id)).toEqual([elsewhere.task._id]);
    expect((await env.call(listTasks, { status: "done" })).map((row: AnyDoc) => row._id)).toEqual([finished.task._id]);
    expect((await env.call(listTasks, { status: "all" }))).toHaveLength(7);
    expect((await env.call(listTasks, { assignee: "agent:claude-bul" })).map((row: AnyDoc) => row.title)).toEqual(["Stuck", "In flight"]);
    expect((await env.call(listTasks, { limit: 2 })).map((row: AnyDoc) => row.title)).toEqual(["Stuck", "In flight"]);
    expect(await env.stranger(listTasks, {})).toEqual([]);

    expect(await env.call(countOpenTasks, {})).toEqual([
      { worldFolderId: env.world, worldName: "DEAR ANNETE", open: 2, claimed: 1, blocked: 1 },
      { worldFolderId: other, worldName: "ANDROMEDA", open: 1, claimed: 0, blocked: 0 },
      { worldFolderId: undefined, worldName: "Studio", open: 1, claimed: 0, blocked: 0 },
    ]);
    expect(await worldTaskSummary(env.ctx as never, env.world as never)).toEqual({
      open: 2, claimed: 1, blocked: 1,
      next: [{ id: now.task._id, title: "Now", priority: 1 }, { id: later.task._id, title: "Later", priority: 3 }],
    });
    const context = await env.call(getWorldContext, { world: "dear-annete" });
    expect(context.tasks).toMatchObject({ open: 2, claimed: 1, blocked: 1 });
    expect(context.tasks.next[0]).toMatchObject({ title: "Now", priority: 1 });
    expect(studio.task.source).toBe("manual");
  });

  test("Michael's asset comment becomes a task in the asset's world; agent and Inbox-note comments do not", async () => {
    const env = await setup();
    const a1 = await env.asset({ folderId: env.shelf });
    const comment = await env.call(addAssetComment, { assetId: a1, body: "Fix the hands.\n\nThe lamp is fine.", author: "owner" });
    const [task] = env.db.getTableDocs("tasks");
    expect(task).toMatchObject({
      worldFolderId: env.world, source: "comment", sourceRef: comment._id, ingestKey: `comment:${comment._id}`, status: "open", createdBy: "owner",
      title: `Comment on asset:${a1}: Fix the hands.`, links: [{ kind: "asset", id: a1 }],
    });
    expect(String(task.brief)).toContain("Fix the hands.\n\nThe lamp is fine.");
    await env.call(addAssetComment, { assetId: a1, body: "Done: asset:a9", author: "agent" });
    await env.call(addAssetComment, { assetId: a1, body: "note from the inbox", author: "owner", source: "inbox" });
    expect(env.db.getTableDocs("tasks")).toHaveLength(1);
    // An asset in no world files a studio-wide task.
    const loose = await env.asset();
    await env.call(addAssetComment, { assetId: loose, body: "More like this.", author: "owner" });
    expect(env.db.getTableDocs("tasks")[1]).toMatchObject({ worldFolderId: undefined, title: `Comment on asset:${loose}: More like this.` });
    // Deleting the asset strips the link, not the task.
    await stripAssetFromTasks(env.ctx as never, OWNER, a1 as never);
    expect((await env.doc(task._id)).links).toEqual([]);
  });

  test("the first Inbox answer on a stack files one task that tracks progress", async () => {
    const env = await setup();
    const [a1, a2] = [await env.asset(), await env.asset()];
    const { stackId, added: [ab, rule] } = await env.call(postInboxCards, {
      worldFolderId: env.world, stackTitle: "Golden pass", cards: [{ type: "ab", assetIds: [a1, a2] }, { type: "rule", assetIds: [], ruleText: "File them?" }],
    });
    expect(env.db.getTableDocs("tasks")).toHaveLength(0);
    await env.call(decideInboxCard, { cardId: ab, choice: "winner", pickedAssetId: a2 });
    const [task] = env.db.getTableDocs("tasks");
    expect(task).toMatchObject({
      title: "Apply decisions: Golden pass", source: "inbox", sourceRef: stackId, ingestKey: `inbox:${stackId}`, worldFolderId: env.world,
      links: [{ kind: "stack", id: stackId, label: "Golden pass" }],
    });
    expect(String(task.brief)).toContain("(1 of 2 cards decided)");
    await env.call(setInboxCardComment, { cardId: rule, text: "Only exteriors" });
    await env.call(decideInboxCard, { cardId: rule, choice: "yes" });
    expect(env.db.getTableDocs("tasks")).toHaveLength(1);
    expect(String((await env.doc(task._id)).brief)).toContain("(2 of 2 cards decided)");
    // Once an agent holds it, later answers leave the brief alone.
    await env.call(claimTask, { taskId: task._id, claimedBy: "agent:claude-eallin" });
    await env.call(decideInboxCard, { cardId: ab, choice: "neither" });
    expect(String((await env.doc(task._id)).brief)).toContain("(2 of 2 cards decided)");
  });
});
