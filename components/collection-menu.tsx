"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, FolderPlus, Loader2 } from "lucide-react";

export type CollectionOption = {
  id: string;
  name: string;
  count?: number;
};

type CollectionMode = "move" | "copy";

interface CardCollectionButtonProps {
  imageId: string;
  currentFolderIds: string[];
  collections: CollectionOption[];
  onMove: (imageId: string, folderId: string) => Promise<void> | void;
  onCopy: (imageId: string, folderId: string) => Promise<void> | void;
  onCreate?: (name: string) => Promise<string | null>;
  /** Positioning classes from the host card (absolute offsets). */
  positionClassName: string;
}

const MENU_WIDTH = 248;
const MENU_MAX_HEIGHT = 372;

/**
 * Per-card "organize into collection" control for the gallery grid: a hover
 * button that opens a floating menu (portaled to <body> — the card clips
 * overflow) with a Move/Copy mode toggle, the collection list, and an inline
 * "new collection" flow.
 */
export function CardCollectionButton({
  imageId,
  currentFolderIds,
  collections,
  onMove,
  onCopy,
  onCreate,
  positionClassName,
}: CardCollectionButtonProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number }>({
    left: 0,
    top: 0,
  });
  const [mode, setMode] = useState<CollectionMode>("move");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [createError, setCreateError] = useState(false);

  const close = useCallback(() => {
    setOpen(false);
    setCreating(false);
    setDraftName("");
    setCreateError(false);
  }, []);

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
    // Always reopen in Move mode — a sticky Copy mode from a previous open
    // silently turns "move" clicks into copies.
    setMode("move");
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
    const handleScroll = () => close();
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

  const runAction = useCallback(
    async (folderId: string) => {
      if (busy) return;
      setBusy(true);
      try {
        if (mode === "move") {
          await onMove(imageId, folderId);
        } else {
          await onCopy(imageId, folderId);
        }
        close();
      } finally {
        setBusy(false);
      }
    },
    [busy, mode, imageId, onMove, onCopy, close],
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
          if (open) close();
          else openMenu();
        }}
        className={`${positionClassName} flex h-8 w-8 items-center justify-center border transition-all duration-[var(--duration-fast)] ${
          open
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        }`}
        style={{
          borderRadius: "8px",
          backgroundColor: open
            ? "var(--lm-coral)"
            : "var(--image-card-badge-bg)",
          color: open ? "#000" : "var(--image-card-badge-text)",
          borderColor: open
            ? "var(--lm-coral)"
            : "var(--image-card-badge-border)",
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add to collection"
        title="Move or copy to a collection"
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
                Collection
              </span>
              <div className="flex items-center gap-1">
                {modePill("move", "Move")}
                {modePill("copy", "Copy")}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {collections.length === 0 && (
                <p
                  className="px-3 py-2 text-[11px]"
                  style={{ color: "var(--lm-text-tertiary)" }}
                >
                  No collections yet.
                </p>
              )}
              {collections.map((collection) => {
                const isMember = currentSet.has(collection.id);
                return (
                  <button
                    key={collection.id}
                    type="button"
                    role="menuitem"
                    disabled={busy}
                    onClick={(event) => {
                      stop(event);
                      void runAction(collection.id);
                    }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-opacity hover:opacity-75 disabled:cursor-wait"
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "var(--lm-text-primary)",
                      backgroundColor: "transparent",
                    }}
                  >
                    <span className="truncate">{collection.name}</span>
                    {isMember ? (
                      <Check
                        className="h-3.5 w-3.5 shrink-0"
                        style={{ color: "var(--lm-coral)" }}
                      />
                    ) : (
                      <span
                        className="shrink-0 text-[10px]"
                        style={{ color: "var(--lm-text-tertiary)" }}
                      >
                        {collection.count ?? ""}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

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
                        "Copy"
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
