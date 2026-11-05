"use client";

import {
  useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useMutation } from "convex/react";
import { Columns2, Eye, PenLine } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { extractHeadings } from "@/lib/world-doc-markdown";
import {
  WORLD_DOC_LEARNINGS, WORLD_DOC_LIMITS, WORLD_DOC_MAIN, WORLD_DOC_TEMPLATE, countLearningEntries,
} from "@/lib/world-docs";
import { ActionButton, RADIUS, mono } from "./moodboards-view";
import { WorldDocReader } from "./world-doc-prose";
import { ActorBadge, clockLabel, errorText, timeAgo } from "./world-ui";
import { usePaneActive } from "./world-view-mode";

// The one editor for a world's files, opened the same way from the HUMAN and
// AGENT views: raw markdown beside its live preview, a cap meter that stays
// in sight, ⌘S / Esc, a draft that outlives a reload, and a way through when
// someone else saved the file meanwhile. Saving goes through writeWorldDoc.

export type WorldDoc = { path: string; body: string; revision: number; updatedAt: number; updatedBy: string };

export const capOf = (path: string) =>
  path === WORLD_DOC_MAIN ? WORLD_DOC_LIMITS.main : path === WORLD_DOC_LEARNINGS ? WORLD_DOC_LIMITS.learnings : WORLD_DOC_LIMITS.doc;

export const titleOf = (path: string) =>
  path === WORLD_DOC_MAIN ? "World" : path === WORLD_DOC_LEARNINGS ? "Learnings" : path.replace(/^docs\//, "").replace(/\.md$/, "").replace(/-/g, " ");

export type DocEdit = {
  kind: "edit";
  /** The revision this edit is based on; a save against another is refused. */
  base: number;
  draft: string;
  note: string;
  /** Set when restoring an old revision. */
  from?: number;
  /** The text the edit opened with: a draft is dirty once it differs. */
  pristine: string;
  /** Set when the draft came back from this device's storage. */
  restoredAt?: number;
};

/* ── Drafts kept on this device ─────────────────────────────────────────── */

const DRAFT_PREFIX = "lm-world-doc-draft:";
type StoredDraft = { draft: string; note: string; base: number; from?: number; at: number };
const draftKey = (worldKey: string, path: string) => `${DRAFT_PREFIX}${worldKey}:${path}`;
const draftListeners = new Set<() => void>();
const notifyDrafts = () => draftListeners.forEach((listener) => listener());

export const readDraft = (worldKey: string, path: string): StoredDraft | null => {
  try {
    const raw = window.localStorage.getItem(draftKey(worldKey, path));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    return typeof parsed?.draft === "string" && typeof parsed.base === "number" ? parsed : null;
  } catch {
    return null;
  }
};

const writeDraft = (worldKey: string, path: string, draft: StoredDraft) => {
  try {
    window.localStorage.setItem(draftKey(worldKey, path), JSON.stringify(draft));
    notifyDrafts();
    return true;
  } catch {
    return false;
  }
};

export const clearDraft = (worldKey: string, path: string) => {
  try {
    window.localStorage.removeItem(draftKey(worldKey, path));
  } catch {
    // Storage refused: nothing was kept either.
  }
  notifyDrafts();
};

const subscribeDrafts = (listener: () => void) => {
  const onStorage = (event: StorageEvent) => { if (!event.key || event.key.startsWith(DRAFT_PREFIX)) listener(); };
  draftListeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    draftListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
};

/** Paths of this world with an unsaved draft on this device. */
export function useStoredDraftPaths(worldKey: string): string[] {
  const snapshot = useSyncExternalStore(subscribeDrafts, () => {
    try {
      const prefix = `${DRAFT_PREFIX}${worldKey}:`;
      const paths: string[] = [];
      for (let index = 0; index < window.localStorage.length; index++) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(prefix)) paths.push(key.slice(prefix.length));
      }
      return paths.sort().join("\n");
    } catch {
      return "";
    }
  }, () => "");
  return useMemo(() => (snapshot ? snapshot.split("\n") : []), [snapshot]);
}

/* ── Starting an edit ───────────────────────────────────────────────────── */

const starterFor = (path: string, worldName: string) =>
  path === WORLD_DOC_MAIN ? WORLD_DOC_TEMPLATE.replace("<WORLD NAME>", worldName)
    : path === WORLD_DOC_LEARNINGS ? "# LEARNINGS\n\n"
      : `# ${titleOf(path).toUpperCase()}\n\n`;

/**
 * Opens a file for editing, from either view. The live text (or the file's
 * starter) unless this device kept an unsaved draft of it, which comes back
 * with the revision it was based on. `body` restores an old revision instead.
 */
export function beginDocEdit({ worldKey, worldName, path, live, body, from }: {
  worldKey: string; worldName: string; path: string; live: WorldDoc | null; body?: string; from?: number;
}): DocEdit {
  const start = body ?? live?.body ?? starterFor(path, worldName);
  const fresh: DocEdit = { kind: "edit", base: live?.revision ?? 0, draft: start, note: "", from, pristine: live?.body ?? start };
  if (body !== undefined) return fresh;
  const saved = readDraft(worldKey, path);
  if (!saved || (saved.draft === start && !saved.note.trim())) return fresh;
  return { ...fresh, draft: saved.draft, note: saved.note, base: saved.base, from: saved.from, restoredAt: saved.at };
}

/**
 * The one save path for a world doc, shared by the HUMAN and AGENT views:
 * writeWorldDoc with the revision the edit started from, so a change made
 * meanwhile (by an agent, or the other view) is refused instead of lost.
 * A saved draft leaves this device's storage.
 */
export function useWorldDocSave(ownerUserId: string, worldKey: string) {
  const write = useMutation(api.worlds.writeWorldDoc);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useCallback(async (path: string, edit: DocEdit) => {
    setSaving(true);
    setError(null);
    try {
      const note = edit.note.trim() || (edit.from ? `restored revision ${edit.from}` : undefined);
      await write({ ownerUserId, world: worldKey, path, body: edit.draft, expectedRevision: edit.base, actor: "owner", note });
      clearDraft(worldKey, path);
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

/* ── The editor ─────────────────────────────────────────────────────────── */

type Layout = "write" | "split" | "preview";
const INDENT = "  ";
// Several editors can be open in the AGENT view; ⌘S and Esc go to the one used last.
let activeEditor: string | null = null;

const fieldStyle = {
  background: "var(--lm-surface-0)", borderColor: "var(--lm-border)", color: "var(--lm-text-primary)", borderRadius: RADIUS,
} as const;

/** Replaces the textarea's selection through the browser, so ⌘Z still undoes it. */
const replaceSelection = (area: HTMLTextAreaElement, start: number, end: number, text: string) => {
  area.setSelectionRange(start, end);
  const done = typeof document.execCommand === "function" && document.execCommand("insertText", false, text);
  if (!done) area.setRangeText(text, start, end, "end");
};

export function DocEditor({ worldKey, path, mode, setMode, live, saving, error, onSave, onCancel }: {
  worldKey: string;
  path: string;
  mode: DocEdit;
  setMode: (mode: DocEdit) => void;
  /** The file as the server has it now: a newer revision than mode.base is a conflict. */
  live: WorldDoc | null;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const editorId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const paneActive = usePaneActive();
  const [layout, setLayout] = useState<Layout>("split");
  const [wide, setWide] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [showNewer, setShowNewer] = useState(false);
  const [replaceArmed, setReplaceArmed] = useState(false);
  const [keptAt, setKeptAt] = useState<number | null>(mode.restoredAt ?? null);

  const cap = capOf(path);
  const length = mode.draft.replace(/\r\n/g, "\n").trimEnd().length + 1;
  const entries = path === WORLD_DOC_LEARNINGS ? countLearningEntries(mode.draft) : null;
  const overChars = length > cap;
  const overEntries = entries !== null && entries > WORLD_DOC_LIMITS.learningEntries;
  const over = overChars || overEntries;
  const serverRevision = live?.revision ?? 0;
  const conflict = serverRevision !== mode.base;
  const dirty = mode.draft !== mode.pristine || mode.note.trim() !== "";
  const canSave = !saving && !over && !conflict && Boolean(mode.draft.trim());
  const view: Layout = layout === "split" && !wide ? "write" : layout;
  const previewBody = showNewer && live ? live.body : mode.draft;

  // Split needs room: under ~880px the two panes take turns.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= 880));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    activeEditor = editorId;
    return () => { if (activeEditor === editorId) activeEditor = null; };
  }, [editorId]);

  // The draft is kept on this device as you type, and dropped once it matches the file again.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!dirty) {
        if (readDraft(worldKey, path)) clearDraft(worldKey, path);
        setKeptAt(null);
        return;
      }
      const at = Date.now();
      if (writeDraft(worldKey, path, { draft: mode.draft, note: mode.note, base: mode.base, from: mode.from, at })) setKeptAt(at);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [dirty, mode.base, mode.draft, mode.from, mode.note, path, worldKey]);

  const discard = useCallback(() => {
    clearDraft(worldKey, path);
    setConfirmDiscard(false);
    onCancel();
  }, [onCancel, path, worldKey]);

  const requestCancel = useCallback(() => {
    if (dirty) setConfirmDiscard(true);
    else discard();
  }, [dirty, discard]);

  useEffect(() => {
    if (!paneActive) return;
    const onKey = (event: KeyboardEvent) => {
      if (activeEditor !== editorId) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (canSave) onSave();
        return;
      }
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        if (confirmDiscard) setConfirmDiscard(false);
        else requestCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [canSave, confirmDiscard, editorId, onSave, paneActive, requestCancel]);

  /* Writing */

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    const area = event.currentTarget;
    const { selectionStart: start, selectionEnd: end, value } = area;
    if (start === end && !event.shiftKey) {
      replaceSelection(area, start, end, INDENT);
      return;
    }
    // Several lines, or Shift: indent or outdent every line touched.
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
    const block = value.slice(lineStart, lineEnd);
    const next = block.split("\n").map((line) => (event.shiftKey ? line.replace(/^ {1,2}|^\t/, "") : INDENT + line)).join("\n");
    replaceSelection(area, lineStart, lineEnd, next);
    area.setSelectionRange(lineStart, lineStart + next.length);
  };

  // The preview follows the caret: same section, same place within it.
  const headings = useMemo(() => extractHeadings(mode.draft), [mode.draft]);
  const previewPrefix = `pv${editorId.replace(/[^a-z0-9]/gi, "")}-`;
  const followCaret = useCallback(() => {
    const area = areaRef.current;
    const pane = previewRef.current;
    if (!area || !pane || view !== "split" || showNewer) return;
    const caretLine = area.value.slice(0, area.selectionStart).split("\n").length - 1;
    const totalLines = area.value.split("\n").length;
    const top = (id: string | null) => {
      if (!id) return null;
      const element = pane.querySelector<HTMLElement>(`[id="${CSS.escape(previewPrefix + id)}"]`);
      return element ? element.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop : null;
    };
    let index = -1;
    headings.forEach((heading, at) => { if (heading.line <= caretLine) index = at; });
    const from = index >= 0 ? { line: headings[index].line, y: top(headings[index].id) ?? 0 } : { line: 0, y: 0 };
    const nextHeading = headings[index + 1];
    const to = nextHeading
      ? { line: nextHeading.line, y: top(nextHeading.id) ?? pane.scrollHeight }
      : { line: totalLines, y: pane.scrollHeight };
    const fraction = to.line > from.line ? (caretLine - from.line) / (to.line - from.line) : 0;
    const target = from.y + fraction * (to.y - from.y) - pane.clientHeight * 0.3;
    pane.scrollTo({ top: Math.max(0, target) });
  }, [headings, previewPrefix, showNewer, view]);

  const caretFrame = useRef<number | null>(null);
  const scheduleFollow = () => {
    if (caretFrame.current !== null) cancelAnimationFrame(caretFrame.current);
    caretFrame.current = requestAnimationFrame(() => { caretFrame.current = null; followCaret(); });
  };
  useEffect(() => () => { if (caretFrame.current !== null) cancelAnimationFrame(caretFrame.current); }, []);

  const keepMine = () => {
    setShowNewer(false);
    setMode({ ...mode, base: serverRevision });
  };
  const takeNewer = () => {
    if (!replaceArmed) { setReplaceArmed(true); return; }
    setReplaceArmed(false);
    setShowNewer(false);
    setMode({ ...mode, draft: live?.body ?? "", base: serverRevision, pristine: live?.body ?? "" });
  };

  const LAYOUTS: Array<{ value: Layout; label: string; icon: typeof PenLine }> = [
    { value: "write", label: "Write", icon: PenLine },
    ...(wide ? [{ value: "split" as const, label: "Split", icon: Columns2 }] : []),
    { value: "preview", label: "Preview", icon: Eye },
  ];

  return <div ref={rootRef} className="wedit" data-view={view}
    onFocusCapture={() => { activeEditor = editorId; }} onPointerDownCapture={() => { activeEditor = editorId; }}>
    {/* Toolbar: stays in sight while the text scrolls. */}
    <div className="wedit-bar">
      <div role="radiogroup" aria-label="Editor layout" className="wedit-seg">
        {LAYOUTS.map(({ value, label, icon: Icon }) => <button key={value} type="button" role="radio" aria-checked={view === value}
          onClick={() => setLayout(value)}><Icon aria-hidden />{label}</button>)}
      </div>
      <div className="wedit-meter" aria-live="polite" data-over={over || undefined}>
        <span className="wedit-meter-text" style={{ color: overChars ? "var(--lm-coral)" : undefined }}>
          {length.toLocaleString("en-GB")}<span className="wedit-meter-cap"> / {cap.toLocaleString("en-GB")}</span>
        </span>
        <span aria-hidden className="wedit-meter-track"><span style={{ width: `${Math.min(100, (length / cap) * 100)}%` }} /></span>
        {entries !== null && <span className="wedit-meter-text" style={{ color: overEntries ? "var(--lm-coral)" : undefined }}>
          {entries}<span className="wedit-meter-cap"> / {WORLD_DOC_LIMITS.learningEntries} entries</span>
        </span>}
      </div>
      <span className="wedit-kept" title="Unsaved text is kept in this browser until you save or discard it">
        {dirty ? keptAt ? `Draft kept · ${clockLabel(keptAt)}` : "Unsaved" : "No changes"}
      </span>
      <div className="wedit-actions">
        <ActionButton disabled={saving} onClick={requestCancel} title="Esc">Cancel</ActionButton>
        <ActionButton tone="coral" busy={saving} disabled={!canSave} onClick={onSave}
          title={conflict ? "A newer revision exists. Keep your draft or take the newer text first." : "⌘S"}>
          Save r{serverRevision + 1}
        </ActionButton>
      </div>
    </div>

    {confirmDiscard && <div className="wedit-note wedit-note-ink" role="alertdialog" aria-label="Discard changes?">
      <span>Discard your changes to {path}? The kept draft goes too.</span>
      <span className="wedit-note-actions">
        <ActionButton onClick={() => setConfirmDiscard(false)} autoFocus>Keep editing</ActionButton>
        <ActionButton tone="danger" onClick={discard}>Discard</ActionButton>
      </span>
    </div>}

    {mode.restoredAt !== undefined && !confirmDiscard && <div className="wedit-note" role="status">
      <span>Your unsaved draft from {clockLabel(mode.restoredAt)} is back, based on r{mode.base}.</span>
      <span className="wedit-note-actions">
        <ActionButton onClick={() => setMode({ ...mode, draft: mode.pristine, note: "", base: serverRevision, restoredAt: undefined, from: undefined })}>
          Start from r{serverRevision}
        </ActionButton>
      </span>
    </div>}

    {mode.from !== undefined && <div className="wedit-note" role="status">
      <span>Restoring revision {mode.from}. Saving writes it as a new revision; nothing is lost.</span>
    </div>}

    {conflict && <div className="wedit-note wedit-note-coral" role="status">
      <span>
        {path} changed while you were editing: now r{serverRevision}
        {live && <> · <ActorBadge actor={live.updatedBy} /> · {timeAgo(live.updatedAt)}</>}. Your draft is based on r{mode.base}.
      </span>
      <span className="wedit-note-actions">
        {live && <ActionButton aria-pressed={showNewer} onClick={() => { setShowNewer(!showNewer); if (view === "write") setLayout(wide ? "split" : "preview"); }}>
          {showNewer ? "Show my draft" : `Show r${serverRevision}`}
        </ActionButton>}
        <ActionButton tone="ink" onClick={keepMine} title={`Save your draft as r${serverRevision + 1}; r${serverRevision} stays in the history`}>Keep my draft</ActionButton>
        <ActionButton tone={replaceArmed ? "danger" : "ghost"} onClick={takeNewer} onBlur={() => setReplaceArmed(false)}>
          {replaceArmed ? "Replace my draft?" : `Use r${serverRevision}`}
        </ActionButton>
      </span>
    </div>}

    <div className="wedit-panes">
      <div className="wedit-write" hidden={view === "preview"}>
        <div className="wedit-grow" data-value={`${mode.draft}\n`}>
          <textarea ref={areaRef} value={mode.draft} spellCheck autoFocus aria-label={`${path} markdown`}
            onChange={(event) => { setMode({ ...mode, draft: event.target.value }); scheduleFollow(); }}
            onKeyDown={onKeyDown} onSelect={scheduleFollow} onClick={scheduleFollow} />
        </div>
      </div>
      <div className="wedit-preview" hidden={view === "write"} aria-label={showNewer ? `r${serverRevision} as saved` : "Preview"}>
        <div className="wedit-preview-head">
          <span>{showNewer ? `r${serverRevision} · saved by others` : "Preview"}</span>
          {showNewer && <button type="button" onClick={() => setShowNewer(false)}>Back to my draft</button>}
        </div>
        <div ref={previewRef} className="wedit-preview-scroll">
          {previewBody.trim()
            ? <WorldDocReader path={path} body={previewBody} idPrefix={previewPrefix} toc={false} />
            : <p className="wedit-empty">Nothing to preview yet.</p>}
        </div>
      </div>
    </div>

    <div className="wedit-foot">
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
      <p className="wedit-keys" style={mono}>
        <span><kbd>⌘S</kbd> save</span><span><kbd>Esc</kbd> cancel</span><span><kbd>Tab</kbd> indent</span><span><kbd>⇧Tab</kbd> outdent</span>
      </p>
    </div>
  </div>;
}
