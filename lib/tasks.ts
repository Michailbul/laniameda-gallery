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
  // A question for Michael (a blocked task): one line, 2–4 picture options.
  askQuestion: 140,
  askLabel: 60,
  askOptionsMin: 2,
  askOptionsMax: 4,
  askOptionAssets: 6,
  askAssets: 8,
  // What Michael reads on the wall: an agent's title and its one-line summary.
  humanTitle: 80,
  summary: 160,
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

/**
 * A question for Michael, the only way a task becomes blocked (Needs you):
 * one plain line, and 2–4 options he picks with one click, each showing the
 * frames it is about. assetIds on the ask itself are context shown above the
 * options. The reasoning goes in the result, behind Details. Set 1 Nov 2026
 * after a pilot came back as a table and three paragraphs he could not act on.
 */
export type TaskAskOption = { label: string; assetIds?: string[]; recommended?: boolean };
export type TaskAsk = { question: string; assetIds?: string[]; options: TaskAskOption[] };

export const ASK_LETTERS = ["A", "B", "C", "D"] as const;

/** Why an ask cannot go to Michael as written, or null. Asset ids are checked for existence by the backend. */
export const askProblem = (ask: TaskAsk | undefined): string | null => {
  const how = "A question for Michael is pictures and a one-click pick: ask {question: one line, options: 2–4 {label, assetIds}}. Reasoning goes in result.";
  if (!ask) return `Pass ask with the question and its picture options. ${how}`;
  const question = ask.question.trim();
  if (!question) return `The ask needs a question. ${how}`;
  if (/\n/.test(question)) return "Keep the question on one line; the reasoning goes in result.";
  if (question.length > TASK_LIMITS.askQuestion) return `The question is ${question.length} characters; keep it under ${TASK_LIMITS.askQuestion}, in plain words. The reasoning goes in result.`;
  const { options } = ask;
  if (options.length < TASK_LIMITS.askOptionsMin || options.length > TASK_LIMITS.askOptionsMax) return `Give ${TASK_LIMITS.askOptionsMin}–${TASK_LIMITS.askOptionsMax} options to pick from.`;
  for (const option of options) {
    const label = option.label.trim();
    if (!label) return "Every option needs a label.";
    if (label.length > TASK_LIMITS.askLabel) return `Option "${label.slice(0, 40)}…" is too long; ${TASK_LIMITS.askLabel} characters at most, a few words.`;
    if ((option.assetIds?.length ?? 0) > TASK_LIMITS.askOptionAssets) return `An option shows ${TASK_LIMITS.askOptionAssets} images at most.`;
  }
  if (options.filter((option) => option.recommended).length > 1) return "Recommend one option at most.";
  if ((ask.assetIds?.length ?? 0) > TASK_LIMITS.askAssets) return `The ask shows ${TASK_LIMITS.askAssets} context images at most.`;
  const pictures = (ask.assetIds?.length ?? 0) + options.reduce((sum, option) => sum + (option.assetIds?.length ?? 0), 0);
  if (pictures === 0) return "Show it: put the frames he decides on in the options (assetIds), or as context on the ask. A question without pictures does not reach him.";
  return null;
};

/**
 * Michael reads the wall (Human view) at product and art-direction level; the
 * agent reads the brief and result (Agent view). An agent's title and summary
 * are for him: plain words, nothing he would have to decode. Returns what
 * gives a line away as agent text, or null.
 */
export const jargonIn = (line: string): string | null => {
  if (/(^|[\s(])~?\/[\w.-]+\/|\b[\w-]+\.(md|mdx|ts|tsx|js|mjs|json|py|sh|html)\b/i.test(line)) return "a file path";
  if (/\b(asset|task|story|stack|skill|pack|moodboard|collection|folder|doc|video|design):\S/.test(line)) return "an id";
  if (/\b(?=[a-z0-9]*\d)[a-z0-9]{24,}\b/.test(line)) return "an id";
  if (/(^|\s)--[a-z]/i.test(line)) return "a command flag";
  if (line.includes("`")) return "code";
  if (/\b[a-z]+_[a-z0-9_]+\b/.test(line)) return "a tool or field name";
  if (/[*#|]|\]\(/.test(line)) return "markdown";
  return null;
};

const plainProblem = (what: string, value: string, max: number) => {
  if (/\n/.test(value)) return `Keep the ${what} on one line.`;
  if (value.length > max) return `The ${what} is ${value.length} characters; keep it under ${max}, in plain words.`;
  const jargon = jargonIn(value);
  return jargon ? `The ${what} has ${jargon} in it. Michael reads it on the wall: plain words only; ids, paths, tools and settings go in the brief.` : null;
};

/** An agent's task title: what the work is, in his words. "Run the bigger prompt test", not "EXP-002: run the main cells". */
export const titleProblem = (title: string) => plainProblem("title", title.trim(), TASK_LIMITS.humanTitle);

/**
 * The one line under the title in the Human view: why it matters or what he
 * will see. Required when an agent files a task and when it finishes one.
 */
export const summaryProblem = (summary: string | undefined, required: boolean) => {
  const line = summary?.trim() ?? "";
  if (!line) return required ? "Add summary: one plain line for Michael (what this is, or what he will see now). The details go in the brief or result." : null;
  return plainProblem("summary", line, TASK_LIMITS.summary);
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
  summary?: string;
  status: TaskStatus;
  priority: TaskPriority;
  worldName?: string;
  brief?: string;
  result?: string;
  ask?: TaskAsk;
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
  if (task.summary) lines.push(`> ${task.summary}`, "");
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
  const asking = task.status === "blocked" && task.ask;
  if (asking) {
    lines.push("", "## Question for Michael", "", task.ask!.question.trim());
    if (task.ask!.assetIds?.length) lines.push("", `Context: ${task.ask!.assetIds.map((id) => `asset:${id}`).join(" ")}`);
    lines.push("");
    task.ask!.options.forEach((option, index) => {
      const pictures = option.assetIds?.length ? ` (${option.assetIds.map((id) => `asset:${id}`).join(" ")})` : "";
      lines.push(`- ${ASK_LETTERS[index]}: ${option.label}${option.recommended ? " [agent pick]" : ""}${pictures}`);
    });
  }
  if (task.result) lines.push("", asking ? "## Details" : task.status === "blocked" ? "## Question for Michael" : "## Result", "", task.result.trim());
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
