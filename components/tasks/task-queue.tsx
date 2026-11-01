"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeft, Check, ChevronDown, ChevronRight, ListChecks, Loader2, Plus, RotateCcw, X, Archive } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ActionButton, Badge, CopyChip, Micro, RADIUS, display, errorText, mono } from "@/components/inbox/inbox-ui";
import { LazyWorldDocProse as WorldDocProse } from "@/components/gallery/world-doc-prose-lazy";
import { ActorBadge, fullStamp, timeAgo } from "@/components/gallery/world-ui";
import {
  TASK_LIMITS, TASK_PRIORITY_LABEL, TASK_STATUS_LABEL, linkRef, taskRef, type TaskPriority, type TaskStatus,
} from "@/lib/tasks";

// The task queue ("Tasks"): the loop between Michael's review and the agents'
// work. He reads what needs him, what is in flight and what waits; a row
// opens its brief, result and timeline where he comments, closes or reopens.
// Same language as the Inbox: Geist bold uppercase titles, mono microcopy,
// 2px corners, coral for the one thing that needs him.

type TaskRow = FunctionReturnType<typeof api.tasks.listTasks>[number];
type TaskView = FunctionReturnType<typeof api.tasks.getTask>;

const PRIORITY_COLOR: Record<TaskPriority, string> = { 1: "var(--lm-coral)", 2: "var(--lm-text-secondary)", 3: "var(--lm-text-ghost)" };
const STATUS_COLOR: Record<TaskStatus, string> = {
  blocked: "var(--lm-coral)", claimed: "var(--lm-text-primary)", open: "var(--lm-text-secondary)",
  done: "var(--lm-text-tertiary)", archived: "var(--lm-text-ghost)",
};
const GROUPS: Array<{ key: TaskStatus; label: string; hint: string }> = [
  { key: "blocked", label: "Needs you", hint: "An agent asked a question; your comment reopens the task." },
  { key: "claimed", label: "In flight", hint: "Claimed by an agent, with a lease." },
  { key: "open", label: "Open", hint: "Waiting for an agent, by priority." },
];

const SOURCE_LABEL: Record<TaskRow["source"], string> = { manual: "filed", comment: "your comment", inbox: "inbox answers", newspaper: "newspaper" };
const sourceOf = (task: { source: TaskRow["source"]; createdBy: string }) =>
  task.source === "manual" ? (task.createdBy === "owner" ? "filed by you" : `filed by ${task.createdBy}`) : `from ${SOURCE_LABEL[task.source]}`;

function PriorityDot({ priority, size = 8 }: { priority: TaskPriority; size?: number }) {
  return <span aria-label={`Priority ${TASK_PRIORITY_LABEL[priority]}`} title={TASK_PRIORITY_LABEL[priority]} className="inline-block shrink-0"
    style={{ width: size, height: size, borderRadius: "50%", background: PRIORITY_COLOR[priority], boxShadow: priority === 1 ? "0 0 0 3px color-mix(in srgb, var(--lm-coral) 22%, transparent)" : undefined }} />;
}

function StatusBadge({ status, needsRework }: { status: TaskStatus; needsRework?: boolean }) {
  return <Badge color={STATUS_COLOR[status]}>{needsRework && status === "open" ? "Rework" : TASK_STATUS_LABEL[status]}</Badge>;
}

const field: CSSProperties = { ...display, background: "var(--lm-surface-0)", border: "1px solid var(--lm-border)", color: "var(--lm-text-primary)", borderRadius: RADIUS };

function Row({ task, selected, showWorld, onSelect }: { task: TaskRow; selected: boolean; showWorld: boolean; onSelect: () => void }) {
  const who = task.status === "claimed" ? task.claimedBy : task.assignee;
  return <li>
    <button type="button" onClick={onSelect} aria-current={selected ? "true" : undefined}
      className="group flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors md:px-4"
      style={{
        borderRadius: RADIUS,
        background: selected ? "var(--lm-surface-2)" : "transparent",
        boxShadow: selected ? "inset 2px 0 0 var(--lm-coral)" : undefined,
      }}>
      <span className="mt-[6px]"><PriorityDot priority={task.priority} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-black uppercase leading-5 tracking-tight" style={{ ...display, color: task.status === "done" || task.status === "archived" ? "var(--lm-text-tertiary)" : "var(--lm-text-primary)" }}>
          {task.title}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {showWorld && task.worldName && <Micro color="var(--lm-coral)">{task.worldName}</Micro>}
          <Micro>{sourceOf(task)}</Micro>
          {who && <Micro color="var(--lm-text-secondary)">{who.replace(/^agent:/, "")}</Micro>}
          {task.needsRework && task.status === "open" && <Micro color="var(--lm-coral)">rework</Micro>}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <Micro color="var(--lm-text-ghost)">{timeAgo(task.updatedAt)}</Micro>
        <ChevronRight size={13} className="opacity-0 transition-opacity group-hover:opacity-60" style={{ color: "var(--lm-text-tertiary)" }} aria-hidden />
      </span>
    </button>
  </li>;
}

function Group({ label, hint, count, tone, children }: { label: string; hint: string; count: number; tone?: string; children: ReactNode }) {
  return <section aria-label={label}>
    <header className="flex items-baseline gap-2 px-3 pb-1.5 pt-5 md:px-4" title={hint}>
      <h2 className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ ...mono, color: tone ?? "var(--lm-text-tertiary)" }}>{label}</h2>
      <span className="text-[11px] font-bold tabular-nums" style={{ ...mono, color: tone ?? "var(--lm-text-ghost)" }}>{String(count).padStart(2, "0")}</span>
    </header>
    <ul className="flex flex-col gap-px">{children}</ul>
  </section>;
}

/* ── Composer ────────────────────────────────────────────────────────────── */

function Composer({ ownerUserId, worldFolderId, onCreated, onClose }: {
  ownerUserId: string; worldFolderId?: Id<"folders">; onCreated: (taskId: Id<"tasks">) => void; onClose: () => void;
}) {
  const { isAuthenticated } = useConvexAuth();
  const worlds = useQuery(api.worlds.listWorlds, isAuthenticated && !worldFolderId ? { ownerUserId } : "skip");
  const create = useMutation(api.tasks.createTask);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [priority, setPriority] = useState<TaskPriority>(2);
  const [world, setWorld] = useState<string>(worldFolderId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true); setError(undefined);
    try {
      const result = await create({
        ownerUserId, title: title.trim(), brief: brief.trim() || undefined, priority, createdBy: "owner",
        worldFolderId: (world || undefined) as Id<"folders"> | undefined,
      });
      onCreated(result.task._id);
      setTitle(""); setBrief("");
      onClose();
    } catch (cause) {
      setError(errorText(cause, "The task was not filed."));
    } finally {
      setBusy(false);
    }
  };
  return <form className="mb-2 flex flex-col gap-2 border p-3 md:p-4" style={{ borderRadius: RADIUS, borderColor: "var(--lm-border-strong)", background: "var(--lm-surface-1)" }}
    onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <div className="flex items-center justify-between">
      <Micro color="var(--lm-text-secondary)">New task</Micro>
      <button type="button" onClick={onClose} aria-label="Close" className="p-1 opacity-60 hover:opacity-100"><X size={14} aria-hidden /></button>
    </div>
    <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={TASK_LIMITS.title} placeholder="What should an agent do?"
      className="w-full px-3 py-2.5 text-[15px] font-bold outline-none md:text-[14px]" style={field} />
    <textarea value={brief} onChange={(event) => setBrief(event.target.value)} rows={3} maxLength={TASK_LIMITS.brief}
      placeholder="The brief, in markdown. Paste asset:… or story:… ids the task concerns."
      className="w-full resize-y px-3 py-2.5 text-[14px] leading-6 outline-none md:text-[13px]" style={field} />
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1" role="group" aria-label="Priority">
        {([1, 2, 3] as TaskPriority[]).map((value) => <button key={value} type="button" aria-pressed={priority === value} onClick={() => setPriority(value)}
          className="lm-chip" data-active={priority === value ? "true" : undefined} style={{ borderRadius: RADIUS }}>
          <PriorityDot priority={value} size={6} /> {TASK_PRIORITY_LABEL[value]}
        </button>)}
      </div>
      {!worldFolderId && <select value={world} onChange={(event) => setWorld(event.target.value)} aria-label="World"
        className="px-2 py-[6px] text-[10px] font-bold uppercase tracking-[0.1em] outline-none" style={{ ...field, ...mono }}>
        <option value="">No world</option>
        {(worlds ?? []).map((row) => <option key={row.worldId} value={row.worldId}>{row.name}</option>)}
      </select>}
      <span className="flex-1" />
      <ActionButton tone="ink" type="submit" busy={busy} disabled={!title.trim()} icon={<Plus size={12} aria-hidden />}>File task</ActionButton>
    </div>
    {error && <p className="text-[12px]" style={{ color: "var(--lm-status-error)" }}>{error}</p>}
  </form>;
}

/* ── Detail panel ────────────────────────────────────────────────────────── */

export function LinkChip({ link }: { link: TaskView["links"][number] }) {
  const ref = linkRef(link);
  const body = <>
    {link.thumbUrl && (
      // eslint-disable-next-line @next/next/no-img-element -- link thumbnail
      <img src={link.thumbUrl} alt="" className="h-8 w-8 shrink-0 object-cover" style={{ borderRadius: RADIUS }} loading="lazy" />
    )}
    <span className="min-w-0">
      <span className="block truncate text-[12px] font-bold" style={{ ...display, color: link.missing ? "var(--lm-text-ghost)" : "var(--lm-text-primary)" }}>
        {link.label ?? link.title ?? ref}
      </span>
      <span className="block truncate text-[10px]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>{link.missing ? `${ref} · gone` : ref}</span>
    </span>
  </>;
  const className = "flex min-w-0 max-w-full items-center gap-2 border px-2 py-1.5";
  const style = { borderRadius: RADIUS, borderColor: "var(--lm-border)", background: "var(--lm-surface-1)" };
  return <div className="flex items-center gap-1">
    {link.kind === "url"
      ? <a href={link.id} target="_blank" rel="noreferrer" className={className} style={style}>{body}</a>
      : link.kind === "asset" && !link.missing
        ? <Link href={`/?asset=${link.id}`} className={className} style={style}>{body}</Link>
        : <div className={className} style={style}>{body}</div>}
    <CopyChip value={ref} label="" title={`Copy ${ref}`} />
  </div>;
}

const EVENT_LABEL: Record<TaskView["events"][number]["kind"], string> = {
  create: "filed", claim: "claimed", release: "released", status: "", comment: "", edit: "edited",
};

export function Timeline({ events }: { events: TaskView["events"] }) {
  return <ol className="flex flex-col gap-3">
    {events.map((event) => {
      const status = event.kind === "status" && event.to ? TASK_STATUS_LABEL[event.to].toLowerCase() : "";
      const label = event.kind === "status" ? status : EVENT_LABEL[event.kind];
      return <li key={event._id} className="flex gap-2.5">
        <span className="mt-[7px] h-[5px] w-[5px] shrink-0" style={{ borderRadius: "50%", background: event.kind === "comment" ? "var(--lm-coral)" : "var(--lm-text-ghost)" }} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <ActorBadge actor={event.author} />
            {label && <Micro color={event.to === "blocked" ? "var(--lm-coral)" : undefined}>{label}</Micro>}
            <Micro color="var(--lm-text-ghost)" className="normal-case tracking-normal" style={{ textTransform: "none" }}>{fullStamp(event.createdAt)}</Micro>
          </div>
          {event.body && (event.kind === "comment" || event.kind === "status"
            ? <div className="mt-1 text-[14px] leading-6" style={{ color: "var(--lm-text-secondary)" }}><WorldDocProse body={event.body} inline /></div>
            : <p className="mt-0.5 text-[12px]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>{event.body}</p>)}
        </div>
      </li>;
    })}
  </ol>;
}

export function TaskPanel({ ownerUserId, taskId, onClose, showWorld }: { ownerUserId: string; taskId: Id<"tasks">; onClose: () => void; showWorld: boolean }) {
  const { isAuthenticated } = useConvexAuth();
  const view = useQuery(api.tasks.getTask, isAuthenticated ? { ownerUserId, taskId } : "skip");
  const update = useMutation(api.tasks.updateTask);
  const comment = useMutation(api.tasks.commentTask);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key); setError(undefined);
    try { await action(); } catch (cause) { setError(errorText(cause, "That did not go through.")); } finally { setBusy(null); }
  };
  const send = () => run("comment", async () => {
    if (!draft.trim()) return;
    await comment({ ownerUserId, taskId, body: draft.trim(), author: "owner" });
    setDraft("");
  });
  const setStatus = (status: "open" | "done" | "archived") => run(status, () => update({ ownerUserId, taskId, status, actor: "owner" }));

  if (view === undefined) return <div className="grid place-items-center py-24"><Loader2 className="animate-spin" size={18} style={{ color: "var(--lm-text-ghost)" }} aria-label="Loading" /></div>;
  const { task, links, events } = view;
  const closed = task.status === "done" || task.status === "archived";
  return <article className="flex h-full flex-col" aria-label={task.title}>
    <header className="flex items-start gap-2 border-b px-4 py-3" style={{ borderColor: "var(--lm-border)" }}>
      <button type="button" onClick={onClose} aria-label="Back to the queue" className="-ml-1 grid h-8 w-8 shrink-0 place-items-center md:hidden" style={{ color: "var(--lm-text-tertiary)" }}><ArrowLeft size={16} aria-hidden /></button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <CopyChip value={taskRef(task._id)} label={`task:…${task._id.slice(-6)}`} />
          <StatusBadge status={task.status} needsRework={task.needsRework} />
          <Badge color={PRIORITY_COLOR[task.priority]}><PriorityDot priority={task.priority} size={6} /> {TASK_PRIORITY_LABEL[task.priority]}</Badge>
          {showWorld && task.worldName && <Badge color="var(--lm-coral)">{task.worldName}</Badge>}
        </div>
        <h2 className="mt-2 text-[17px] font-black uppercase leading-tight tracking-tight" style={display}>{task.title}</h2>
        <p className="mt-1 text-[11px]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>
          {task.source === "manual" ? fullStamp(task.createdAt) : `${sourceOf(task)} · ${fullStamp(task.createdAt)}`}
          {task.claimedBy && task.status === "claimed" && <> · held by <span style={{ color: "var(--lm-text-secondary)" }}>{task.claimedBy}</span>{task.leaseUntil ? ` until ${new Date(task.leaseUntil).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}</>}
          {task.assignee && task.status !== "claimed" && <> · {task.assignee}</>}
        </p>
      </div>
      <button type="button" onClick={onClose} aria-label="Close" className="hidden h-8 w-8 shrink-0 place-items-center md:grid" style={{ color: "var(--lm-text-tertiary)" }}><X size={16} aria-hidden /></button>
    </header>

    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      {task.result && <section className="mb-5 border p-3" style={{ borderRadius: RADIUS, borderColor: task.status === "blocked" ? "var(--lm-coral)" : "var(--lm-border-strong)", background: "var(--lm-surface-1)" }}>
        <Micro color={task.status === "blocked" ? "var(--lm-coral)" : "var(--lm-text-secondary)"} className="mb-2 block">{task.status === "blocked" ? "The agent needs you" : task.status === "done" ? "Result" : "Last result"}</Micro>
        <div className="text-[14px] leading-6" style={{ color: "var(--lm-text-primary)" }}><WorldDocProse body={task.result} inline /></div>
      </section>}
      {task.brief ? <section className="mb-5">
        <Micro className="mb-2 block">Brief</Micro>
        <div className="text-[14px] leading-6" style={{ color: "var(--lm-text-secondary)" }}><WorldDocProse body={task.brief} inline /></div>
      </section> : null}
      {links.length > 0 && <section className="mb-5">
        <Micro className="mb-2 block">Links</Micro>
        <div className="flex flex-col gap-1.5">{links.map((link, index) => <LinkChip key={`${link.kind}-${link.id}-${index}`} link={link} />)}</div>
      </section>}
      <section>
        <Micro className="mb-2 block">Timeline</Micro>
        <Timeline events={events} />
      </section>
    </div>

    <footer className="border-t px-4 py-3" style={{ borderColor: "var(--lm-border)", background: "var(--lm-surface-1)" }}>
      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} maxLength={TASK_LIMITS.comment}
        placeholder={task.status === "blocked" ? "Your answer reopens the task." : closed ? "A comment reopens the task for rework." : "A note for the agent."}
        onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); } }}
        className="w-full resize-none px-3 py-2.5 text-[15px] leading-6 outline-none md:text-[14px]" style={field} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <ActionButton tone="coral" busy={busy === "comment"} disabled={!draft.trim()} onClick={() => void send()}>Comment</ActionButton>
        <span className="flex-1" />
        {task.status !== "done" && task.status !== "archived" && <ActionButton tone="ink" busy={busy === "done"} icon={<Check size={12} aria-hidden />} onClick={() => void setStatus("done")}>Done</ActionButton>}
        {closed && <ActionButton busy={busy === "open"} icon={<RotateCcw size={12} aria-hidden />} onClick={() => void setStatus("open")}>Reopen</ActionButton>}
        {task.status === "blocked" && <ActionButton busy={busy === "open"} icon={<RotateCcw size={12} aria-hidden />} onClick={() => void setStatus("open")}>Back to open</ActionButton>}
        {task.status !== "archived" && <ActionButton busy={busy === "archived"} icon={<Archive size={12} aria-hidden />} onClick={() => void setStatus("archived")}>Archive</ActionButton>}
      </div>
      {error && <p className="mt-2 text-[12px]" style={{ color: "var(--lm-status-error)" }}>{error}</p>}
    </footer>
  </article>;
}

/* ── Queue ───────────────────────────────────────────────────────────────── */

export function TaskQueue({ ownerUserId, worldFolderId, initialTaskId, studioOnly = false, showWorld = true, header }: {
  ownerUserId: string;
  /** Inside a world: only its tasks, and new tasks file into it. */
  worldFolderId?: Id<"folders">;
  initialTaskId?: string;
  /** Only tasks that belong to no world. */
  studioOnly?: boolean;
  showWorld?: boolean;
  /** Rendered above the list: a page's own header or a tab's toolbar. */
  header?: (counts: { active: number; blocked: number }) => ReactNode;
}) {
  const { isAuthenticated } = useConvexAuth();
  const [selected, setSelected] = useState<Id<"tasks"> | null>((initialTaskId as Id<"tasks">) ?? null);
  const [showDone, setShowDone] = useState(false);
  const [composing, setComposing] = useState(false);
  const studio = (rows: TaskRow[] | undefined) => (rows && studioOnly ? rows.filter((row) => !row.worldFolderId) : rows);
  const active = studio(useQuery(api.tasks.listTasks, isAuthenticated ? { ownerUserId, worldFolderId, status: "active", limit: TASK_LIMITS.list } : "skip"));
  const done = studio(useQuery(api.tasks.listTasks, isAuthenticated && showDone ? { ownerUserId, worldFolderId, status: "done", limit: 50 } : "skip"));

  const groups = useMemo(() => {
    const byStatus = new Map<TaskStatus, TaskRow[]>();
    for (const row of active ?? []) byStatus.set(row.status, [...(byStatus.get(row.status) ?? []), row]);
    return byStatus;
  }, [active]);
  const blocked = groups.get("blocked")?.length ?? 0;
  const counts = { active: active?.length ?? 0, blocked };

  const list = <div className="min-w-0">
    {header?.(counts)}
    <div className="flex items-center justify-between px-3 md:px-4">
      <Micro color="var(--lm-text-ghost)">{active === undefined ? "Loading…" : `${counts.active} active`}</Micro>
      {!composing && <ActionButton tone="ghost" className="py-1.5" icon={<Plus size={12} aria-hidden />} onClick={() => setComposing(true)}>New task</ActionButton>}
    </div>
    {composing && <div className="mt-2 px-3 md:px-4"><Composer ownerUserId={ownerUserId} worldFolderId={worldFolderId} onCreated={setSelected} onClose={() => setComposing(false)} /></div>}
    {active === undefined ? <div className="grid place-items-center py-24"><Loader2 className="animate-spin" size={18} style={{ color: "var(--lm-text-ghost)" }} aria-label="Loading" /></div>
      : active.length === 0 && !composing
        ? <div className="mx-3 mt-4 border px-6 py-14 text-center md:mx-4" style={{ borderRadius: RADIUS, borderColor: "var(--lm-border)", borderStyle: "dashed" }}>
          <ListChecks size={22} className="mx-auto" style={{ color: "var(--lm-text-ghost)" }} aria-hidden />
          <p className="mt-3 text-sm font-black uppercase tracking-tight" style={display}>Nothing in the queue</p>
          <p className="mx-auto mt-2 max-w-sm text-[12px] leading-5" style={{ color: "var(--lm-text-tertiary)" }}>
            Comment on an asset or answer an Inbox stack and a task appears here for an agent. Or file one.
          </p>
        </div>
        : GROUPS.map((group) => {
          const rows = groups.get(group.key) ?? [];
          if (rows.length === 0) return null;
          return <Group key={group.key} label={group.label} hint={group.hint} count={rows.length} tone={group.key === "blocked" ? "var(--lm-coral)" : undefined}>
            {rows.map((row) => <Row key={row._id} task={row} selected={row._id === selected} showWorld={showWorld} onSelect={() => setSelected(row._id)} />)}
          </Group>;
        })}
    <section className="mt-6 px-3 md:px-4">
      <button type="button" onClick={() => setShowDone((value) => !value)} aria-expanded={showDone}
        className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.14em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>
        {showDone ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />} Done
      </button>
      {showDone && (done === undefined
        ? <Loader2 className="mt-3 animate-spin" size={14} style={{ color: "var(--lm-text-ghost)" }} aria-label="Loading" />
        : done.length === 0
          ? <p className="mt-2 text-[12px]" style={{ color: "var(--lm-text-ghost)" }}>Nothing finished yet.</p>
          : <ul className="-mx-3 mt-1 flex flex-col gap-px md:-mx-4">{done.map((row) => <Row key={row._id} task={row} selected={row._id === selected} showWorld={showWorld} onSelect={() => setSelected(row._id)} />)}</ul>)}
    </section>
  </div>;

  return <div className="md:grid md:grid-cols-[minmax(0,1fr)_minmax(360px,440px)] md:items-start md:gap-6">
    {list}
    {selected && <>
      {/* Desktop: a sticky panel beside the list. Phone: a full-screen sheet. */}
      <aside className="hidden border md:sticky md:top-4 md:block md:max-h-[calc(100dvh-2rem)] md:overflow-hidden"
        style={{ borderRadius: RADIUS, borderColor: "var(--lm-border-strong)", background: "var(--lm-surface-0)", boxShadow: "var(--lm-shadow-md)" }}>
        <TaskPanel key={selected} ownerUserId={ownerUserId} taskId={selected} onClose={() => setSelected(null)} showWorld={showWorld} />
      </aside>
      <div className="fixed inset-0 z-50 flex flex-col md:hidden" style={{ background: "var(--lm-paper)", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        <TaskPanel key={`m-${selected}`} ownerUserId={ownerUserId} taskId={selected} onClose={() => setSelected(null)} showWorld={showWorld} />
      </div>
    </>}
  </div>;
}

/** /tasks: the whole queue, with a world filter. */
export function TasksHome({ ownerUserId }: { ownerUserId: string }) {
  const { isAuthenticated } = useConvexAuth();
  const [world, setWorld] = useState<Id<"folders"> | "studio" | null>(null);
  // ?task=<id> (the url agents return) opens that task. This screen mounts
  // only after sign-in resolves in the browser, so the window is there.
  const [initialTaskId] = useState<string | undefined>(() =>
    typeof window === "undefined" ? undefined : new URLSearchParams(window.location.search).get("task")?.replace(/^task:/, "") ?? undefined);
  const counts = useQuery(api.tasks.countOpenTasks, isAuthenticated ? { ownerUserId } : "skip");
  const totals = (counts ?? []).reduce((sum, row) => ({ active: sum.active + row.open + row.claimed + row.blocked, blocked: sum.blocked + row.blocked }), { active: 0, blocked: 0 });
  // The studio filter has no world id; the queue filters the full list.
  const worldFolderId = world && world !== "studio" ? world : undefined;
  return <main className="min-h-dvh px-4 pb-16 md:px-8" style={{ background: "var(--lm-paper)", color: "var(--lm-text-primary)", paddingTop: "max(16px, env(safe-area-inset-top))" }}>
    <div className="mx-auto max-w-6xl">
      <Link href="/" className="mb-6 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors hover:text-[var(--lm-text-primary)]"
        style={{ ...mono, color: "var(--lm-text-tertiary)" }}>
        <ArrowLeft size={13} aria-hidden /> Gallery
      </Link>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-4xl font-black uppercase leading-none tracking-tight md:text-5xl" style={display}>Tasks</h1>
          <p className="mt-2 text-[11px] uppercase tracking-[0.14em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>
            {counts === undefined ? "Loading…" : totals.blocked ? <><span style={{ color: "var(--lm-coral)" }}>{totals.blocked} need you</span> · {totals.active} active</> : `${totals.active} active · agents pick these up`}
          </p>
        </div>
        {counts && counts.length > 1 && <div className="flex flex-wrap gap-2" role="group" aria-label="World">
          <button type="button" className="lm-chip" data-active={world === null ? "true" : undefined} style={{ borderRadius: RADIUS }} onClick={() => setWorld(null)}>All</button>
          {counts.map((row) => {
            const key = row.worldFolderId ?? "studio";
            const n = row.open + row.claimed + row.blocked;
            return <button key={key} type="button" className="lm-chip" data-active={world === key ? "true" : undefined} style={{ borderRadius: RADIUS }} onClick={() => setWorld(key)}>
              {row.worldName} <span className="tabular-nums" style={{ color: row.blocked ? "var(--lm-coral)" : undefined }}>{n}</span>
            </button>;
          })}
        </div>}
      </header>
      <TaskQueue key={String(world)} ownerUserId={ownerUserId} worldFolderId={worldFolderId} studioOnly={world === "studio"} initialTaskId={initialTaskId} showWorld={world === null} />
    </div>
  </main>;
}
