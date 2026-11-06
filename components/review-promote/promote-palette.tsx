"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  filterFolders,
  framesWord,
  preselectPlace,
  preselectProject,
  readMemory,
  type PromoteChoice,
  type PromoteFolder,
  type PromoteFrame,
  type PromoteProject,
} from "./promote-model";

// The promote palette: project, folder (type to filter, ↑↓, grouped by
// section and area), style chips, an optional note. Enter promotes, Esc
// closes. Code-split: it loads the first time R is pressed.

const SECTION_LABEL: Record<PromoteFolder["section"], string> = {
  locations: "Locations",
  characters: "Characters",
  scenes: "Scenes",
};
const STRIP_MAX = 7;

type Picks = Record<string, { folderId?: string; styleId?: string | null }>;

const errorLine = (error: unknown) =>
  (error instanceof Error ? error.message : String(error))
    .replace(/^[\s\S]*?ConvexError: /, "")
    .replace(/\n[\s\S]*$/, "")
    .slice(0, 120);

export function PromotePalette({
  frames,
  ownerUserId,
  onClose,
  onConfirm,
}: {
  frames: PromoteFrame[];
  ownerUserId?: string;
  onClose: () => void;
  onConfirm: (choice: PromoteChoice) => Promise<void>;
}) {
  const assetIds = useMemo(() => frames.map((frame) => frame.id as Id<"assets">), [frames]);
  const targets = useQuery(api.review.promoteTargets, {
    ...(ownerUserId ? { ownerUserId } : {}),
    assetIds,
  }) as PromoteProject[] | undefined;
  const [memory] = useState(readMemory);
  const [pickedSlug, setPickedSlug] = useState<string>();
  const [picks, setPicks] = useState<Picks>({});
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const filterInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const ids = useId();

  const project = useMemo(
    () => targets?.find((row) => row.slug === pickedSlug) ?? (targets?.length ? preselectProject(targets, memory) : undefined),
    [targets, pickedSlug, memory],
  );
  const place = useMemo(() => (project ? preselectPlace(project, memory) : undefined), [project, memory]);
  const filtered = useMemo(() => (project ? filterFolders(project.folders, query) : []), [project, query]);
  // Section and area headings go in front of the first folder of each group.
  const rows = useMemo(
    () =>
      filtered.map((row, index) => {
        const before = filtered[index - 1];
        const section = row.section !== before?.section ? row.section : undefined;
        const area = section || (row.area ?? "") !== (before?.area ?? "") ? row.area : undefined;
        return { row, section, area };
      }),
    [filtered],
  );
  const pick = project ? picks[project.slug] : undefined;
  const chosenFolder = pick?.folderId ?? place?.folderId;
  // Typing a filter moves the highlight onto the matches.
  const folderId = query.trim()
    ? filtered.some((row) => row.id === chosenFolder)
      ? chosenFolder
      : filtered[0]?.id
    : chosenFolder;
  const folder = project?.folders.find((row) => row.id === folderId);
  const styleId = pick && "styleId" in pick ? pick.styleId ?? null : place?.styleId ?? null;
  const style = project?.styles.find((row) => row.id === styleId);

  const setPick = (next: { folderId?: string; styleId?: string | null }) => {
    if (!project) return;
    setError("");
    setPicks((all) => ({ ...all, [project.slug]: { ...all[project.slug], ...next } }));
  };

  // Escape closes the palette before anything under it (detail view, selection).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!busy) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [busy, onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // Out of the grid while the reviews load; the filter takes it after.
    dialog.current?.focus();
    return () => previous?.focus?.();
  }, []);

  // The folder filter renders once the reviews are in: type at once.
  const loaded = Boolean(project);
  useEffect(() => {
    if (loaded) filterInput.current?.focus();
  }, [loaded]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>("[data-active]")?.scrollIntoView({ block: "nearest" });
  }, [folderId, project?.slug]);

  const submit = async () => {
    if (busy || !project) return;
    if (!folder) {
      setError("Choose a folder first.");
      filterInput.current?.focus();
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onConfirm({ project, folder, style, note });
    } catch (caught) {
      setError(errorLine(caught) || "Could not promote");
      setBusy(false);
    }
  };

  const moveFolder = (delta: number) => {
    if (!filtered.length) return;
    const index = filtered.findIndex((row) => row.id === folderId);
    const next = index < 0 ? (delta > 0 ? 0 : filtered.length - 1) : (index + delta + filtered.length) % filtered.length;
    setPick({ folderId: filtered[next]!.id });
  };

  const moveChoice = <T,>(options: T[], current: T, delta: number) => {
    const index = Math.max(0, options.indexOf(current));
    return options[(index + delta + options.length) % options.length]!;
  };

  const onDialogKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // The gallery's own keys stay out while the palette is open.
    event.stopPropagation();
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      if ((event.target as HTMLElement).closest("[data-rvp-close]")) return;
      event.preventDefault();
      void submit();
      return;
    }
    if (event.key === "Tab") {
      const nodes = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>("input, button:not(:disabled):not([tabindex='-1'])") ?? [],
      );
      if (!nodes.length) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const onFilterKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFolder(event.key === "ArrowDown" ? 1 : -1);
    }
  };

  const onStyleKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!project || (event.key !== "ArrowRight" && event.key !== "ArrowLeft")) return;
    event.preventDefault();
    const options: Array<string | null> = [null, ...project.styles.map((row) => row.id)];
    const next = moveChoice(options, styleId, event.key === "ArrowRight" ? 1 : -1);
    setPick({ styleId: next });
    dialog.current?.querySelector<HTMLElement>(`[data-style-chip="${next ?? "none"}"]`)?.focus();
  };

  const onProjectKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!targets || !project || (event.key !== "ArrowRight" && event.key !== "ArrowLeft")) return;
    event.preventDefault();
    const next = moveChoice(targets.map((row) => row.slug), project.slug, event.key === "ArrowRight" ? 1 : -1);
    setPickedSlug(next);
    dialog.current?.querySelector<HTMLElement>(`[data-project-chip="${next}"]`)?.focus();
  };

  const suggestionOf = new Map(project?.suggestions.map((row) => [row.assetId, row]) ?? []);
  const inCurrent = frames.filter((frame) => suggestionOf.get(frame.id)?.inCurrent).length;
  const inDraftOnly = frames.filter((frame) => {
    const row = suggestionOf.get(frame.id);
    return row?.inDraft && !row.inCurrent;
  }).length;
  const status = [
    framesWord(frames.length),
    inCurrent ? `${inCurrent} in ${project?.currentLabel ?? "the current round"}` : "",
    inDraftOnly ? `${inDraftOnly} in draft` : "",
  ].filter(Boolean);

  const optionId = (id: string) => `${ids}-folder-${id}`;

  return createPortal(
    <div className="rvp-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div
        ref={dialog}
        className="rvp-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}-title`}
        tabIndex={-1}
        onKeyDown={onDialogKey}
      >
        <header className="rvp-head">
          <h2 id={`${ids}-title`}>Promote to director review</h2>
          {project && (
            <span className="rvp-badge" title={project.hasDraft ? "Frames go into the draft round" : "A new draft round starts from the current one"}>
              {project.hasDraft ? "Draft " : "New draft "}
              <span className="rvp-code">{project.draftLabel}</span>
            </span>
          )}
          <button type="button" className="rvp-close" data-rvp-close onClick={onClose} disabled={busy} aria-label="Close">
            ×
          </button>
        </header>

        <div className="rvp-strip" aria-label="Frames to promote">
          {frames.slice(0, STRIP_MAX).map((frame) => {
            const row = suggestionOf.get(frame.id);
            const src = row?.thumb ?? frame.thumb;
            const mark = row?.inCurrent ? project?.currentLabel ?? "Current" : row?.inDraft ? "Draft" : undefined;
            return (
              <span key={frame.id} className="rvp-frame" data-in={mark ? "yes" : undefined}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {src ? <img src={src} alt={frame.name ?? "Frame"} /> : <span className="rvp-frame-blank" />}
                {mark && <span className="rvp-frame-mark">In <span className="rvp-code">{mark}</span></span>}
              </span>
            );
          })}
          {frames.length > STRIP_MAX && <span className="rvp-more">+{frames.length - STRIP_MAX}</span>}
          <span className="rvp-status">{status.join(" · ")}</span>
        </div>

        {targets === undefined ? (
          <div className="rvp-loading"><Loader2 size={16} className="animate-spin" aria-label="Loading reviews" /></div>
        ) : !project ? (
          <p className="rvp-empty">No director review is set up yet.</p>
        ) : (
          <>
            {targets.length > 1 ? (
              <div className="rvp-row">
                <span className="rvp-label">Project</span>
                <div className="rvp-chips" role="radiogroup" aria-label="Review project" onKeyDown={onProjectKey}>
                  {targets.map((row) => (
                    <button
                      key={row.slug}
                      type="button"
                      role="radio"
                      aria-checked={row.slug === project.slug}
                      tabIndex={row.slug === project.slug ? 0 : -1}
                      data-project-chip={row.slug}
                      className="rvp-chip"
                      onClick={() => setPickedSlug(row.slug)}
                    >
                      {row.title}
                      {row.suggestions.some((s) => s.inWorld) && <span className="rvp-dot" title="This frame's world" />}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rvp-row">
                <span className="rvp-label">Project</span>
                <span className="rvp-project">{project.title}</span>
              </div>
            )}

            <div className="rvp-row rvp-row-folder">
              <span className="rvp-label">Folder</span>
              <div className="rvp-folder">
                <input
                  ref={filterInput}
                  className="rvp-input"
                  role="combobox"
                  aria-expanded="true"
                  aria-controls={`${ids}-folders`}
                  aria-activedescendant={folderId ? optionId(folderId) : undefined}
                  aria-label="Folder"
                  placeholder={folder ? `${folder.name} · type to change` : "Type to find a folder"}
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setError(""); }}
                  onKeyDown={onFilterKey}
                  autoComplete="off"
                  spellCheck={false}
                />
                <div ref={list} id={`${ids}-folders`} className="rvp-list" role="listbox" aria-label="Folders">
                  {filtered.length === 0 && <p className="rvp-none">No folder matches “{query}”.</p>}
                  {rows.map(({ row, section, area }) => {
                    const active = row.id === folderId;
                    return (
                      <Fragment key={row.id}>
                        {section && <div className="rvp-section">{SECTION_LABEL[row.section]}</div>}
                        {area && <div className="rvp-area">{area}</div>}
                        <button
                          type="button"
                          id={optionId(row.id)}
                          role="option"
                          aria-selected={active}
                          tabIndex={-1}
                          className="rvp-option"
                          data-active={active || undefined}
                          onClick={() => { setPick({ folderId: row.id }); filterInput.current?.focus(); }}
                          onDoubleClick={() => void submit()}
                        >
                          <span>{row.name}</span>
                          {row.id === place?.suggestedFolder ? (
                            <span className="rvp-tag" data-tone="teal">Suggested</span>
                          ) : row.id === place?.lastFolder ? (
                            <span className="rvp-tag">Last</span>
                          ) : null}
                        </button>
                      </Fragment>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="rvp-row">
              <span className="rvp-label">Style</span>
              <div className="rvp-chips" role="radiogroup" aria-label="Style" onKeyDown={onStyleKey}>
                {[null, ...project.styles].map((row) => {
                  const id = row?.id ?? null;
                  const checked = id === styleId;
                  return (
                    <button
                      key={id ?? "none"}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      tabIndex={checked ? 0 : -1}
                      data-style-chip={id ?? "none"}
                      className="rvp-chip"
                      onClick={() => setPick({ styleId: id })}
                    >
                      {row ? row.label : "None"}
                      {row && row.id === place?.suggestedStyle && <span className="rvp-dot" title="Suggested" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rvp-row">
              <span className="rvp-label">Note</span>
              <input
                className="rvp-input"
                aria-label="Note for the director"
                placeholder="Optional, shown with the frame"
                value={note}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
                autoComplete="off"
              />
            </div>
          </>
        )}

        <footer className="rvp-foot">
          <span className="rvp-keys" aria-hidden>
            <span><kbd>↵</kbd>Promote</span>
            <span><kbd>↑↓</kbd>Folder</span>
            <span><kbd>⇥</kbd>Style · note</span>
            <span><kbd>Esc</kbd>Close</span>
          </span>
          {error && <span className="rvp-error" role="alert">{error}</span>}
          <button
            type="button"
            className="rvp-go"
            disabled={busy || !project}
            onClick={() => void submit()}
          >
            {busy ? "Promoting…" : folder ? `Promote → ${folder.name}${style ? ` · ${style.label}` : ""}` : "Promote"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
