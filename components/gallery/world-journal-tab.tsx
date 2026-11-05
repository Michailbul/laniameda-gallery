"use client";

import { useCallback, useMemo, useState } from "react";
import { useConvex, useConvexAuth, useQuery } from "convex/react";
import { ChevronDown, ChevronRight, RotateCcw, ScrollText } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { diffLines, foldDiff } from "@/lib/line-diff";
import { ActionButton, Micro, RADIUS, display, mono, plural } from "./moodboards-view";
import {
  ActorBadge, MonoBadge, OpBadge, WorldBoundary, clockLabel, dayLabel, errorText, fullStamp, isAgentActor, useWorldUndo,
} from "./world-ui";

type Change = {
  id: string; at: number; actor: string; session?: string; op: string; targetType: string; targetId: string;
  summary: string; revertOf?: string; revertedBy?: string; world: string;
};

const PAGE = 50;

/**
 * Everything agents and Michael changed in a world, newest first, grouped by
 * session (or by actor and hour when a write carried no session). Every row
 * and every session can be undone; undo is always a dry run first.
 */
export function WorldJournalTab(props: { ownerUserId: string; worldKey: string; worldName: string }) {
  return <WorldBoundary resetKey={props.worldKey} what="The journal">
    <WorldJournal {...props} />
  </WorldBoundary>;
}

function WorldJournal({ ownerUserId, worldKey, worldName }: { ownerUserId: string; worldKey: string; worldName: string }) {
  const { isAuthenticated } = useConvexAuth();
  const convex = useConvex();
  // The newest page is live; older pages are read once on demand.
  const first = useQuery(api.worlds.listWorldChanges, isAuthenticated ? { ownerUserId, world: worldKey, limit: PAGE } : "skip");
  const [older, setOlder] = useState<{ changes: Change[]; nextBefore?: number; key: string }>({ changes: [], key: worldKey });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { request, dialog, busyId } = useWorldUndo(ownerUserId);

  const cursor = older.key === worldKey && older.changes.length > 0 ? older.nextBefore : first?.nextBefore;

  const changes = useMemo(() => {
    const seen = new Set<string>();
    const olderChanges = older.key === worldKey ? older.changes : [];
    return [...(first?.changes ?? []), ...olderChanges].filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)));
  }, [first, older, worldKey]);

  const loadOlder = useCallback(async () => {
    if (cursor === undefined) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await convex.query(api.worlds.listWorldChanges, { ownerUserId, world: worldKey, limit: PAGE, before: cursor });
      setOlder((current) => ({
        key: worldKey,
        changes: [...(current.key === worldKey ? current.changes : []), ...page.changes],
        nextBefore: page.nextBefore,
      }));
    } catch (error) {
      setOlderError(errorText(error, "Could not load older changes."));
    } finally {
      setLoadingOlder(false);
    }
  }, [convex, cursor, ownerUserId, worldKey]);

  // Groups in order of their newest change. No session: one group per actor
  // per hour, which is how an agent run without a label reads anyway.
  const groups = useMemo(() => {
    const byKey = new Map<string, { key: string; session?: string; actor?: string; rows: Change[] }>();
    for (const row of changes) {
      const key = row.session ? `s:${row.session}` : `a:${row.actor}:${Math.floor(row.at / 3_600_000)}`;
      const group = byKey.get(key) ?? { key, session: row.session, actor: row.session ? undefined : row.actor, rows: [] };
      group.rows.push(row);
      byKey.set(key, group);
    }
    return [...byKey.values()];
  }, [changes]);

  const agentCount = changes.filter((row) => isAgentActor(row.actor)).length;

  return <section className="px-4 pb-20 pt-4 md:px-6" style={{ color: "var(--lm-text-primary)" }}>
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-3xl font-black uppercase leading-none tracking-tight md:text-4xl" style={display}>Journal</h2>
        <p className="mt-2 text-[11px] uppercase tracking-[0.14em]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>
          {first === undefined ? "Loading changes…" : [worldName, plural(changes.length, "change"), agentCount ? `${agentCount} by agents` : undefined, cursor !== undefined ? "more below" : undefined].filter(Boolean).join(" · ")}
        </p>
      </div>
    </header>

    {first === undefined ? <Micro>Loading…</Micro>
      : changes.length === 0 ? <div className="border border-dashed px-6 py-16 text-center" style={{ borderRadius: RADIUS, borderColor: "var(--lm-border-strong)" }}>
        <ScrollText className="mx-auto mb-3" size={22} style={{ color: "var(--lm-text-ghost)" }} aria-hidden />
        <p className="text-sm font-black uppercase tracking-tight" style={display}>Nothing journaled yet</p>
        <p className="mx-auto mt-2 max-w-md text-xs leading-5" style={{ color: "var(--lm-text-tertiary)" }}>
          Every write to this world lands here with its before and after: docs, filing, shelves, moodboards, profiles and stories. Any of it can be undone.
        </p>
      </div>
      : <div className="grid gap-8">
        {groups.map((group) => {
          const newest = group.rows[0]!;
          const oldest = group.rows[group.rows.length - 1]!;
          const actors = [...new Set(group.rows.map((row) => row.actor))];
          const undoable = group.rows.filter((row) => !row.revertedBy && !row.revertOf).length;
          const sessionBusy = group.session ? busyId === `session:${group.session}` : false;
          return <div key={group.key}>
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="flex min-w-0 items-center gap-2">
                {group.session
                  ? <span className="truncate text-[13px] font-black uppercase tracking-tight" style={display} title={group.session}>{group.session}</span>
                  : <ActorBadge actor={group.actor ?? "owner"} />}
                <Micro color="var(--lm-text-ghost)">
                  {dayLabel(newest.at)} · {clockLabel(oldest.at)}{oldest.at !== newest.at && clockLabel(oldest.at) !== clockLabel(newest.at) ? `–${clockLabel(newest.at)}` : ""} · {group.rows.length}
                </Micro>
                {group.session && actors.map((actor) => <ActorBadge key={actor} actor={actor} />)}
              </div>
              <span aria-hidden className="h-px min-w-[24px] flex-1" style={{ background: "var(--lm-border)" }} />
              {group.session && undoable > 0 && <ActionButton busy={sessionBusy} disabled={busyId !== null}
                icon={<RotateCcw size={12} aria-hidden />} className="!px-2.5 !py-1.5"
                onClick={() => void request({ kind: "session", session: group.session!, world: worldKey, label: `Session ${group.session} · ${plural(undoable, "change")}` })}>
                Undo session
              </ActionButton>}
            </div>
            <ol className="border-y" style={{ borderColor: "var(--lm-border)" }}>
              {group.rows.map((row) => <JournalRow key={row.id} row={row} ownerUserId={ownerUserId}
                open={expanded === row.id} onToggle={() => setExpanded(expanded === row.id ? null : row.id)}
                busy={busyId === row.id} disabled={busyId !== null}
                onUndo={() => void request({ kind: "change", changeId: row.id, label: row.summary })} />)}
            </ol>
          </div>;
        })}
        <div className="flex flex-wrap items-center justify-center gap-3">
          {cursor !== undefined
            ? <ActionButton busy={loadingOlder} disabled={loadingOlder} onClick={() => void loadOlder()}>Load older</ActionButton>
            : <Micro color="var(--lm-text-ghost)">Start of the journal</Micro>}
          {olderError && <span className="text-[12px]" style={{ color: "var(--lm-status-error-text)" }}>{olderError}</span>}
        </div>
      </div>}
    {dialog}
  </section>;
}

function JournalRow({ row, ownerUserId, open, onToggle, busy, disabled, onUndo }: {
  row: Change; ownerUserId: string; open: boolean; onToggle: () => void; busy: boolean; disabled: boolean; onUndo: () => void;
}) {
  const reverted = Boolean(row.revertedBy);
  const isUndo = Boolean(row.revertOf);
  return <li className="border-b last:border-b-0" style={{ borderColor: "var(--lm-border)" }}>
    <div className="flex items-start gap-2 py-2 md:items-center md:gap-3">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex min-w-0 flex-1 flex-col gap-1.5 text-left md:flex-row md:items-center md:gap-3">
        <span className="flex shrink-0 items-center gap-1.5">
          {open ? <ChevronDown size={13} aria-hidden style={{ color: "var(--lm-text-tertiary)" }} /> : <ChevronRight size={13} aria-hidden style={{ color: "var(--lm-text-ghost)" }} />}
          <span className="w-[38px] text-[11px] font-bold" title={fullStamp(row.at)} style={{ ...mono, color: "var(--lm-text-tertiary)" }}>{clockLabel(row.at)}</span>
          <ActorBadge actor={row.actor} />
          <OpBadge op={row.op} />
          {reverted && <MonoBadge color="var(--lm-coral)">undone</MonoBadge>}
          {isUndo && <MonoBadge color="var(--lm-text-secondary)">undo</MonoBadge>}
        </span>
        <span className={`min-w-0 text-[13px] leading-5 ${open ? "" : "md:truncate"}`}
          style={{ color: reverted ? "var(--lm-text-ghost)" : "var(--lm-text-primary)", textDecoration: reverted ? "line-through" : undefined }}>
          {row.summary}
        </span>
      </button>
      {!reverted && !isUndo && <button type="button" disabled={disabled} onClick={onUndo}
        className="shrink-0 px-1.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors hover:text-[var(--lm-coral)] disabled:opacity-40"
        style={{ ...mono, color: "var(--lm-text-tertiary)" }}>
        {busy ? "Checking…" : "Undo"}
      </button>}
    </div>
    {open && <ChangeDetail ownerUserId={ownerUserId} changeId={row.id} />}
  </li>;
}

const parseJson = (text: string | undefined): unknown => {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
};

const bodyOf = (value: unknown) =>
  value && typeof value === "object" && "body" in value ? ((value as { body: unknown }).body as string | null) ?? "" : "";

const compact = (value: unknown) => {
  if (value === null || value === undefined) return "—";
  const text = JSON.stringify(value, null, 1) ?? String(value);
  return text.length > 6000 ? `${text.slice(0, 6000)}\n… ${(text.length - 6000).toLocaleString("en-GB")} more characters` : text;
};

function ChangeDetail({ ownerUserId, changeId }: { ownerUserId: string; changeId: string }) {
  const { isAuthenticated } = useConvexAuth();
  const change = useQuery(api.worlds.getWorldChange, isAuthenticated ? { ownerUserId, changeId: changeId as Id<"worldChanges"> } : "skip");
  if (change === undefined) return <div className="pb-3 pl-6"><Micro>Loading change…</Micro></div>;
  const before = parseJson(change.before);
  const after = parseJson(change.after);
  const isDoc = change.op === "doc.write" || change.op === "doc.delete";

  return <div className="grid gap-3 pb-4 pl-0 md:pl-6">
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>
      <span>{fullStamp(change.at)}</span>
      <span aria-hidden>·</span>
      <span title="Target">{change.targetType}:{change.targetId}</span>
      {change.session && <><span aria-hidden>·</span><span>session {change.session}</span></>}
    </div>
    {isDoc ? <DocDiff before={bodyOf(before)} after={bodyOf(after)} />
      : <div className="grid gap-3 md:grid-cols-2">
        {[{ label: "Before", value: before }, { label: "After", value: after }].map((side) => <div key={side.label} className="min-w-0">
          <Micro color="var(--lm-text-secondary)">{side.label}</Micro>
          <pre className="mt-1.5 max-h-[320px] overflow-auto border px-3 py-2 text-[11px] leading-[1.5]"
            style={{ ...mono, fontFamily: "var(--lm-font-mono, ui-monospace), ui-monospace, monospace", borderRadius: RADIUS, borderColor: "var(--lm-border)", background: "var(--lm-surface-1)", color: "var(--lm-text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {compact(side.value)}
          </pre>
        </div>)}
      </div>}
  </div>;
}

function DocDiff({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => foldDiff(diffLines(before, after), 2), [before, after]);
  const added = lines.filter((line) => line.kind === "add").length;
  const removed = lines.filter((line) => line.kind === "remove").length;
  return <div className="min-w-0">
    <div className="mb-1.5 flex items-center gap-2">
      <Micro color="var(--lm-text-secondary)">Diff</Micro>
      <span className="text-[11px] font-bold" style={{ ...mono, color: "var(--lm-success-text)" }}>+{added}</span>
      <span className="text-[11px] font-bold" style={{ ...mono, color: "var(--lm-coral)" }}>−{removed}</span>
    </div>
    <div className="max-h-[420px] overflow-auto border text-[11.5px] leading-[1.55]"
      style={{ fontFamily: "var(--lm-font-mono, ui-monospace), ui-monospace, monospace", borderRadius: RADIUS, borderColor: "var(--lm-border)", background: "var(--lm-surface-1)" }}>
      {lines.map((line, index) => line.kind === "gap"
        ? <div key={index} className="select-none px-3 py-0.5 text-[10px] uppercase tracking-[0.12em]" style={{ ...mono, color: "var(--lm-text-ghost)", background: "var(--lm-surface-2)" }}>
          ⋯ {plural(line.hidden, "unchanged line")}
        </div>
        : <div key={index} className="flex gap-2 px-3" style={{
          background: line.kind === "add" ? "var(--lm-success-dim)" : line.kind === "remove" ? "color-mix(in srgb, var(--lm-coral) 12%, transparent)" : undefined,
          color: line.kind === "same" ? "var(--lm-text-tertiary)" : "var(--lm-text-primary)",
        }}>
          <span aria-hidden className="w-3 shrink-0 select-none" style={{ color: line.kind === "add" ? "var(--lm-success-text)" : line.kind === "remove" ? "var(--lm-coral)" : "var(--lm-text-ghost)" }}>
            {line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " "}
          </span>
          <span className="min-w-0 whitespace-pre-wrap break-words">{line.text || " "}</span>
        </div>)}
    </div>
  </div>;
}
