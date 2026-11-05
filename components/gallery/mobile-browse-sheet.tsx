"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, FolderOpen, Orbit, Search, X } from "lucide-react";
import { collectionGroupKey, normalizeCollectionGroup } from "@/lib/collection-groups";
import { browseHitCount, buildBrowseTree, filterBrowseSections, type BrowseFolder, type BrowseSection } from "@/lib/mobile-browse";

/**
 * The phone's way into the vault. The sidebar does not exist under 768 px, so
 * the Search tab opens this sheet: a search box with the keyboard up, the
 * Worlds › Shelves tree, then the sections (Storybooks, Stories, Moodboards,
 * Skills, YouTube, Motion, Cinematography, Tasks, Decisions). Every row is a
 * finger-sized target; a tap goes there and closes the sheet.
 */
export type BrowseSheetSection = BrowseSection & { icon: React.ElementType; onOpen?: () => void };

export function MobileBrowseSheet<T extends BrowseFolder>({
  open,
  onClose,
  folders,
  selectedFolderId,
  onFolderSelect,
  sections,
  onSearchPieces,
  inboxCountByWorld,
}: {
  open: boolean;
  onClose: () => void;
  folders: readonly T[];
  selectedFolderId: string | null;
  onFolderSelect: (folderId: string | null) => void;
  sections: readonly BrowseSheetSection[];
  /** Runs the vault search (the desktop dock's box) with the typed text. */
  onSearchPieces?: (query: string) => void;
  inboxCountByWorld?: ReadonlyMap<string, number>;
}) {
  const [query, setQuery] = useState("");
  const [openRoots, setOpenRoots] = useState<Set<string>>(() => new Set());

  // Each opening starts clean: an empty box and the tree folded to the place
  // the viewer is in. Done when `open` flips, before the sheet paints.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      const selected = folders.find((folder) => folder._id === selectedFolderId);
      const rootId = selected?.parentFolderId ?? selected?._id;
      setOpenRoots(new Set(rootId ? [rootId] : []));
    }
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  const tree = useMemo(() => buildBrowseTree(folders, query), [folders, query]);
  const visibleSections = useMemo(() => filterBrowseSections(sections, query), [sections, query]);
  const searching = query.trim().length > 0;
  const hits = browseHitCount(tree, visibleSections);

  if (!open) return null;

  const go = (folderId: string | null) => {
    onFolderSelect(folderId);
    onClose();
  };
  const toggleRoot = (id: string) =>
    setOpenRoots((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderRoot = (root: (typeof tree.worlds)[number], world: boolean) => {
    const { folder, children, forcedOpen } = root;
    const expanded = forcedOpen || openRoots.has(folder._id);
    const active = selectedFolderId === folder._id;
    const inbox = inboxCountByWorld?.get(folder._id) ?? 0;
    return (
      <li key={folder._id}>
        <div className="flex items-stretch" style={{ minHeight: 48 }}>
          <button
            type="button"
            onClick={() => go(folder._id)}
            aria-current={active ? "page" : undefined}
            className="flex min-w-0 flex-1 items-center gap-3 px-4 text-left"
            style={{ color: active ? "var(--lm-coral)" : "var(--lm-text-primary)" }}
          >
            {world ? <Orbit className="h-4 w-4 shrink-0" style={{ color: active ? "var(--lm-coral)" : "var(--lm-text-ghost)" }} aria-hidden /> : <FolderOpen className="h-4 w-4 shrink-0" style={{ color: active ? "var(--lm-coral)" : "var(--lm-text-ghost)" }} aria-hidden />}
            <span className="truncate" style={rowLabel}>{folder.name}</span>
            {inbox > 0 && (
              <span aria-label={`${inbox} decisions waiting`} className="shrink-0 px-1.5 py-[2px] text-[9px] font-bold leading-none tabular-nums" style={{ borderRadius: "var(--lm-radius)", background: "var(--lm-coral)", color: "var(--lm-paper)" }}>
                {inbox}
              </span>
            )}
            {typeof folder.count === "number" && <span className="ml-auto shrink-0 pl-3 tabular-nums" style={rowCount}>{folder.count}</span>}
          </button>
          {children.length > 0 && (
            <button
              type="button"
              onClick={() => toggleRoot(folder._id)}
              aria-expanded={expanded}
              aria-label={expanded ? `Hide the shelves of ${folder.name}` : `Show the shelves of ${folder.name}`}
              className="flex w-12 shrink-0 items-center justify-center"
              style={{ color: "var(--lm-text-ghost)" }}
            >
              {expanded ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
            </button>
          )}
        </div>
        {expanded && children.length > 0 && (
          <ul className="relative mb-1" style={{ paddingLeft: 0 }}>
            <span aria-hidden className="absolute" style={{ left: 23, top: 4, bottom: 8, width: 1, background: "var(--lm-border)" }} />
            {children.map((child, index) => {
              const groupKey = collectionGroupKey(child.group);
              const previousKey = collectionGroupKey(children[index - 1]?.group);
              const groupLabel = groupKey && groupKey !== previousKey ? normalizeCollectionGroup(child.group) : !groupKey && previousKey ? "Other" : undefined;
              const childActive = selectedFolderId === child._id;
              return (
                <li key={child._id}>
                  {groupLabel && <div aria-hidden className="truncate" style={{ padding: "10px 16px 2px 44px", ...groupLabelStyle }}>{groupLabel}</div>}
                  <button
                    type="button"
                    onClick={() => go(child._id)}
                    aria-current={childActive ? "page" : undefined}
                    className="flex w-full items-center gap-3 py-0 pr-4 text-left"
                    style={{ minHeight: 44, paddingLeft: 44, color: childActive ? "var(--lm-coral)" : "var(--lm-text-secondary)" }}
                  >
                    <span className="truncate" style={{ ...rowLabel, fontWeight: childActive ? 800 : 600 }}>{child.name}</span>
                    {typeof child.count === "number" && <span className="ml-auto shrink-0 pl-3 tabular-nums" style={rowCount}>{child.count}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="fixed inset-0 z-70 md:hidden" role="dialog" aria-modal="true" aria-label="Browse the vault">
      <div className="absolute inset-0 backdrop-blur-sm animate-fade-in" style={{ backgroundColor: "var(--lm-scrim)" }} onClick={onClose} aria-hidden="true" />
      <div
        className="absolute inset-x-0 bottom-0 flex flex-col rounded-t-3xl border-t animate-sheet-slide-up"
        style={{
          maxHeight: "88dvh",
          background: "linear-gradient(180deg, var(--paper-muted) 0%, var(--paper) 100%)",
          borderColor: "var(--border-subtle)",
          paddingBottom: "env(safe-area-inset-bottom)",
          fontFamily: "var(--lm-font)",
        }}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full" style={{ backgroundColor: "var(--border-strong)" }} />
        </div>

        {/* The search box: focused on open, so the keyboard is already up. */}
        <div className="flex items-center gap-2 px-4 pb-3 pt-2">
          <label
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-full px-4"
            style={{ height: 48, border: "2px solid var(--lm-border-strong)", background: "var(--lm-surface-1)" }}
          >
            <Search className="h-4 w-4 shrink-0" style={{ color: "var(--lm-text-ghost)" }} aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && searching && onSearchPieces) {
                  onSearchPieces(query.trim());
                  onClose();
                }
              }}
              placeholder="Find a world, shelf, section or piece"
              aria-label="Find a world, shelf, section or piece"
              enterKeyHint="search"
              className="min-w-0 flex-1 bg-transparent outline-none"
              style={{ fontSize: 16, color: "var(--lm-text-primary)", caretColor: "var(--lm-coral)" }}
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear" className="flex h-8 w-8 items-center justify-center" style={{ color: "var(--lm-text-ghost)" }}>
                <X className="h-4 w-4" />
              </button>
            )}
          </label>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full" style={{ color: "var(--lm-text-tertiary)" }}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
          {searching && onSearchPieces && (
            <button
              type="button"
              onClick={() => {
                onSearchPieces(query.trim());
                onClose();
              }}
              className="mx-4 mb-2 flex w-[calc(100%-32px)] items-center gap-3 rounded-2xl px-4 text-left"
              style={{ minHeight: 48, background: "var(--lm-ink)", color: "var(--lm-paper)" }}
            >
              <Search className="h-4 w-4 shrink-0" aria-hidden />
              <span style={{ ...rowLabel, fontWeight: 800 }}>Search pieces for “{query.trim()}”</span>
              <ChevronRight className="ml-auto h-4 w-4 shrink-0 opacity-60" aria-hidden />
            </button>
          )}

          {!searching && (
            <button
              type="button"
              onClick={() => go(null)}
              aria-current={selectedFolderId === null ? "page" : undefined}
              className="flex w-full items-center gap-3 px-4 text-left"
              style={{ minHeight: 48, color: selectedFolderId === null ? "var(--lm-coral)" : "var(--lm-text-primary)" }}
            >
              <FolderOpen className="h-4 w-4 shrink-0" style={{ color: selectedFolderId === null ? "var(--lm-coral)" : "var(--lm-text-ghost)" }} aria-hidden />
              <span style={rowLabel}>Everything</span>
            </button>
          )}

          {tree.worlds.length > 0 && <SectionLabel icon={Orbit} label="Worlds" count={tree.worlds.length} />}
          <ul>{tree.worlds.map((root) => renderRoot(root, true))}</ul>
          {tree.collections.length > 0 && <SectionLabel icon={FolderOpen} label="Collections" count={tree.collections.length} />}
          <ul>{tree.collections.map((root) => renderRoot(root, false))}</ul>

          {visibleSections.length > 0 && <SectionLabel label="Sections" count={visibleSections.length} />}
          <ul>
            {visibleSections.map((section) => {
              const Icon = section.icon;
              const inner = (
                <>
                  <Icon className="h-4 w-4 shrink-0" style={{ color: section.active ? "var(--lm-coral)" : "var(--lm-text-ghost)" }} aria-hidden />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate" style={{ ...rowLabel, color: section.active ? "var(--lm-coral)" : "var(--lm-text-primary)" }}>{section.label}</span>
                    <span className="truncate" style={{ fontSize: 11, color: "var(--lm-text-tertiary)" }}>{section.hint}</span>
                  </span>
                  {section.badge !== undefined && section.badge > 0 && (
                    <span aria-label={`${section.badge} waiting`} className="shrink-0 px-1.5 py-[2px] text-[9px] font-bold leading-none tabular-nums" style={{ borderRadius: "var(--lm-radius)", background: "var(--lm-coral)", color: "var(--lm-paper)" }}>
                      {section.badge}
                    </span>
                  )}
                  <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--lm-text-ghost)" }} aria-hidden />
                </>
              );
              const className = "flex w-full items-center gap-3 px-4 text-left";
              const style = { minHeight: 56 };
              return (
                <li key={section.key}>
                  {section.href ? (
                    <Link href={section.href} className={className} style={style} onClick={onClose}>{inner}</Link>
                  ) : (
                    <button type="button" className={className} style={style} onClick={() => { section.onOpen?.(); onClose(); }}>{inner}</button>
                  )}
                </li>
              );
            })}
          </ul>

          {searching && hits === 0 && (
            <p className="px-4 py-6" style={{ fontSize: 12, color: "var(--lm-text-tertiary)" }}>
              Nothing called “{query.trim()}”.{onSearchPieces ? " Press search to look through the pieces." : ""}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const rowLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const rowCount: React.CSSProperties = {
  fontFamily: "var(--lm-font-mono, ui-monospace, monospace)",
  fontSize: 10,
  fontWeight: 600,
  color: "var(--lm-text-ghost)",
};

const groupLabelStyle: React.CSSProperties = {
  fontSize: 8.5,
  fontWeight: 800,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "var(--lm-text-ghost)",
};

function SectionLabel({ icon: Icon, label, count }: { icon?: React.ElementType; label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-4 pb-1 pt-4" aria-hidden>
      {Icon && <Icon className="h-3 w-3" style={{ color: "var(--lm-text-ghost)" }} />}
      <span style={{ ...groupLabelStyle, fontSize: 9 }}>{label}</span>
      <span style={{ ...rowCount, fontSize: 9 }}>{count}</span>
    </div>
  );
}
