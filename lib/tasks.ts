// The agent task queue ("Tasks" in the gallery): work items Michael or an
// agent files, an agent claims and completes, and Michael reviews. Shared by
// the Convex backend, the agent route, the MCP schemas and the /tasks screens.

export const TASK_LIMITS = {
  title: 160,
  brief: 6000,
  result: 6000,
  comment: 4000,
  createdBy: 80,
  assignee: 80,
  ingestKey: 200,
  sourceRef: 200,
  linkLabel: 120,
  links: 40,
  list: 200,
  listDefault: 100,
  events: 300,
  // A claim lasts this long unless renewed; an expired claim is re-claimable.
  leaseMinutesDefault: 120,
  leaseMinutesMax: 24 * 60,
  // open_world carries this many open tasks.
  worldPreview: 5,
} as const;

export const TASK_STATUSES = ["open", "claimed", "done", "blocked", "archived"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** The statuses that still need work or an answer: what a queue shows by default. */
export const TASK_ACTIVE_STATUSES: readonly TaskStatus[] = ["open", "claimed", "blocked"];

export const TASK_PRIORITIES = [1, 2, 3] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = { 1: "Now", 2: "Next", 3: "Later" };

export const TASK_SOURCES = ["manual", "comment", "inbox", "newspaper"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

export const TASK_LINK_KINDS = ["asset", "story", "stack", "moodboard", "character", "collection", "doc", "url"] as const;
export type TaskLinkKind = (typeof TASK_LINK_KINDS)[number];
export type TaskLink = { kind: TaskLinkKind; id: string; label?: string };

export const TASK_EVENT_KINDS = ["create", "claim", "release", "status", "comment", "edit"] as const;
export type TaskEventKind = (typeof TASK_EVENT_KINDS)[number];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: "Open",
  claimed: "In flight",
  blocked: "Needs you",
  done: "Done",
  archived: "Archived",
};

/** `task:<id>` is the handle agents and Michael pass around; a bare id is accepted too. */
export const taskRef = (id: string) => `task:${id}`;
export const bareTaskRef = (value: string) => value.trim().replace(/^task:/, "");

/** `asset:<id>`, `story:<id>` …: a link handle agents paste into results. */
export const linkRef = (link: { kind: TaskLinkKind; id: string }) => (link.kind === "url" ? link.id : `${link.kind}:${link.id}`);

const LINK_PREFIX = /^(asset|story|stack|moodboard|character|collection|folder|doc|url):/;

/**
 * Parse a pasted handle into a typed link: "asset:k57…" → asset, "story:…" →
 * story, an http(s) URL → url, "folder:" → collection. A bare id with no
 * prefix is taken as an asset. Returns null for an empty string.
 */
export const parseLinkRef = (value: string): TaskLink | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return { kind: "url", id: trimmed };
  const match = LINK_PREFIX.exec(trimmed);
  if (!match) return { kind: "asset", id: trimmed };
  const kind = match[1] === "folder" ? "collection" : (match[1] as TaskLinkKind);
  const id = trimmed.slice(match[0].length).trim();
  return id ? { kind, id } : null;
};

/** An agent label is stored as `agent:<name>`; Michael is `owner`. */
export const agentActor = (label: string) => `agent:${label.trim().slice(0, TASK_LIMITS.createdBy - 6) || "unnamed"}`;
export const isOwnerActor = (actor: string) => actor === "owner";

/** A claim still holds when its lease has not run out. */
export const leaseActive = (task: { status: string; leaseUntil?: number }, now = Date.now()) =>
  task.status === "claimed" && (task.leaseUntil ?? 0) > now;

/** The first line of a comment, cut to a title: "Fix the hands on this one" */
export const titleFromText = (text: string, max = 120) => {
  const line = text.trim().split(/\r?\n/).find((part) => part.trim())?.trim() ?? "";
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 24))}…`;
};

export const taskAge = (at: number, now = Date.now()) => {
  const minutes = Math.round((now - at) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};
