import { v } from "convex/values";

// The agent task queue (convex/tasks.ts): work items an agent claims and
// completes, and Michael reviews. Shared by the schema and the functions'
// return validators.

export const taskStatusValidator = v.union(
  v.literal("open"), v.literal("claimed"), v.literal("done"), v.literal("blocked"), v.literal("archived"),
);

// 1 = now, 2 = next, 3 = later.
export const taskPriorityValidator = v.union(v.literal(1), v.literal(2), v.literal(3));

// Where the task came from. A comment or inbox task carries the source row id
// in sourceRef and dedupes on ingestKey ("comment:<id>", "inbox:<stackId>").
export const taskSourceValidator = v.union(
  v.literal("manual"), v.literal("comment"), v.literal("inbox"), v.literal("newspaper"),
);

export const taskLinkKindValidator = v.union(
  v.literal("asset"), v.literal("story"), v.literal("stack"), v.literal("moodboard"),
  v.literal("character"), v.literal("collection"), v.literal("doc"), v.literal("url"),
);

// A typed handle: a bare gallery id, a doc path or a URL, with an optional label.
export const taskLinkValidator = v.object({
  kind: taskLinkKindValidator,
  id: v.string(),
  label: v.optional(v.string()),
});

export const taskFields = {
  ownerUserId: v.string(),
  // The world (a root collection) the task belongs to; absent = studio-wide.
  worldFolderId: v.optional(v.id("folders")),
  title: v.string(),
  // Markdown: the whole instruction.
  brief: v.optional(v.string()),
  status: taskStatusValidator,
  priority: taskPriorityValidator,
  // "owner" or "agent:<name>".
  createdBy: v.string(),
  // Who the task is meant for; a claim fills claimedBy.
  assignee: v.optional(v.string()),
  claimedBy: v.optional(v.string()),
  claimedAt: v.optional(v.number()),
  // A claim holds until this time; past it, anyone may claim.
  leaseUntil: v.optional(v.number()),
  // Markdown written on complete or block: what was done, what is needed.
  result: v.optional(v.string()),
  links: v.array(taskLinkValidator),
  source: taskSourceValidator,
  sourceRef: v.optional(v.string()),
  // Stable key: creating again with it returns the existing task.
  ingestKey: v.optional(v.string()),
  // Set when Michael commented on a done task: it is open again for rework.
  needsRework: v.optional(v.boolean()),
  dueAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const taskDocValidator = v.object({
  _id: v.id("tasks"),
  _creationTime: v.number(),
  ...taskFields,
});

export const taskEventKindValidator = v.union(
  v.literal("create"), v.literal("claim"), v.literal("release"), v.literal("status"), v.literal("comment"), v.literal("edit"),
);

// One line of a task's timeline: a status change or a comment.
export const taskEventFields = {
  ownerUserId: v.string(),
  taskId: v.id("tasks"),
  kind: taskEventKindValidator,
  // "owner" or "agent:<name>".
  author: v.string(),
  body: v.optional(v.string()),
  from: v.optional(taskStatusValidator),
  to: v.optional(taskStatusValidator),
  createdAt: v.number(),
};

export const taskEventDocValidator = v.object({
  _id: v.id("taskEvents"),
  _creationTime: v.number(),
  ...taskEventFields,
});
