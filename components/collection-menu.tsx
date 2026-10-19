"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, FolderPlus, LayoutGrid, Loader2, Pencil, Search, X } from "lucide-react";
import { collectionNameMatches } from "@/lib/collection-worlds";

export type CollectionOption = {
  id: string;
  name: string;
  count?: number;
  /**
   * Owning collection, for sub-collections. Rendered as a ghost prefix
   * ("Dear Annete / Characters") because several parents each have a child
   * called Characters or Locations — bare names made those rows identical.
   */
  parentName?: string;
  /**
   * "collection" (default) rows honor the Move/Add toggle. "storybook" rows are
   * always additive — a storybook is a narrative overlay, so moving an asset
   * into one (dropping its collections) is never what's wanted.
   */
  kind?: "collection" | "storybook";
  /** A world root, or a folder inside one: listed under Worlds, first. */
  isWorld?: boolean;
};

type CollectionMode = "move" | "copy";

interface CardCollectionButtonProps {
  imageId: string;
  currentFolderIds: string[];
  collections: CollectionOption[];
  onMove: (imageId: string, folderId: string) => Promise<void> | void;
  onCopy: (imageId: string, folderId: string) => Promise<void> | void;
  onRemove?: (imageId: string, folderId: string) => Promise<void> | void;
  onCreate?: (name: string) => Promise<string | null>;
  /** Rename a collection in place, so a wrong name is fixable where it's seen. */
  onRename?: (folderId: string, name: string) => Promise<void> | void;
  /** Hands the asset to the moodboard picker, anchored where this menu was. */
  onAddToMoodboard?: (imageId: string, anchor: DOMRect | null) => void;
  /** Positioning classes from the host card (absolute offsets). */
  positionClassName: string;
}

const MENU_WIDTH = 300;
const MENU_MAX_HEIGHT = 460;
const HOVER_OPEN_DELAY_MS = 150;
const HOVER_CLOSE_DELAY_MS = 280;

/**
 * Per-card "organize into collection" control for the gallery grid: a button
 * that opens a floating menu (portaled to <body> — the card clips overflow)
 * on hover or click, with a Move/Add mode toggle, the collection list
 * (member rows toggle off = remove), and an inline "new collection" flow.
 */
export function CardCollectionButton({
  imageId,
  currentFolderIds,
  collections,
  onMove,
  onCopy,
  onRemove,
  onCreate,
  onRename,
  onAddToMoodboard,
  positionClassName,
}: CardCollectionButtonProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number }>({
    left: 0,
    top: 0,
  });
  // Default to Add: an asset can live in many collections, so a plain click
  // should ADD (keep existing memberships), not relocate. Move is opt-in.
  const [mode, setMode] = useState<CollectionMode>("copy");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [createError, setCreateError] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [query, setQuery] = useState("");

  const hoverOpenTimerRef = useRef<number | null>(null);
  const hoverCloseTimerRef = useRef<number | null>(null);
  // Mirror of busy/creating for the close timer: never hover-close while an
  // action is in flight or the user is typing a new collection name.
  const stayOpenRef = useRef(false);
  stayOpenRef.current =
    busy || creating || renamingId !== null || query.length > 0;

  const close = useCallback(() => {
    setOpen(false);
    setCreating(false);
    setDraftName("");
    setCreateError(false);
    setRenamingId(null);
    setQuery("");
  }, []);

  // Commit a rename. A blank or unchanged name just exits edit mode.
  const commitRename = useCallback(
    async (collection: CollectionOption) => {
      const next = renameDraft.trim();
      setRenamingId(null);
      if (!next || next === collection.name || !onRename) return;
      await onRename(collection.id, next);
    },
    [onRename, renameDraft],
  );

  const cancelHoverOpen = useCallback(() => {
    if (hoverOpenTimerRef.current !== null) {
      window.clearTimeout(hoverOpenTimerRef.current);
      hoverOpenTimerRef.current = null;
    }
  }, []);

  const cancelHoverClose = useCallback(() => {
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  }, []);

  const scheduleHoverClose = useCallback(() => {
    cancelHoverClose();
    hoverCloseTimerRef.current = window.setTimeout(() => {
      hoverCloseTimerRef.current = null;
      if (stayOpenRef.current) return;
      close();
    }, HOVER_CLOSE_DELAY_MS);
  }, [cancelHoverClose, close]);

  useEffect(
    () => () => {
      cancelHoverOpen();
      cancelHoverClose();
    },
    [cancelHoverOpen, cancelHoverClose],
  );

  const openMenu = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const left = Math.min(
      Math.max(8, rect.left),
      Math.max(8, viewportWidth - MENU_WIDTH - 8),
    );
    const below = rect.bottom + 6;
    const top =
      below + MENU_MAX_HEIGHT > viewportHeight - 8
        ? Math.max(8, rect.top - 6 - MENU_MAX_HEIGHT)
        : below;
    setMenuPos({ left, top });
    // Always reopen in Add mode (the multi-collection default) — a sticky Move
    // mode from a previous open would silently relocate on the next click.
    setMode("copy");
    setOpen(true);
  }, []);

  // Close on outside click, Escape, or scroll (the anchor position goes
  // stale as soon as the grid scrolls).
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const handleScroll = (event: Event) => {
      // The menu's own list is scrollable — the capture-phase listener sees
      // that too, and closing on it made long lists unscrollable. Only close
      // when something OUTSIDE the menu scrolls (stale anchor position).
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("mousedown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open, close]);

  const currentSet = new Set(currentFolderIds);

  // Member rows toggle OFF (remove); other rows apply the current mode, except
  // storybook rows which always ADD (moving into a storybook would strip an
  // asset's collections). The menu stays open after add/remove so several
  // targets can be managed in one visit — only a move closes it (the card may
  // leave the current view).
  const runAction = useCallback(
    async (option: CollectionOption, isMember: boolean) => {
      if (busy) return;
      setBusy(true);
      try {
        if (isMember && onRemove) {
          await onRemove(imageId, option.id);
        } else if (mode === "move" && option.kind !== "storybook") {
          await onMove(imageId, option.id);
          close();
        } else {
          await onCopy(imageId, option.id);
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, mode, imageId, onMove, onCopy, onRemove, close],
  );

  const submitCreate = useCallback(async () => {
    const name = draftName.trim();
    if (!name || !onCreate || busy) return;
    setBusy(true);
    setCreateError(false);
    try {
      const folderId = await onCreate(name);
      if (!folderId) {
        setCreateError(true);
        return;
      }
      if (mode === "move") {
        await onMove(imageId, folderId);
      } else {
        await onCopy(imageId, folderId);
      }
      close();
    } finally {
      setBusy(false);
    }
  }, [draftName, onCreate, busy, mode, imageId, onMove, onCopy, close]);

  const stop = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };

  // A search keeps a root when it or one of its folders matches; a folder
  // shows when it matches or its root does.
  const searching = query.trim().length > 0;
  const visible = searching
    ? collections.filter((c) => {
        if (collectionNameMatches(c.name, query)) return true;
        if (c.parentName && collectionNameMatches(c.parentName, query)) return true;
        return (
          !c.parentName &&
          collections.some(
            (child) =>
              child.parentName === c.name &&
              collectionNameMatches(child.name, query),
          )
        );
      })
    : collections;
  const plainRows = visible.filter((c) => c.kind !== "storybook");
  const worldRows = plainRows.filter((c) => c.isWorld);
  const collectionRows = plainRows.filter((c) => !c.isWorld);
  const storybookRows = visible.filter((c) => c.kind === "storybook");

  const renderRow = (collection: CollectionOption) => {
    const isMember = currentSet.has(collection.id);
    const removable = isMember && Boolean(onRemove);
    // Sub-collections share names across parents, so every label the user
    // reads (and every tooltip) carries the owning collection.
    const fullName = collection.parentName
      ? `${collection.parentName} / ${collection.name}`
      : collection.name;
    const addLabel =
      collection.kind === "storybook"
        ? `Add to ${fullName}`
        : mode === "move"
          ? `Move to ${fullName}`
          : `Add to ${fullName}`;

    // Renaming takes over the row — the destination is irrelevant mid-edit.
    if (renamingId === collection.id) {
      return (
        <div key={collection.id} className="px-3 py-1.5">
          <input
            autoFocus
            value={renameDraft}
            onClick={stop}
            onChange={(event) => setRenameDraft(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                void commitRename(collection);
              } else if (event.key === "Escape") {
                event.preventDefault();
                setRenamingId(null);
              }
            }}
            onBlur={() => void commitRename(collection)}
            aria-label={`Rename ${fullName}`}
            className="w-full bg-transparent outline-none"
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--lm-text-primary)",
              borderBottom: "1px solid var(--lm-coral)",
              caretColor: "var(--lm-coral)",
              paddingBottom: "2px",
            }}
          />
        </div>
      );
    }

    return (
      <div key={collection.id} className="group/row flex w-full items-center">
      <button
        type="button"
        role="menuitem"
        disabled={busy}
        onClick={(event) => {
          stop(event);
          void runAction(collection, removable);
        }}
        className="flex min-w-0 flex-1 items-center justify-between gap-2 py-1.5 pr-3 text-left transition-opacity hover:opacity-75 disabled:cursor-wait"
        style={{
          paddingLeft: collection.parentName ? "26px" : "12px",
          fontSize: collection.parentName ? "12px" : "11px",
          fontWeight: collection.parentName ? 500 : 700,
          textTransform: collection.parentName ? undefined : "uppercase",
          letterSpacing: collection.parentName ? undefined : "0.06em",
          color: collection.parentName
            ? "var(--lm-text-secondary)"
            : "var(--lm-text-primary)",
          backgroundColor: "transparent",
        }}
        title={removable ? `Remove from ${fullName}` : addLabel}
      >
        <span className="line-clamp-2 break-words">
          {/* Nested under its root already; the prefix only returns when a
              search may have hidden that root. */}
          {collection.parentName && searching && (
            <span style={{ color: "var(--lm-text-ghost)", fontWeight: 500 }}>
              {collection.parentName}
              {" / "}
            </span>
          )}
          {collection.name}
        </span>
        {isMember ? (
          removable ? (
            <span className="relative h-3.5 w-3.5 shrink-0">
              <Check
                className="absolute inset-0 h-3.5 w-3.5 transition-opacity group-hover/row:opacity-0"
                style={{ color: "var(--lm-coral)" }}
              />
              <X
                className="absolute inset-0 h-3.5 w-3.5 opacity-0 transition-opacity group-hover/row:opacity-100"
                style={{ color: "var(--lm-text-primary)" }}
              />
            </span>
          ) : (
            <Check
              className="h-3.5 w-3.5 shrink-0"
              style={{ color: "var(--lm-coral)" }}
            />
          )
        ) : (
          <span
            className="shrink-0 text-[10px]"
            style={{ color: "var(--lm-text-tertiary)" }}
          >
            {collection.count ?? ""}
          </span>
        )}
      </button>
        {/* Rename in place — storybooks are renamed from their own modal. */}
        {onRename && collection.kind !== "storybook" && (
          <button
            type="button"
            aria-label={`Rename ${fullName}`}
            title={`Rename ${fullName}`}
            disabled={busy}
            onClick={(event) => {
              stop(event);
              setRenameDraft(collection.name);
              setRenamingId(collection.id);
            }}
            className="mr-2 flex h-5 w-5 shrink-0 items-center justify-center opacity-0 transition-opacity group-hover/row:opacity-100"
            style={{ color: "var(--lm-text-tertiary)" }}
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  };

  const modePill = (value: CollectionMode, label: string) => (
    <button
      type="button"
      onClick={(event) => {
        stop(event);
        setMode(value);
      }}
      className="px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider transition-colors"
      style={{
        borderRadius: "8px",
        backgroundColor: mode === value ? "var(--lm-coral)" : "transparent",
        color: mode === value ? "#000" : "var(--lm-text-secondary)",
        border:
          mode === value
            ? "1px solid var(--lm-coral)"
            : "1px solid var(--lm-border-strong)",
      }}
      aria-pressed={mode === value}
    >
      {label}
    </button>
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(event) => {
          event.preventDefault();
          stop(event);
          cancelHoverOpen();
          if (open) close();
          else openMenu();
        }}
        onMouseEnter={() => {
          cancelHoverClose();
          if (open || hoverOpenTimerRef.current !== null) return;
          hoverOpenTimerRef.current = window.setTimeout(() => {
            hoverOpenTimerRef.current = null;
            openMenu();
          }, HOVER_OPEN_DELAY_MS);
        }}
        onMouseLeave={() => {
          cancelHoverOpen();
          scheduleHoverClose();
        }}
        className={`${positionClassName} card-icon-btn flex h-8 w-8 items-center justify-center rounded-lg border ${
          open
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        }`}
        data-active={open ? "dark" : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add to collection"
        title="Add to, move to, or remove from a collection"
      >
        <FolderPlus className="h-3.5 w-3.5" />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Collections"
            onClick={stop}
            onMouseDown={stop}
            onMouseEnter={cancelHoverClose}
            onMouseLeave={scheduleHoverClose}
            className="fixed flex flex-col"
            style={{
              left: menuPos.left,
              top: menuPos.top,
              width: `${MENU_WIDTH}px`,
              maxHeight: `${MENU_MAX_HEIGHT}px`,
              zIndex: 80,
              backgroundColor: "var(--lm-surface-1)",
              border: "2px solid var(--lm-ink)",
              borderRadius: "12px",
              boxShadow: "var(--shadow-lg)",
              fontFamily: "var(--lm-font)",
              overflow: "hidden",
            }}
          >
            <div
              className="flex items-center justify-between gap-2 px-3 pb-2 pt-2.5"
              style={{ borderBottom: "1px solid var(--lm-border-strong)" }}
            >
              <span
                className="text-[9px] font-mono font-bold uppercase tracking-[0.14em]"
                style={{ color: "var(--lm-text-tertiary)" }}
              >
                {searching ? `${plainRows.length + storybookRows.length} found` : "Collection"}
              </span>
              <div className="flex items-center gap-1">
                {modePill("move", "Move")}
                {modePill("copy", "Add")}
              </div>
            </div>

            {collections.length > 8 && (
              <label
                className="mx-2 mt-2 flex items-center gap-2 px-2"
                style={{
                  height: "28px",
                  border: "1px solid var(--lm-border-strong)",
                  borderRadius: "8px",
                  backgroundColor: "var(--lm-surface-0)",
                }}
              >
                <Search
                  className="h-3 w-3 shrink-0"
                  style={{ color: "var(--lm-text-tertiary)" }}
                />
                <input
                  value={query}
                  onClick={stop}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Escape") setQuery("");
                  }}
                  placeholder="Find a world or collection"
                  aria-label="Find a world or collection"
                  className="min-w-0 flex-1 bg-transparent text-[12px] outline-none"
                  style={{ color: "var(--lm-text-primary)" }}
                />
              </label>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {collections.length === 0 && (
                <p
                  className="px-3 py-2 text-[11px]"
                  style={{ color: "var(--lm-text-tertiary)" }}
                >
                  No collections yet.
                </p>
              )}
              {searching && visible.length === 0 && (
                <p
                  className="px-3 py-2 text-[11px]"
                  style={{ color: "var(--lm-text-tertiary)" }}
                >
                  Nothing called &ldquo;{query.trim()}&rdquo;.
                </p>
              )}
              {worldRows.length > 0 && (
                <div
                  className="px-3 pb-1 pt-2 text-[9px] font-mono font-bold uppercase tracking-[0.14em]"
                  style={{ color: "var(--lm-text-tertiary)" }}
                >
                  Worlds
                </div>
              )}
              {worldRows.map(renderRow)}
              {collectionRows.length > 0 && (
                <div
                  className="px-3 pb-1 pt-2 text-[9px] font-mono font-bold uppercase tracking-[0.14em]"
                  style={{
                    color: "var(--lm-text-tertiary)",
                    borderTop:
                      worldRows.length > 0
                        ? "1px solid var(--lm-border-strong)"
                        : undefined,
                    marginTop: worldRows.length > 0 ? "4px" : undefined,
                  }}
                >
                  Collections
                </div>
              )}
              {collectionRows.map(renderRow)}

              {storybookRows.length > 0 && (
                <>
                  <div
                    className="mt-1 px-3 pb-1 pt-2 text-[9px] font-mono font-bold uppercase tracking-[0.14em]"
                    style={{
                      color: "var(--lm-text-tertiary)",
                      borderTop: "1px solid var(--lm-border-strong)",
                    }}
                  >
                    Storybooks
                  </div>
                  {storybookRows.map(renderRow)}
                </>
              )}

            </div>

            {onAddToMoodboard && (
              <button
                type="button"
                role="menuitem"
                onClick={(event) => {
                  stop(event);
                  const anchor = buttonRef.current?.getBoundingClientRect() ?? null;
                  close();
                  onAddToMoodboard(imageId, anchor);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-75"
                style={{
                  color: "var(--lm-text-primary)",
                  borderTop: "1px solid var(--lm-border-strong)",
                }}
                title="Add this image to a moodboard"
              >
                <LayoutGrid
                  className="h-3.5 w-3.5 shrink-0"
                  style={{ color: "var(--lm-coral)" }}
                />
                Add to moodboard…
              </button>
            )}

            {onCreate && (
              <div style={{ borderTop: "1px solid var(--lm-border-strong)" }}>
                {creating ? (
                  <div className="flex items-center gap-1.5 p-2">
                    <input
                      autoFocus
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Enter") void submitCreate();
                      }}
                      placeholder={
                        createError ? "Failed — try again" : "Collection name"
                      }
                      className="min-w-0 flex-1 px-2 py-1.5 text-[12px] outline-none"
                      style={{
                        backgroundColor: "var(--lm-surface-0)",
                        border: "1px solid var(--lm-border-strong)",
                        borderRadius: "8px",
                        color: "var(--lm-text-primary)",
                      }}
                    />
                    <button
                      type="button"
                      disabled={busy || !draftName.trim()}
                      onClick={(event) => {
                        stop(event);
                        void submitCreate();
                      }}
                      className="px-2.5 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider disabled:opacity-50"
                      style={{
                        borderRadius: "8px",
                        backgroundColor: "var(--lm-coral)",
                        color: "#000",
                      }}
                    >
                      {busy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : mode === "move" ? (
                        "Move"
                      ) : (
                        "Add"
                      )}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={(event) => {
                      stop(event);
                      setCreating(true);
                    }}
                    className="w-full px-3 py-2 text-left text-[11px] font-mono font-bold uppercase tracking-wider transition-opacity hover:opacity-75"
                    style={{ color: "var(--lm-coral)" }}
                  >
                    + New collection
                  </button>
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
