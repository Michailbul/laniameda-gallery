"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowLeft, Check, ChevronLeft, ChevronRight, Copy, Layers, LayoutGrid, ListChecks, Loader2, Newspaper as NewspaperIcon, RefreshCw,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { ActionButton, Badge, CopyChip, Micro, RADIUS, display, errorText, mono } from "@/components/inbox/inbox-ui";
import { WorldDocProse } from "@/components/gallery/world-doc-prose";
import { ActorBadge, OpBadge, clockLabel, fullStamp, timeAgo } from "@/components/gallery/world-ui";
import { parseNewspaperFacts, type NewspaperNeed, type NewspaperTaskItem, type NewspaperWorld } from "@/lib/newspaper-contract";
import { NEWSPAPER_URL_PATH, dateKeyLabel, isDateKey, moodboardPath, newspaperPath, storybookPath, worldPath } from "@/lib/newspaper";

// The morning newspaper, read on a phone over coffee. One column, the
// gallery's own language: Geist bold uppercase for titles, mono for the
// microcopy, hairline rules between sections, coral for the one block that
// needs him. Facts come from the compile; the prose, when there is one, is
// the agent's.

type Paper = NonNullable<FunctionReturnType<typeof api.newspaper.getNewspaper>>;
type Edition = FunctionReturnType<typeof api.newspaper.listNewspapers>[number];

const RULE = "1px solid var(--lm-border-strong)";
const HAIR = "1px solid var(--lm-border)";

const NEED_ICON: Record<NewspaperNeed["kind"], typeof Layers> = { stack: Layers, task: ListChecks, moodboard: LayoutGrid };
const NEED_REF: Record<NewspaperNeed["kind"], string> = { stack: "stack", task: "task", moodboard: "moodboard" };

const hasNews = (world: NewspaperWorld) =>
  world.changes.total > 0 || world.assets.count > 0 || world.tasks.done > 0 || world.storybooks.length > 0 || world.moodboards.length > 0 || world.characters.length > 0;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ── Small parts ─────────────────────────────────────────────────────────── */

function Section({ title, count, tone, children, lead }: { title: string; count?: number; tone?: string; lead?: string; children: ReactNode }) {
  return <section aria-label={title} className="pt-5" style={{ borderTop: RULE }}>
    <header className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-[13px] font-black uppercase tracking-[0.16em]" style={{ ...mono, color: tone ?? "var(--lm-text-primary)" }}>{title}</h2>
      {count !== undefined && <span className="text-[13px] font-bold tabular-nums" style={{ ...mono, color: tone ?? "var(--lm-text-tertiary)" }}>{String(count).padStart(2, "0")}</span>}
    </header>
    {lead && <p className="mb-3 text-[12px] leading-5" style={{ color: "var(--lm-text-tertiary)" }}>{lead}</p>}
    {children}
  </section>;
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="py-2 text-[13px] leading-5" style={{ color: "var(--lm-text-tertiary)" }}>{children}</p>;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return <div className="flex min-w-0 flex-col gap-1 border px-2.5 py-2" style={{ borderRadius: RADIUS, borderColor: tone ? tone : "var(--lm-border)", background: "var(--lm-surface-1)" }}>
    <span className="text-[22px] font-black leading-none tabular-nums tracking-tight md:text-[26px]" style={{ ...display, color: tone ?? "var(--lm-text-primary)" }}>{value}</span>
    <Micro color={tone ?? undefined}>{label}</Micro>
  </div>;
}

// A thumbnail in the per-world strip: opens the piece; the corner button
// copies asset:<id> so "the third one" in chat becomes an id.
function Thumb({ item }: { item: NewspaperWorld["assets"]["items"][number] }) {
  const [copied, setCopied] = useState(false);
  const ref = `asset:${item.assetId}`;
  return <div className="relative h-[88px] w-[88px] shrink-0 overflow-hidden" style={{ borderRadius: RADIUS, background: "var(--lm-surface-2)", border: HAIR }}>
    <Link href={item.path} aria-label={`Open ${ref}`} className="block h-full w-full">
      {item.thumbUrl || item.url
        // eslint-disable-next-line @next/next/no-img-element -- stored thumbnail
        ? <img src={item.thumbUrl ?? item.url} alt="" className="h-full w-full object-cover" loading="lazy" />
        : <span className="grid h-full w-full place-items-center"><Micro>{item.kind}</Micro></span>}
    </Link>
    {item.kind === "video" && <span className="pointer-events-none absolute left-1 top-1"><Badge>video</Badge></span>}
    <button type="button" aria-label={`Copy ${ref}`} title={`Copy ${ref}`}
      onClick={async (event) => {
        event.preventDefault();
        try { await navigator.clipboard.writeText(ref); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* clipboard refused */ }
      }}
      className="absolute bottom-1 right-1 grid h-6 w-6 place-items-center backdrop-blur"
      style={{ borderRadius: RADIUS, background: "color-mix(in srgb, var(--lm-paper) 72%, transparent)", color: "var(--lm-text-primary)", border: HAIR }}>
      {copied ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}
    </button>
  </div>;
}

function NeedRow({ need }: { need: NewspaperNeed }) {
  const Icon = NEED_ICON[need.kind];
  const ref = `${NEED_REF[need.kind]}:${need.id}`;
  const body = <>
    <span className="mt-[2px] grid h-7 w-7 shrink-0 place-items-center" style={{ borderRadius: RADIUS, background: "var(--lm-accent-dim)", color: "var(--lm-coral)" }}><Icon size={14} aria-hidden /></span>
    <span className="min-w-0 flex-1">
      <span className="block text-[14px] font-black uppercase leading-5 tracking-tight" style={display}>{need.title}</span>
      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <Micro color="var(--lm-coral)">{need.worldName}</Micro>
        <Micro className="normal-case tracking-normal" style={{ textTransform: "none", letterSpacing: 0 }}>{need.detail}</Micro>
      </span>
    </span>
    {need.path && <ChevronRight size={15} className="mt-1.5 shrink-0" style={{ color: "var(--lm-text-tertiary)" }} aria-hidden />}
  </>;
  const className = "flex min-w-0 flex-1 items-start gap-3 py-2.5 text-left";
  const path = need.path ?? (need.kind === "moodboard" ? moodboardPath(need.id) : undefined);
  return <li className="flex items-start gap-2" style={{ borderTop: HAIR }}>
    {path ? <Link href={path} className={`${className} active:opacity-70`}>{body}</Link> : <div className={className}>{body}</div>}
    <span className="pt-3"><CopyChip value={ref} label="" title={`Copy ${ref}`} /></span>
  </li>;
}

function TaskLine({ task, question }: { task: NewspaperTaskItem; question?: boolean }) {
  return <li className="py-2.5" style={{ borderTop: HAIR }}>
    <div className="flex items-start gap-2">
      <Link href={task.path} className="min-w-0 flex-1 active:opacity-70">
        <span className="block text-[14px] font-black uppercase leading-5 tracking-tight" style={display}>{task.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2">
          <Micro color={question ? "var(--lm-coral)" : undefined}>{task.worldName}</Micro>
          {task.claimedBy && <Micro>{task.claimedBy.replace(/^agent:/, "")}</Micro>}
          <Micro color="var(--lm-text-ghost)">{timeAgo(task.updatedAt)}</Micro>
        </span>
      </Link>
      <CopyChip value={`task:${task.taskId}`} label="" title={`Copy task:${task.taskId}`} />
    </div>
    {task.result && <div className="mt-1.5 text-[13px] leading-5" style={{ color: question ? "var(--lm-text-primary)" : "var(--lm-text-secondary)" }}>
      <WorldDocProse body={task.result} inline />
    </div>}
  </li>;
}

function WorldNews({ world, tasksDone }: { world: NewspaperWorld; tasksDone: NewspaperTaskItem[] }) {
  const counts = [
    world.assets.count > 0 && plural(world.assets.count, "piece") + " saved",
    world.changes.total > 0 && plural(world.changes.total, "change"),
    world.tasks.done > 0 && plural(world.tasks.done, "task") + " done",
  ].filter(Boolean).join(" · ");
  return <article className="pt-4" aria-label={world.name}>
    <header className="flex items-baseline justify-between gap-3">
      <Link href={worldPath(world.key || world.worldFolderId)} className="min-w-0 truncate text-[17px] font-black uppercase leading-tight tracking-tight active:opacity-70" style={display}>{world.name}</Link>
      <Micro className="shrink-0">{counts}</Micro>
    </header>
    {world.assets.items.length > 0 && <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:flex-wrap md:px-0">
      {world.assets.items.map((item) => <Thumb key={item.assetId} item={item} />)}
      {world.assets.count > world.assets.items.length && <Link href={worldPath(world.key || world.worldFolderId)} className="grid h-[88px] w-[88px] shrink-0 place-items-center border text-center" style={{ borderRadius: RADIUS, borderColor: "var(--lm-border-strong)", borderStyle: "dashed" }}>
        <Micro color="var(--lm-text-secondary)">+{world.assets.count - world.assets.items.length} more</Micro>
      </Link>}
    </div>}
    {tasksDone.length > 0 && <ul className="mt-2">{tasksDone.map((task) => <TaskLine key={task.taskId} task={task} />)}</ul>}
    {(world.storybooks.length > 0 || world.moodboards.length > 0 || world.characters.length > 0) && <div className="mt-3 flex flex-wrap gap-1.5">
      {world.storybooks.map((book) => <Link key={book.folderId} href={storybookPath(book.folderId)}><Badge color="var(--lm-text-primary)">{book.isNew ? "new storybook" : "storybook"} · {book.name}</Badge></Link>)}
      {world.moodboards.map((board) => <Link key={board.moodboardId} href={moodboardPath(board.moodboardId)}>
        <Badge color={board.drift !== 0 ? "var(--lm-coral)" : "var(--lm-text-primary)"} title={board.drift !== 0 ? `${Math.abs(board.drift)} image${Math.abs(board.drift) === 1 ? "" : "s"} ${board.drift > 0 ? "not yet in" : "removed since"} Midjourney` : undefined}>
          {board.isNew ? "new board" : "board"} · {board.name} · {board.itemCount}{board.drift !== 0 ? ` (${board.drift > 0 ? "+" : ""}${board.drift} unsynced)` : ""}
        </Badge>
      </Link>)}
      {world.characters.map((person) => <Badge key={person.characterId} color="var(--lm-text-primary)">{person.isNew ? "new" : "changed"} · {person.code} {person.name}</Badge>)}
    </div>}
    {world.changes.total > 0 && <div className="mt-3">
      <div className="flex flex-wrap gap-1.5">{world.changes.byOp.map((entry) => <span key={entry.op} className="inline-flex items-center gap-1"><OpBadge op={entry.op} /><Micro>{entry.count}</Micro></span>)}</div>
      <ul className="mt-2">
        {world.changes.summaries.map((change) => <li key={change.changeId} className="flex items-start gap-2 py-1.5" style={{ borderTop: HAIR }}>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] leading-5" style={{ color: "var(--lm-text-secondary)" }}>{change.summary}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2"><ActorBadge actor={change.actor} />{change.session && <Micro>{change.session}</Micro>}<Micro color="var(--lm-text-ghost)">{clockLabel(change.createdAt)}</Micro></span>
          </span>
        </li>)}
        {world.changes.total > world.changes.summaries.length && <li className="pt-2"><Link href={worldPath(world.key || world.worldFolderId, "journal")}><Micro color="var(--lm-text-secondary)">+{world.changes.total - world.changes.summaries.length} more in the journal →</Micro></Link></li>}
      </ul>
    </div>}
  </article>;
}

/* ── Masthead and date picker ────────────────────────────────────────────── */

function DatePicker({ editions, current }: { editions: Edition[]; current: string }) {
  const router = useRouter();
  const index = editions.findIndex((edition) => edition.date === current);
  const newer = index > 0 ? editions[index - 1] : undefined;
  const older = index >= 0 && index < editions.length - 1 ? editions[index + 1] : undefined;
  const chip: CSSProperties = { ...mono, borderRadius: RADIUS, border: HAIR, color: "var(--lm-text-secondary)", background: "var(--lm-surface-1)" };
  return <div className="flex items-center gap-1" role="group" aria-label="Edition">
    <button type="button" disabled={!older} aria-label={older ? `Older: ${older.date}` : "No older edition"} onClick={() => older && router.push(newspaperPath(older.date))}
      className="grid h-8 w-8 place-items-center disabled:opacity-30" style={chip}><ChevronLeft size={14} aria-hidden /></button>
    <select aria-label="Edition date" value={current} onChange={(event) => router.push(newspaperPath(event.target.value))}
      className="h-8 max-w-[160px] px-2 text-[10px] font-bold uppercase tracking-[0.1em] outline-none" style={chip}>
      {index < 0 && <option value={current}>{current}</option>}
      {editions.map((edition) => <option key={edition.date} value={edition.date}>{dateKeyLabel(edition.date, { weekday: "short", day: "numeric", month: "short" })}{edition.needsYou ? ` · ${edition.needsYou} need you` : ""}</option>)}
    </select>
    <button type="button" disabled={!newer} aria-label={newer ? `Newer: ${newer.date}` : "This is the latest edition"} onClick={() => newer && router.push(newspaperPath(newer.date))}
      className="grid h-8 w-8 place-items-center disabled:opacity-30" style={chip}><ChevronRight size={14} aria-hidden /></button>
  </div>;
}

function Masthead({ date, paper, editions, onCompile, busy }: { date?: string; paper: Paper | null; editions: Edition[]; onCompile: () => void; busy: boolean }) {
  const shown = paper?.date ?? date;
  return <header className="pb-4" style={{ borderBottom: "3px solid var(--lm-ink)" }}>
    <div className="flex items-center justify-between gap-3">
      <Link href="/" className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>
        <ArrowLeft size={13} aria-hidden /> Gallery
      </Link>
      {shown && editions.length > 0 && <DatePicker editions={editions} current={shown} />}
    </div>
    <div className="mt-5 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <Micro color="var(--lm-coral)">Laniameda · morning edition</Micro>
        <h1 className="mt-1 text-[44px] font-black uppercase leading-[0.9] tracking-tight md:text-[64px]" style={display}>Newspaper</h1>
      </div>
      <NewspaperIcon size={34} strokeWidth={1.5} className="mb-1 shrink-0" style={{ color: "var(--lm-text-ghost)" }} aria-hidden />
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <p className="text-[15px] font-bold leading-tight" style={{ ...display, color: "var(--lm-text-secondary)" }}>{shown ? dateKeyLabel(shown) : "No edition yet"}</p>
      <div className="flex items-center gap-2">
        {paper && <Badge color={paper.status === "written" ? "var(--lm-text-primary)" : undefined}>{paper.status === "written" ? "Written" : "Facts only"}</Badge>}
        <ActionButton tone="ghost" className="py-1.5" busy={busy} icon={<RefreshCw size={11} aria-hidden />} onClick={onCompile}>{paper ? "Recompile" : "Compile now"}</ActionButton>
      </div>
    </div>
    {paper && <p className="mt-1.5 text-[10px] uppercase tracking-[0.12em]" style={{ ...mono, color: "var(--lm-text-ghost)" }}>
      compiled {clockLabel(paper.compiledAt)} by {paper.compiledBy} · covers {fullStamp(paper.since)} → {clockLabel(paper.until)}
    </p>}
  </header>;
}

/* ── The paper ───────────────────────────────────────────────────────────── */

export function NewspaperScreen({ ownerUserId, date }: { ownerUserId: string; date?: string }) {
  const { isAuthenticated } = useConvexAuth();
  const validDate = date === undefined || isDateKey(date);
  const paper = useQuery(api.newspaper.getNewspaper, isAuthenticated && validDate ? { ownerUserId, date } : "skip");
  const editions = useQuery(api.newspaper.listNewspapers, isAuthenticated ? { ownerUserId } : "skip");
  const compile = useMutation(api.newspaper.compile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const facts = useMemo(() => (paper ? parseNewspaperFacts(paper.facts) : null), [paper]);

  const run = async () => {
    setBusy(true); setError(undefined);
    try { await compile({ ownerUserId, date, compiledBy: "owner" }); } catch (cause) { setError(errorText(cause, "The edition was not compiled.")); } finally { setBusy(false); }
  };

  const shell = (children: ReactNode) => <main className="min-h-dvh px-4 pb-20 md:px-8" style={{ background: "var(--lm-paper)", color: "var(--lm-text-primary)", paddingTop: "max(16px, env(safe-area-inset-top))" }}>
    <div className="mx-auto flex max-w-2xl flex-col gap-5">{children}</div>
  </main>;

  if (!validDate) {
    return shell(<>
      <Masthead date={undefined} paper={null} editions={editions ?? []} onCompile={run} busy={busy} />
      <Quiet>“{date}” is not a date. Editions are addressed as /newspaper/YYYY-MM-DD.</Quiet>
      <Link href={NEWSPAPER_URL_PATH} className="self-start"><ActionButton tone="ink">Latest edition</ActionButton></Link>
    </>);
  }
  if (paper === undefined || editions === undefined) {
    return shell(<div className="grid place-items-center py-32"><Loader2 className="animate-spin" size={18} style={{ color: "var(--lm-text-ghost)" }} aria-label="Loading" /></div>);
  }
  if (paper === null) {
    return shell(<>
      <Masthead date={date} paper={null} editions={editions} onCompile={run} busy={busy} />
      <div className="border px-6 py-14 text-center" style={{ borderRadius: RADIUS, borderColor: "var(--lm-border)", borderStyle: "dashed" }}>
        <NewspaperIcon size={22} className="mx-auto" style={{ color: "var(--lm-text-ghost)" }} aria-hidden />
        <p className="mt-3 text-sm font-black uppercase tracking-tight" style={display}>{date ? `No edition for ${date}` : "No edition yet"}</p>
        <p className="mx-auto mt-2 max-w-sm text-[12px] leading-5" style={{ color: "var(--lm-text-tertiary)" }}>
          The paper compiles itself every morning at 07:30. Compile now reads the last 24 hours this minute.
        </p>
        <div className="mt-5"><ActionButton tone="coral" busy={busy} icon={<RefreshCw size={12} aria-hidden />} onClick={() => void run()}>Compile now</ActionButton></div>
        {error && <p className="mt-3 text-[12px]" style={{ color: "var(--lm-status-error)" }}>{error}</p>}
      </div>
    </>);
  }

  const worlds = facts ? facts.worlds.filter(hasNews) : [];
  const doneByWorld = (world: NewspaperWorld) => facts?.tasks.done.filter((task) => task.worldFolderId === world.worldFolderId) ?? [];
  const studioDone = facts?.tasks.done.filter((task) => !task.worldFolderId) ?? [];
  const quietDay = facts && worlds.length === 0 && facts.studio.assets.count === 0 && studioDone.length === 0;

  return shell(<>
    <Masthead date={date} paper={paper} editions={editions} onCompile={() => void run()} busy={busy} />
    {error && <p className="text-[12px]" style={{ color: "var(--lm-status-error)" }}>{error}</p>}
    {!facts && <Quiet>This edition was compiled by a newer or older version of the paper and cannot be shown. Recompile it.</Quiet>}
    {facts && <>
      <div className="grid grid-cols-4 gap-1.5" aria-label="Headline counts">
        <Stat label="Done" value={facts.totals.done} />
        <Stat label="Need you" value={facts.totals.needsYou} tone={facts.totals.needsYou > 0 ? "var(--lm-coral)" : undefined} />
        <Stat label="Saved" value={facts.totals.assets} />
        <Stat label="Changes" value={facts.totals.changes} />
      </div>

      <Section title="Needs you" count={facts.needsYou.length} tone={facts.needsYou.length > 0 ? "var(--lm-coral)" : undefined}>
        {facts.needsYou.length === 0
          ? <Quiet>Nothing waits on you this morning.</Quiet>
          : <ul>{facts.needsYou.map((need) => <NeedRow key={`${need.kind}-${need.id}`} need={need} />)}</ul>}
      </Section>

      <Section title="Done since yesterday" count={worlds.length + (facts.studio.assets.count > 0 || studioDone.length > 0 ? 1 : 0)}>
        {quietDay && <Quiet>A quiet day. Nothing was saved or changed in the last 24 hours.</Quiet>}
        {worlds.map((world) => <WorldNews key={world.worldFolderId} world={world} tasksDone={doneByWorld(world)} />)}
        {(facts.studio.assets.count > 0 || studioDone.length > 0) && <WorldNews
          world={{ worldFolderId: "studio", key: "", name: "Studio", changes: { total: 0, byOp: [], summaries: [] }, assets: facts.studio.assets, storybooks: [], moodboards: [], characters: [], tasks: facts.studio.tasks, openStacks: 0 }}
          tasksDone={studioDone} />}
      </Section>

      <Section title="Questions and decisions" count={facts.tasks.blocked.length + facts.stacks.length}>
        {facts.tasks.blocked.length === 0 && facts.stacks.length === 0 && <Quiet>No open questions.</Quiet>}
        {facts.tasks.blocked.length > 0 && <>
          <Micro className="mb-1 block" color="var(--lm-coral)">Agents ask</Micro>
          <ul>{facts.tasks.blocked.map((task) => <TaskLine key={task.taskId} task={task} question />)}</ul>
        </>}
        {facts.stacks.length > 0 && <>
          <Micro className="mb-1 mt-4 block">Decisions waiting in the Inbox</Micro>
          <ul>{facts.stacks.map((stack) => <li key={stack.stackId} className="flex items-start gap-2 py-2.5" style={{ borderTop: HAIR }}>
            <Link href={stack.path} className="min-w-0 flex-1 active:opacity-70">
              <span className="block text-[14px] font-black uppercase leading-5 tracking-tight" style={display}>{stack.title}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2">
                <Micro color="var(--lm-coral)">{stack.worldName}</Micro>
                <Micro>{stack.decided} of {stack.cards} decided</Micro>
                {stack.agent && <Micro>{stack.agent}</Micro>}
                <Micro color="var(--lm-text-ghost)">{timeAgo(stack.createdAt)}</Micro>
              </span>
            </Link>
            <CopyChip value={`stack:${stack.stackId}`} label="" title={`Copy stack:${stack.stackId}`} />
          </li>)}</ul>
        </>}
        {facts.tasks.created.length > 0 && <p className="mt-3 text-[12px]" style={{ color: "var(--lm-text-tertiary)" }}>
          <Link href="/tasks" className="underline underline-offset-4">{plural(facts.tasks.created.length, "task")} filed since yesterday</Link>; {facts.totals.open} open in the queue.
        </p>}
      </Section>

      <Section title="From the agent" lead={paper.writtenBy && paper.writtenAt ? `${paper.writtenBy.replace(/^agent:/, "")} · ${fullStamp(paper.writtenAt)}` : undefined}>
        {paper.prose
          ? <div className="text-[15px] leading-7" style={{ color: "var(--lm-text-primary)" }}><WorldDocProse body={paper.prose} /></div>
          : <Quiet>No editorial yet. An agent reads the facts with get_newspaper and adds the narrative with write_newspaper.</Quiet>}
      </Section>
    </>}

    <footer className="flex flex-wrap items-center justify-between gap-2 pt-4" style={{ borderTop: RULE }}>
      <CopyChip value={`newspaper:${paper._id}`} label={`newspaper:${paper.date}`} title={`Copy newspaper:${paper._id}`} />
      <Micro color="var(--lm-text-ghost)">{fullStamp(paper.compiledAt)}</Micro>
    </footer>
  </>);
}
