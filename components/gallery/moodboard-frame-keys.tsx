"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useMutation } from "convex/react";
import { Undo2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// D on a moodboard frame takes that image off that board; Z (or Undo on the
// toast) puts it back at the same place. The asset itself is never touched:
// it stays in the gallery and on every other board. Michael, 9 Nov 2026.
//
// One engine for every surface that shows a board's images: the gallery's
// board view and board cards (components/gallery/moodboards-view.tsx), the
// expanded view opened from a board (dashboard), and the project page's
// moodboard studio and its expanded view. A surface only tags its frames:
//
//   data-mb-board="<moodboard id>"   on the frame or any ancestor
//   data-mb-name / data-mb-mj="1"    next to data-mb-board (name, mirrored to Midjourney)
//   data-mb-asset="<asset id>"       on the frame
//   data-mb-open                     on an expanded view of one board frame
//
// The engine finds the open frame (else the hovered one, else the focused
// one), flashes it, then removes it. While a board surface is on screen the
// gallery's own D (archive) stands aside: lib/asset-hotkeys.ts is for the
// vault grid, this is for boards.

const LEAVE_MS = 420;
const TOAST_MS = 6500;
const UNDO_DEPTH = 20;

type Removal = {
  boardId: string;
  boardName: string;
  mirrored: boolean;
  items: { assetId: Id<"assets">; index: number; addedAt: number; note?: string }[];
  previousCoverAssetId?: Id<"assets">;
};

/* ── Which board surfaces are on screen (for the key hints) ─────────────── */

let surfaces = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Call in a component that shows a board's frames while it is mounted. */
export function useMoodboardSurface(active = true) {
  useEffect(() => {
    if (!active) return;
    surfaces += 1;
    emit();
    return () => {
      surfaces -= 1;
      emit();
    };
  }, [active]);
}

/** True while any board surface is on screen: D means "off this board". */
export function useMoodboardKeysActive() {
  return useSyncExternalStore(subscribe, () => surfaces > 0, () => false);
}

/** For non-React key handlers (the vault's D) to stand aside. */
export const moodboardKeysActive = () => surfaces > 0;

/** The key hints a board surface pins at the bottom. */
export const MOODBOARD_KEYS = [
  { key: "D", label: "Off board", title: "D: take the hovered or open image off this board (the asset stays in the gallery)" },
  { key: "Z", label: "Undo", title: "Z: put the last image back where it was" },
] as const;

/**
 * The board keys as a strip pinned at the bottom: in the expanded view of a
 * board image and in the moodboard studio. `extra` adds that view's own keys.
 */
export function MoodboardKeyHint({ extra = [], className }: { extra?: readonly { key: string; label: string }[]; className?: string }) {
  return (
    <div className={`mbk-hint${className ? ` ${className}` : ""}`} aria-label="Moodboard keys">
      {[...MOODBOARD_KEYS, ...extra].map(({ key, label }) => (
        <span key={key}><kbd>{key}</kbd>{label}</span>
      ))}
    </div>
  );
}

/* ── Target lookup ──────────────────────────────────────────────────────── */

const typing = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  return Boolean(element?.isContentEditable || element?.closest?.("input, textarea, select, [role=textbox]"));
};

const visible = (node: Element) => node.getClientRects().length > 0;

type Frame = { element: HTMLElement; boardId: string; boardName: string; mirrored: boolean; assetId: string };

const frameOf = (element: HTMLElement | null | undefined): Frame | null => {
  const tile = element?.closest<HTMLElement>("[data-mb-asset]");
  const board = tile?.closest<HTMLElement>("[data-mb-board]");
  if (!tile || !board?.dataset.mbBoard || !tile.dataset.mbAsset) return null;
  return {
    element: tile,
    boardId: board.dataset.mbBoard,
    boardName: board.dataset.mbName || "the board",
    mirrored: board.dataset.mbMj === "1",
    assetId: tile.dataset.mbAsset,
  };
};

const tilesFor = (boardId: string, assetId: string) =>
  Array.from(document.querySelectorAll<HTMLElement>(`[data-mb-asset="${CSS.escape(assetId)}"]`)).filter(
    (tile) => tile.closest<HTMLElement>("[data-mb-board]")?.dataset.mbBoard === boardId,
  );

/* ── The engine ─────────────────────────────────────────────────────────── */

export function MoodboardFrameKeys({ ownerUserId, session, onOpenRemoved }: {
  ownerUserId: string;
  /** Journal session for the changes (world_undo reverts them too). */
  session: string;
  /** The open expanded view's frame left its board (close it, or step on). */
  onOpenRemoved?: () => void;
}) {
  const remove = useMutation(api.moodboards.removeMoodboardItems).withOptimisticUpdate((store, args) => {
    const gone = new Set<string>(args.assetIds);
    const now = Date.now();
    for (const query of store.getAllQueries(api.moodboards.getMoodboard)) {
      if (!query.value || query.args.moodboardId !== args.moodboardId) continue;
      const items = query.value.items.filter((item) => !gone.has(item.assetId));
      store.setQuery(api.moodboards.getMoodboard, query.args, {
        ...query.value,
        items,
        moodboard: { ...query.value.moodboard, itemCount: Math.max(0, query.value.moodboard.itemCount - (query.value.items.length - items.length)), updatedAt: now },
      });
    }
    for (const query of store.getAllQueries(api.moodboards.listMoodboards)) {
      if (!query.value) continue;
      store.setQuery(api.moodboards.listMoodboards, query.args, query.value.map((row) =>
        row._id !== args.moodboardId ? row : {
          ...row,
          itemCount: Math.max(0, row.itemCount - gone.size),
          previewItems: row.previewItems.filter((item) => !gone.has(item.assetId)),
          updatedAt: now,
        }));
    }
  });
  const restore = useMutation(api.moodboards.restoreMoodboardItems);

  const stack = useRef<Removal[]>([]);
  // How many removals Undo can still take back (state, so the toast repaints).
  const [depth, setDepth] = useState(0);
  const setStack = useCallback((next: Removal[]) => { stack.current = next; setDepth(next.length); }, []);
  const busy = useRef(new Set<string>());
  const [toast, setToast] = useState<{ removal: Removal; at: number; error?: string; restored?: boolean } | null>(null);
  const openRemoved = useRef(onOpenRemoved);
  openRemoved.current = onOpenRemoved;

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast((current) => (current?.at === toast.at ? null : current)), toast.error ? TOAST_MS * 1.5 : TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const takeOff = useCallback(async (frame: Frame, fromOpen: boolean) => {
    const key = `${frame.boardId}:${frame.assetId}`;
    if (busy.current.has(key)) return;
    busy.current.add(key);
    const tiles = [frame.element, ...tilesFor(frame.boardId, frame.assetId)];
    tiles.forEach((tile) => tile.setAttribute("data-mb-leaving", ""));
    await new Promise((resolve) => window.setTimeout(resolve, LEAVE_MS));
    if (fromOpen) openRemoved.current?.();
    try {
      const result = await remove({ ownerUserId, moodboardId: frame.boardId as Id<"moodboards">, assetIds: [frame.assetId as Id<"assets">], session });
      if (result.removedItems.length) {
        const removal: Removal = {
          boardId: frame.boardId, boardName: frame.boardName, mirrored: frame.mirrored,
          items: result.removedItems, previousCoverAssetId: result.previousCoverAssetId,
        };
        setStack([...stack.current, removal].slice(-UNDO_DEPTH));
        setToast({ removal, at: Date.now() });
      }
    } catch (error) {
      setToast({
        removal: { boardId: frame.boardId, boardName: frame.boardName, mirrored: false, items: [] },
        at: Date.now(),
        error: error instanceof Error ? error.message.replace(/^.*ConvexError: /, "").replace(/\s+at\s[\s\S]*$/, "") : "Could not take it off the board.",
      });
    } finally {
      tiles.forEach((tile) => tile.removeAttribute("data-mb-leaving"));
      busy.current.delete(key);
    }
  }, [ownerUserId, remove, session, setStack]);

  const undo = useCallback(async () => {
    const removal = stack.current.at(-1);
    if (!removal) return;
    setStack(stack.current.slice(0, -1));
    try {
      await restore({
        ownerUserId, moodboardId: removal.boardId as Id<"moodboards">, items: removal.items,
        coverAssetId: removal.previousCoverAssetId, session,
      });
      setToast({ removal, at: Date.now(), restored: true });
      // A short glow on the frame once it is back.
      for (const delay of [60, 260]) {
        window.setTimeout(() => {
          for (const item of removal.items) {
            for (const tile of tilesFor(removal.boardId, item.assetId)) {
              tile.removeAttribute("data-mb-back");
              void tile.offsetWidth;
              tile.setAttribute("data-mb-back", "");
              window.setTimeout(() => tile.removeAttribute("data-mb-back"), 900);
            }
          }
        }, delay);
      }
    } catch (error) {
      setStack([...stack.current, removal]);
      setToast({ removal, at: Date.now(), error: error instanceof Error ? error.message.replace(/^.*ConvexError: /, "").replace(/\s+at\s[\s\S]*$/, "") : "Could not put it back." });
    }
  }, [ownerUserId, restore, session, setStack]);

  // Where the pointer is, for "the hovered frame".
  const pointer = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const move = (event: PointerEvent) => { pointer.current = { x: event.clientX, y: event.clientY }; };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (typing(event.target)) return;
      const key = event.key.toLowerCase();
      if (key !== "d" && key !== "z") return;
      if (key === "z") {
        if (!stack.current.length || (!moodboardKeysActive() && !document.querySelector("[data-mb-open]"))) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void undo();
        return;
      }
      const open = Array.from(document.querySelectorAll<HTMLElement>("[data-mb-open]")).filter(visible).at(-1);
      const openFrame = open ? frameOf(open.matches("[data-mb-asset]") ? open : open.querySelector<HTMLElement>("[data-mb-asset]")) : null;
      let frame = openFrame;
      if (!frame && !open) {
        const pointed = pointer.current ? document.elementFromPoint(pointer.current.x, pointer.current.y) : null;
        frame = frameOf(pointed as HTMLElement | null) ?? frameOf(document.activeElement as HTMLElement | null);
      }
      if (!frame) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void takeOff(frame, Boolean(openFrame));
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [takeOff, undo]);

  const removal = toast?.removal;
  return (
    <>
      <style>{STYLES}</style>
      {toast && removal ? (
        <div className="mbk-toast" role="status" aria-live="polite" data-tone={toast.error ? "error" : undefined}>
          {toast.error ? (
            <span className="mbk-text">{toast.error}</span>
          ) : toast.restored ? (
            <span className="mbk-text">Back on <b>{removal.boardName}</b>, in its old place</span>
          ) : (
            <>
              <span className="mbk-text">
                Off <b>{removal.boardName}</b> · the asset stays in the gallery
                {removal.mirrored ? <span className="mbk-mj"> · changed since the Midjourney sync</span> : null}
              </span>
              <button type="button" className="mbk-undo" onClick={() => void undo()} disabled={depth === 0}>
                <Undo2 size={12} aria-hidden />Undo<kbd>Z</kbd>
              </button>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}

const STYLES = `
@keyframes mbk-leave{0%{transform:scale(1);opacity:1}55%{transform:scale(.95);opacity:.9}100%{transform:scale(.88);opacity:0}}
@keyframes mbk-chip{0%{transform:translate(-50%,-50%) scale(.6);opacity:0}25%{transform:translate(-50%,-50%) scale(1.06);opacity:1}45%{transform:translate(-50%,-50%) scale(1)}100%{transform:translate(-50%,-50%) scale(1);opacity:1}}
@keyframes mbk-back{0%{box-shadow:0 0 0 2px var(--lm-coral),0 0 24px rgba(242,97,87,.55)}100%{box-shadow:0 0 0 0 transparent,0 0 0 transparent}}
@keyframes mbk-in{from{transform:translate(-50%,8px);opacity:0}to{transform:translate(-50%,0);opacity:1}}
[data-mb-leaving]{animation:mbk-leave ${LEAVE_MS}ms cubic-bezier(.4,0,.2,1) both;pointer-events:none}
[data-mb-leaving]::after{content:"Off board";position:absolute;left:50%;top:50%;z-index:20;padding:6px 11px;border-radius:999px;background:var(--lm-coral,#F26157);color:#FFF4EA;font:700 10px/1 var(--font-geist-mono),ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap;box-shadow:0 6px 20px rgba(0,0,0,.35);animation:mbk-chip ${LEAVE_MS}ms ease-out both}
[data-mb-back]{animation:mbk-back .9s ease-out both}
.mbk-toast{position:fixed;left:50%;bottom:calc(var(--mobile-bottom-nav-height,0px) + 76px);z-index:120;display:flex;align-items:center;gap:12px;max-width:calc(100vw - 32px);padding:8px 8px 8px 16px;border-radius:999px;background:var(--lm-ink,#191919);color:var(--lm-paper,#FFF4EA);font-size:12px;font-weight:600;box-shadow:0 14px 40px rgba(0,0,0,.35);animation:mbk-in .18s ease-out both;transform:translateX(-50%)}
.mbk-toast[data-tone="error"]{background:var(--lm-coral,#F26157)}
.mbk-toast b{font-weight:800;text-transform:uppercase;letter-spacing:.02em}
.mbk-text{min-width:0;line-height:1.35;padding:4px 0}
.mbk-mj{color:var(--lm-ember,#FF8C42)}
.mbk-undo{display:inline-flex;flex:0 0 auto;align-items:center;gap:6px;padding:6px 8px 6px 11px;border-radius:999px;background:var(--lm-paper,#FFF4EA);color:var(--lm-ink,#191919);font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.mbk-undo:disabled{opacity:.45}
.mbk-undo kbd{display:inline-grid;place-items:center;min-width:16px;height:16px;padding:0 4px;border-radius:4px;background:rgba(25,25,25,.12);font:700 9.5px/1 var(--font-geist-mono),ui-monospace,monospace}
.mbk-hint{display:inline-flex;align-items:center;gap:14px;padding:7px 14px;border-radius:999px;background:color-mix(in srgb,var(--lm-paper,#0A0805) 82%,transparent);box-shadow:inset 0 0 0 1px var(--lm-border-strong,rgba(255,244,234,.16));backdrop-filter:blur(10px);color:var(--lm-text-secondary,rgba(255,244,234,.7));font:600 10px/1 var(--font-geist-mono),ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;white-space:nowrap}
.mbk-hint span{display:inline-flex;align-items:center;gap:6px}
.mbk-hint kbd{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;border-radius:4px;background:var(--lm-surface-2,rgba(255,244,234,.08));color:var(--lm-text-primary,#FFF4EA);font:700 10px/1 var(--font-geist-mono),ui-monospace,monospace;box-shadow:inset 0 -1px 0 rgba(0,0,0,.25)}
.mbk-hint-float{position:fixed;left:50%;bottom:20px;z-index:110;transform:translateX(-50%);pointer-events:none}
@media (prefers-reduced-motion:reduce){[data-mb-leaving],[data-mb-leaving]::after,[data-mb-back],.mbk-toast{animation-duration:1ms}}
`;
