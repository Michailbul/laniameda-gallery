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

/* ── The task as an agent reads it ───────────────────────────────────────── */

export type TaskMarkdownInput = {
  _id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  worldName?: string;
  brief?: string;
  result?: string;
  createdBy: string;
  assignee?: string;
  claimedBy?: string;
  leaseUntil?: number;
  needsRework?: boolean;
  createdAt: number;
  updatedAt: number;
  links: { kind: TaskLinkKind; id: string; label?: string }[];
};

const iso = (at: number) => new Date(at).toISOString().slice(0, 16).replace("T", " ") + "Z";

/**
 * One task as markdown: the same facts the agent route returns, in the order an
 * agent reads them. The AGENT view of the queue is a list of these, and the
 * copy button on a card copies one.
 */
export const taskToMarkdown = (task: TaskMarkdownInput) => {
  const lines: string[] = [];
  lines.push(`# ${task.title}`);
  lines.push("");
  const facts = [
    `id: ${taskRef(task._id)}`,
    `status: ${task.status}${task.needsRework && task.status === "open" ? " (rework)" : ""}`,
    `priority: ${task.priority} (${TASK_PRIORITY_LABEL[task.priority].toLowerCase()})`,
    `world: ${task.worldName ?? "studio"}`,
    `created: ${iso(task.createdAt)} by ${task.createdBy}`,
    `updated: ${iso(task.updatedAt)}`,
  ];
  if (task.status === "claimed" && task.claimedBy) facts.push(`claimed by: ${task.claimedBy}${task.leaseUntil ? ` until ${iso(task.leaseUntil)}` : ""}`);
  else if (task.assignee) facts.push(`assignee: ${task.assignee}`);
  lines.push(...facts.map((fact) => `- ${fact}`));
  if (task.brief) lines.push("", "## Brief", "", task.brief.trim());
  if (task.result) lines.push("", task.status === "blocked" ? "## Question for Michael" : "## Result", "", task.result.trim());
  if (task.links.length) {
    lines.push("", "## Links", "");
    for (const link of task.links) lines.push(`- ${linkRef(link)}${link.label ? ` — ${link.label}` : ""}`);
  }
  lines.push("", `Act with claim_task / comment_task / complete_task on ${taskRef(task._id)}.`);
  return lines.join("\n");
};

/** The first paragraph of a markdown body, as plain text, cut to `max` characters. */
export const gistOf = (body: string | undefined, max = 280) => {
  if (!body) return "";
  const paragraph = body.trim().split(/\n\s*\n/).map((part) => part.trim()).find((part) => part && !/^(#|\||```|- \*\*)/.test(part)) ?? body.trim();
  const plain = paragraph
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : plain;
};
