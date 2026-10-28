"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { FileText, History, Pencil, Plus, RotateCcw, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  WORLD_DOC_LEARNINGS, WORLD_DOC_LIMITS, WORLD_DOC_MAIN, WORLD_DOC_TEMPLATE, countLearningEntries, normalizeWorldDocPath,
} from "@/lib/world-docs";
import { ActionButton, Micro, RADIUS, display, mono } from "./moodboards-view";
import { SkillMarkdown } from "./skill-markdown";
import {
  ActorBadge, MonoBadge, WorldBoundary, errorText, fullStamp, timeAgo, useWorldUndo,
} from "./world-ui";
import { usePaneActive } from "./world-view-mode";

export type WorldDoc = { path: string; body: string; revision: number; updatedAt: number; updatedBy: string };

export const capOf = (path: string) =>
  path === WORLD_DOC_MAIN ? WORLD_DOC_LIMITS.main : path === WORLD_DOC_LEARNINGS ? WORLD_DOC_LIMITS.learnings : WORLD_DOC_LIMITS.doc;

export const titleOf = (path: string) =>
  path === WORLD_DOC_MAIN ? "World" : path === WORLD_DOC_LEARNINGS ? "Learnings" : path.replace(/^docs\//, "").replace(/\.md$/, "").replace(/-/g, " ");

const ROLE: Record<string, string> = {
  [WORLD_DOC_MAIN]: "Identity, canon pointers, styles and dated rules. The world's CLAUDE.md.",
  [WORLD_DOC_LEARNINGS]: "One dated line per learning, each with its source. Promoted into WORLD.md once confirmed twice.",
};

const fieldStyle = {
  background: "var(--lm-surface-0)", borderColor: "var(--lm-border)", color: "var(--lm-text-primary)", borderRadius: RADIUS,
} as const;

/**
 * A world's files: WORLD.md, LEARNINGS.md and up to eight docs/*.md. Read as
 * rendered markdown, edited as plain text against the server's caps, with a
 * history of every saved version and undo through the journal. The HUMAN
 * view of a world's instructions (world-instructions.tsx) is built on it.
 */
export function WorldDocFiles(props: WorldDocsProps) {
  return <WorldBoundary resetKey={props.worldKey} what="World docs">
    <WorldDocs {...props} />
  </WorldBoundary>;
}

type WorldDocsProps = {
  ownerUserId: string; worldKey: string; worldName: string;
  /** listWorldDocs for this world, read once by the panel; undefined while loading. */
  rows: WorldDoc[] | undefined;
};

export type DocMode =
  | { kind: "read" }
  | { kind: "edit"; base: number; draft: string; note: string; from?: number }
  | { kind: "version"; revision: number; body: string | null; at: number; actor: string };
type Mode = DocMode;

/**
 * The one save path for a world doc, shared by the HUMAN and AGENT views:
 * writeWorldDoc with the revision the edit started from, so a change made
 * meanwhile (by an agent, or the other view) is refused instead of lost.
 */
export function useWorldDocSave(ownerUserId: string, worldKey: string) {
  const write = useMutation(api.worlds.writeWorldDoc);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useCallback(async (path: string, edit: Extract<DocMode, { kind: "edit" }>) => {
    setSaving(true);
    setError(null);
    try {
      const note = edit.note.trim() || (edit.from ? `restored revision ${edit.from}` : undefined);
      await write({ ownerUserId, world: worldKey, path, body: edit.draft, expectedRevision: edit.base, actor: "owner", note });
      return true;
    } catch (caught) {
      setError(errorText(caught, "Could not save this doc."));
      return false;
    } finally {
      setSaving(false);
    }
  }, [ownerUserId, worldKey, write]);
  return { save, saving, error, setError };
}

function WorldDocs({ ownerUserId, worldKey, worldName, rows }: WorldDocsProps) {
  const { save: saveDoc, saving, error: saveError, setError: setSaveError } = useWorldDocSave(ownerUserId, worldKey);

  const [path, setPath] = useState<string>(WORLD_DOC_MAIN);
  const [mode, setMode] = useState<Mode>({ kind: "read" });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [drafts, setDrafts] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const docs = useMemo(() => {
    const byPath = new Map<string, WorldDoc>((rows ?? []).map((row) => [row.path, row]));
    // The two fixed files are always listed, written or not.
    const paths = [WORLD_DOC_MAIN, WORLD_DOC_LEARNINGS, ...[...byPath.keys(), ...drafts].filter((entry) => entry.startsWith("docs/"))];
    return [...new Set(paths)].map((entry) => ({ path: entry, doc: byPath.get(entry) ?? null }));
  }, [rows, drafts]);
  const docCount = docs.filter((entry) => entry.path.startsWith("docs/") && entry.doc).length;

  const current = docs.find((entry) => entry.path === path)?.doc ?? null;

  // Switching files leaves edit and version views.
  const openPath = (next: string) => {
    setPath(next);
    setMode({ kind: "read" });
    setSaveError(null);
  };

  const startEdit = (body?: string, from?: number) => {
    setSaveError(null);
    setMode({
      kind: "edit", base: current?.revision ?? 0, note: "", from,
      draft: body ?? current?.body ?? (path === WORLD_DOC_MAIN ? WORLD_DOC_TEMPLATE.replace("<WORLD NAME>", worldName) : ""),
    });
  };

  const save = async () => {
    if (mode.kind !== "edit") return;
    if (!await saveDoc(path, mode)) return;
    setDrafts((list) => list.filter((entry) => entry !== path));
    setMode({ kind: "read" });
  };

  const createDoc = () => {
    const normalized = normalizeWorldDocPath(newName);
    if (!normalized) {
      setSaveError(`"${newName}" is not a doc name. Use lowercase words with dashes, like tags-vocabulary.`);
      return;
    }
    setCreating(false);
    setNewName("");
    setSaveError(null);
    if (!normalized.startsWith("docs/") || docs.some((entry) => entry.path === normalized)) {
      openPath(normalized);
      return;
    }
    setDrafts((list) => [...list, normalized]);
    setPath(normalized);
    setMode({ kind: "edit", base: 0, draft: `# ${titleOf(normalized).toUpperCase()}\n\n`, note: "" });
  };

  const editing = mode.kind === "edit";
  const changedUnderneath = editing && (current?.revision ?? 0) !== mode.base;

  return <section style={{ color: "var(--lm-text-primary)" }}>
    <div className="grid gap-5 md:grid-cols-[232px_minmax(0,1fr)] md:gap-8">
      {/* Files: a column on desktop, a sideways strip on a phone. */}
      <nav aria-label="World files" className="min-w-0">
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:grid md:gap-1 md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden">
          {docs.map(({ path: entry, doc }) => {
            const active = entry === path;
            const cap = capOf(entry);
            return <button key={entry} type="button" aria-current={active ? "page" : undefined} onClick={() => openPath(entry)}
              className="group min-w-[180px] shrink-0 border px-3 py-2.5 text-left transition-colors md:min-w-0"
              style={{
                borderRadius: RADIUS,
                borderColor: active ? "var(--lm-ink)" : "var(--lm-border)",
                background: active ? "var(--lm-surface-2)" : "transparent",
              }}>
              <span className="flex items-center gap-1.5">
                <FileText size={12} aria-hidden style={{ color: active ? "var(--lm-coral)" : "var(--lm-text-ghost)" }} />
                <span className="truncate text-[12px] font-bold" style={{ ...mono, color: doc ? "var(--lm-text-primary)" : "var(--lm-text-tertiary)" }}>{entry}</span>
              </span>
              <span className="mt-1.5 flex flex-wrap items-center gap-1">
                {doc ? <>
                  <MonoBadge color={doc.body.length > cap * 0.9 ? "var(--lm-coral)" : undefined} title="Characters / cap">
                    {doc.body.length.toLocaleString("en-GB")}/{cap.toLocaleString("en-GB")}
                  </MonoBadge>
                  {entry === WORLD_DOC_LEARNINGS && <MonoBadge title="Entries / cap">{countLearningEntries(doc.body)}/{WORLD_DOC_LIMITS.learningEntries}</MonoBadge>}
                  <MonoBadge title="Revision">r{doc.revision}</MonoBadge>
                  <ActorBadge actor={doc.updatedBy} />
                </> : <MonoBadge>{drafts.includes(entry) ? "new" : "not written"}</MonoBadge>}
              </span>
            </button>;
          })}
          {creating ? <form className="min-w-[200px] shrink-0 md:min-w-0" onSubmit={(event) => { event.preventDefault(); createDoc(); }}>
            <label className="sr-only" htmlFor="world-doc-name">Doc name</label>
            <div className="flex items-center gap-1 border px-2 py-1.5" style={fieldStyle}>
              <span className="text-[11px]" style={{ ...mono, color: "var(--lm-text-ghost)" }}>docs/</span>
              <input id="world-doc-name" autoFocus value={newName} onChange={(event) => setNewName(event.target.value)}
                placeholder="tags-vocabulary" className="min-w-0 flex-1 bg-transparent text-[12px] outline-none" style={mono}
                onKeyDown={(event) => { if (event.key === "Escape") { setCreating(false); setNewName(""); } }} />
              <span className="text-[11px]" style={{ ...mono, color: "var(--lm-text-ghost)" }}>.md</span>
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <ActionButton type="submit" tone="ink" disabled={!newName.trim()}>Create</ActionButton>
              <ActionButton onClick={() => { setCreating(false); setNewName(""); }}>Cancel</ActionButton>
            </div>
          </form>
            : <button type="button" disabled={docCount >= WORLD_DOC_LIMITS.docs || rows === undefined}
              title={docCount >= WORLD_DOC_LIMITS.docs ? `A world holds at most ${WORLD_DOC_LIMITS.docs} docs. Merge or delete one first.` : "Add a docs/<name>.md"}
              onClick={() => { setCreating(true); setSaveError(null); }}
              className="inline-flex shrink-0 items-center gap-1.5 border border-dashed px-3 py-2.5 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors hover:text-[var(--lm-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
              style={{ ...mono, borderRadius: RADIUS, borderColor: "var(--lm-border-strong)", color: "var(--lm-text-tertiary)" }}>
              <Plus size={12} aria-hidden />New doc
            </button>}
        </div>
      </nav>

      <div className="min-w-0">
        {/* File header */}
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b pb-4" style={{ borderColor: "var(--lm-border)" }}>
          <div className="min-w-0">
            <h3 className="truncate text-xl font-black uppercase leading-none tracking-tight md:text-2xl" style={display}>{titleOf(path)}</h3>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>
              <span style={{ color: "var(--lm-text-secondary)" }}>{path}</span>
              {current && <><span aria-hidden>·</span><span title={fullStamp(current.updatedAt)}>r{current.revision} · {timeAgo(current.updatedAt)}</span></>}
            </p>
            {ROLE[path] && <p className="mt-1.5 max-w-xl text-[12px] leading-5" style={{ color: "var(--lm-text-tertiary)" }}>{ROLE[path]}</p>}
          </div>
          {!editing && <div className="flex shrink-0 flex-wrap gap-1.5">
            {mode.kind === "version" && <ActionButton icon={<X size={13} aria-hidden />} onClick={() => setMode({ kind: "read" })}>Current</ActionButton>}
            {(current || drafts.includes(path) || path === WORLD_DOC_MAIN || path === WORLD_DOC_LEARNINGS) && mode.kind === "read" &&
              <ActionButton tone="ink" disabled={rows === undefined} icon={<Pencil size={13} aria-hidden />} onClick={() => startEdit()}>
                {current ? "Edit" : "Write"}
              </ActionButton>}
            {current && <ActionButton aria-expanded={historyOpen} icon={<History size={13} aria-hidden />}
              style={historyOpen ? { background: "var(--lm-surface-2)" } : undefined}
              onClick={() => setHistoryOpen(!historyOpen)}>History</ActionButton>}
          </div>}
        </div>

        <div className={historyOpen && !editing ? "grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]" : ""}>
          <div className="min-w-0">
            {rows === undefined ? <Micro>Loading…</Micro>
              : editing ? <DocEditor path={path} mode={mode} setMode={setMode} saving={saving} error={saveError}
                changedUnderneath={changedUnderneath} serverRevision={current?.revision ?? 0}
                onSave={() => void save()} onCancel={() => {
                  // A new doc that was never saved disappears with its draft.
                  if (!current && drafts.includes(path)) {
                    setDrafts((list) => list.filter((entry) => entry !== path));
                    openPath(WORLD_DOC_MAIN);
                    return;
                  }
                  setMode({ kind: "read" });
                  setSaveError(null);
                }} />
              : mode.kind === "version" ? <VersionView version={mode} onRestore={() => mode.body !== null && startEdit(mode.body, mode.revision)} />
              : current ? <article className="max-w-[760px]"><SkillMarkdown>{current.body}</SkillMarkdown></article>
              : <EmptyDoc path={path} onWrite={() => startEdit()} error={saveError} />}
          </div>
          {historyOpen && !editing && current && <DocHistory ownerUserId={ownerUserId} worldKey={worldKey} path={path}
            viewing={mode.kind === "version" ? mode.revision : null}
            onView={(entry) => setMode({ kind: "version", revision: entry.revision, body: entry.body, at: entry.at, actor: entry.actor })} />}
        </div>
      </div>
    </div>
  </section>;
}

function EmptyDoc({ path, onWrite, error }: { path: string; onWrite: () => void; error: string | null }) {
  return <div className="border border-dashed px-6 py-14 text-center" style={{ borderRadius: RADIUS, borderColor: "var(--lm-border-strong)" }}>
    <FileText className="mx-auto mb-3" size={22} style={{ color: "var(--lm-text-ghost)" }} aria-hidden />
    <p className="text-sm font-black uppercase tracking-tight" style={display}>{path} is not written yet</p>
    <p className="mx-auto mt-2 max-w-md text-xs leading-5" style={{ color: "var(--lm-text-tertiary)" }}>
      {path === WORLD_DOC_MAIN
        ? "Agents read this first when they open the world. Start from the template: identity, canon, rules, open questions."
        : path === WORLD_DOC_LEARNINGS
          ? "Agents add what each round taught here, one dated line with its source."
          : "Optional depth that would crowd WORLD.md."}
    </p>
    {error && <p className="mt-3 text-[12px]" style={{ color: "var(--lm-status-error-text)" }}>{error}</p>}
    <ActionButton tone="coral" className="mt-5" icon={<Pencil size={13} aria-hidden />} onClick={onWrite}>Write {path}</ActionButton>
  </div>;
}

export function DocEditor({ path, mode, setMode, saving, error, changedUnderneath, serverRevision, onSave, onCancel }: {
  path: string; mode: Extract<Mode, { kind: "edit" }>; setMode: (mode: Mode) => void; saving: boolean; error: string | null;
  changedUnderneath: boolean; serverRevision: number; onSave: () => void; onCancel: () => void;
}) {
  const cap = capOf(path);
  const length = mode.draft.replace(/\r\n/g, "\n").trimEnd().length + 1;
  const entries = path === WORLD_DOC_LEARNINGS ? countLearningEntries(mode.draft) : null;
  const overChars = length > cap;
  const overEntries = entries !== null && entries > WORLD_DOC_LIMITS.learningEntries;
  const over = overChars || overEntries;
  // Both views stay mounted: only the visible one's editor answers ⌘S.
  const paneActive = usePaneActive();

  useEffect(() => {
    if (!paneActive) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        if (!over && !saving) onSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSave, over, paneActive, saving]);

  return <div className="grid gap-3">
    {mode.from !== undefined && <p className="text-[12px]" style={{ ...mono, color: "var(--lm-text-secondary)" }}>
      Restoring revision {mode.from}. Saving writes it as a new revision; nothing is lost.
    </p>}
    {changedUnderneath && <p className="border px-3 py-2 text-[12px] leading-5" role="status"
      style={{ borderRadius: RADIUS, borderColor: "var(--lm-coral)", color: "var(--lm-coral)" }}>
      {path} changed while you were editing (now r{serverRevision}). Saving will be refused; copy your text, cancel and edit again.
    </p>}
    <textarea value={mode.draft} onChange={(event) => setMode({ ...mode, draft: event.target.value })}
      aria-label={`${path} text`} spellCheck autoFocus
      className="lm-field min-h-[52dvh] w-full resize-y border px-4 py-3 text-[13px] leading-[1.65] outline-none"
      style={{ ...fieldStyle, fontFamily: "var(--lm-font-mono, ui-monospace), ui-monospace, monospace" }} />
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="text-[11px] font-bold tracking-[0.04em]" style={{ ...mono, color: overChars ? "var(--lm-coral)" : "var(--lm-text-tertiary)" }} aria-live="polite">
        {length.toLocaleString("en-GB")} / {cap.toLocaleString("en-GB")} chars
      </span>
      {entries !== null && <span className="text-[11px] font-bold tracking-[0.04em]" style={{ ...mono, color: overEntries ? "var(--lm-coral)" : "var(--lm-text-tertiary)" }}>
        {entries} / {WORLD_DOC_LIMITS.learningEntries} entries
      </span>}
      <div aria-hidden className="h-[3px] min-w-[80px] flex-1 overflow-hidden" style={{ background: "var(--lm-surface-2)", borderRadius: "999px" }}>
        <div className="h-full" style={{ width: `${Math.min(100, (length / cap) * 100)}%`, background: overChars ? "var(--lm-coral)" : "var(--lm-text-secondary)", borderRadius: "999px" }} />
      </div>
    </div>
    <input value={mode.note} maxLength={WORLD_DOC_LIMITS.note} onChange={(event) => setMode({ ...mode, note: event.target.value })}
      placeholder="What changed (optional, goes in the journal)" aria-label="Change note"
      className="lm-field w-full border px-3 py-2 text-[13px] outline-none" style={fieldStyle} />
    {over && <p className="text-[12px] leading-5" style={{ color: "var(--lm-coral)" }}>
      {path === WORLD_DOC_LEARNINGS
        ? "Over the cap. Promote confirmed learnings into WORLD.md rules and delete superseded ones first."
        : path === WORLD_DOC_MAIN ? "Over the cap. Move depth into a docs/<name>.md." : "Over the cap. Split it or tighten it."}
    </p>}
    {error && <p className="border px-3 py-2 text-[12px] leading-5" role="alert"
      style={{ borderRadius: RADIUS, borderColor: "var(--lm-status-error-border)", color: "var(--lm-status-error-text)", background: "var(--lm-status-error-dim)" }}>{error}</p>}
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="mr-auto text-[10px] uppercase tracking-[0.12em]" style={{ ...mono, color: "var(--lm-text-ghost)" }}>⌘S saves</span>
      <ActionButton disabled={saving} onClick={onCancel}>Cancel</ActionButton>
      <ActionButton tone="coral" busy={saving} disabled={saving || over || !mode.draft.trim()} onClick={onSave}>Save r{serverRevision + 1}</ActionButton>
    </div>
  </div>;
}

function VersionView({ version, onRestore }: { version: Extract<Mode, { kind: "version" }>; onRestore: () => void }) {
  return <div>
    <div className="mb-4 flex flex-wrap items-center gap-2 border px-3 py-2" style={{ borderRadius: RADIUS, borderColor: "var(--lm-border-strong)", background: "var(--lm-surface-1)" }}>
      <Micro color="var(--lm-text-primary)">Revision {version.revision}</Micro>
      <ActorBadge actor={version.actor} />
      <span className="text-[11px]" style={{ ...mono, color: "var(--lm-text-tertiary)" }}>{fullStamp(version.at)} · read only</span>
      {version.body !== null && <ActionButton className="ml-auto" tone="ink" icon={<RotateCcw size={13} aria-hidden />} onClick={onRestore}>Restore this version</ActionButton>}
    </div>
    {version.body === null
      ? <p className="text-[13px]" style={{ color: "var(--lm-text-tertiary)" }}>This entry deleted the doc.</p>
      : <article className="max-w-[760px] opacity-90"><SkillMarkdown>{version.body}</SkillMarkdown></article>}
  </div>;
}

type HistoryEntry = { changeId: string; at: number; actor: string; summary: string; revision: number; body: string | null; revertedBy?: string };

function DocHistory({ ownerUserId, worldKey, path, viewing, onView }: {
  ownerUserId: string; worldKey: string; path: string; viewing: number | null; onView: (entry: HistoryEntry) => void;
}) {
  const { isAuthenticated } = useConvexAuth();
  const history = useQuery(api.worlds.worldDocHistory, isAuthenticated ? { ownerUserId, world: worldKey, path, limit: 30 } : "skip");
  const { request, dialog, busyId } = useWorldUndo(ownerUserId);

  return <aside aria-label={`${path} history`} className="min-w-0 xl:border-l xl:pl-5" style={{ borderColor: "var(--lm-border)" }}>
    <div className="mb-3 flex items-center gap-2">
      <Micro color="var(--lm-text-primary)">History</Micro>
      {history && <Micro color="var(--lm-text-ghost)">{history.length}</Micro>}
      <span aria-hidden className="h-px flex-1" style={{ background: "var(--lm-border)" }} />
    </div>
    {history === undefined ? <Micro>Loading…</Micro>
      : history.length === 0 ? <p className="text-[12px] leading-5" style={{ color: "var(--lm-text-tertiary)" }}>No journaled versions yet. Writes made before the journal existed have no history.</p>
      : <ol className="grid">
        {history.map((entry, index) => {
          const reverted = Boolean(entry.revertedBy);
          const active = viewing === entry.revision && entry.body !== null;
          return <li key={entry.changeId} className="relative border-l py-2.5 pl-4" style={{ borderColor: "var(--lm-border-strong)" }}>
            <span aria-hidden className="absolute -left-[4px] top-[15px] h-[7px] w-[7px]"
              style={{ borderRadius: "999px", background: index === 0 ? "var(--lm-coral)" : active ? "var(--lm-ink)" : "var(--lm-surface-3)" }} />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-bold" style={{ ...mono, color: "var(--lm-text-primary)" }}>r{entry.revision}</span>
              <ActorBadge actor={entry.actor} />
              {reverted && <MonoBadge color="var(--lm-coral)">undone</MonoBadge>}
              <span className="text-[10px]" title={fullStamp(entry.at)} style={{ ...mono, color: "var(--lm-text-ghost)" }}>{timeAgo(entry.at)}</span>
            </div>
            <p className="mt-1 text-[12px] leading-[1.45]" style={{ color: reverted ? "var(--lm-text-ghost)" : "var(--lm-text-secondary)", textDecoration: reverted ? "line-through" : undefined }}>
              {entry.summary}
            </p>
            <div className="mt-1.5 flex gap-3">
              {entry.body !== null && <button type="button" onClick={() => onView(entry)}
                className="text-[10px] font-bold uppercase tracking-[0.12em] hover:text-[var(--lm-text-primary)]"
                style={{ ...mono, color: active ? "var(--lm-text-primary)" : "var(--lm-text-tertiary)" }}>
                {active ? "Viewing" : "View"}
              </button>}
              {!reverted && <button type="button" disabled={busyId !== null}
                onClick={() => void request({ kind: "change", changeId: entry.changeId, label: entry.summary })}
                className="text-[10px] font-bold uppercase tracking-[0.12em] hover:text-[var(--lm-coral)] disabled:opacity-40"
                style={{ ...mono, color: "var(--lm-text-tertiary)" }}>
                {busyId === entry.changeId ? "Checking…" : "Undo"}
              </button>}
            </div>
          </li>;
        })}
      </ol>}
    {dialog}
  </aside>;
}
