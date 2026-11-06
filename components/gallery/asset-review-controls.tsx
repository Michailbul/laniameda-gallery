"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCoralToastSafe } from "@/components/ui/coral-toast";
import { ASSET_HOTKEYS, assetHotkeyOf, promoteHotkeyOf } from "@/lib/asset-hotkeys";
import type { PromoteFrame } from "@/components/review-promote/promote-model";
import { useReviewPromote } from "@/components/review-promote/use-review-promote";
import { heroNotice } from "@/lib/world-hero-inserts";
import "./asset-review.css";

type Target = { id: string; src: string; name: string };
export type ArchiveItem = {
  assetId: string;
  deleteAt: number;
  name: string;
  thumb: string | null;
};

/**
 * The archive lives in a small external store instead of a context value, so
 * a card subscribes to its own row only: archiving one picture re-renders
 * that one card (and the dock count), not every memoised tile in the grid.
 */
export type ArchiveStore = {
  active: () => boolean;
  items: () => ArchiveItem[];
  deleteAt: (assetId: string) => number | undefined;
  trayOpen: () => boolean;
  subscribe: (listener: () => void) => () => void;
  set: (items: ArchiveItem[], active: boolean) => void;
  setTrayOpen: (open: boolean) => void;
  restore: (assetId: string) => void;
  bindRestore: (fn: (assetId: string) => void) => void;
  /** F pressed on a frame, before the server answers: starred or not. */
  starOverride: (assetId: string) => boolean | undefined;
  setStarOverride: (assetId: string, starred: boolean | undefined) => void;
  /** A hero frame on its world page (H), with H's answer applied before the query lands. */
  isHero: (assetId: string) => boolean;
  setHeroIds: (ids: ReadonlySet<string>) => void;
  setHeroOverride: (assetId: string, hero: boolean | undefined) => void;
};

const EMPTY_ARCHIVE: ArchiveItem[] = [];

export function createArchiveStore(): ArchiveStore {
  let items = EMPTY_ARCHIVE;
  let byId = new Map<string, number>();
  let active = false;
  let trayOpen = false;
  let restoreFn: (assetId: string) => void = () => {};
  const stars = new Map<string, boolean>();
  let heroIds: ReadonlySet<string> = new Set();
  const heroes = new Map<string, boolean>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  return {
    active: () => active,
    items: () => items,
    deleteAt: (assetId) => byId.get(assetId),
    trayOpen: () => trayOpen,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next, nextActive) => {
      if (next === items && nextActive === active) return;
      items = next;
      active = nextActive;
      byId = new Map(next.map((item) => [item.assetId, item.deleteAt]));
      if (!next.length) trayOpen = false;
      emit();
    },
    setTrayOpen: (open) => {
      if (open === trayOpen) return;
      trayOpen = open;
      emit();
    },
    restore: (assetId) => restoreFn(assetId),
    bindRestore: (fn) => {
      restoreFn = fn;
    },
    starOverride: (assetId) => stars.get(assetId),
    setStarOverride: (assetId, starred) => {
      if (stars.get(assetId) === starred) return;
      if (starred === undefined) stars.delete(assetId);
      else stars.set(assetId, starred);
      emit();
    },
    isHero: (assetId) => heroes.get(assetId) ?? heroIds.has(assetId),
    setHeroIds: (ids) => {
      heroIds = ids;
      emit();
    },
    setHeroOverride: (assetId, hero) => {
      if (heroes.get(assetId) === hero) return;
      if (hero === undefined) heroes.delete(assetId);
      else heroes.set(assetId, hero);
      emit();
    },
  };
}

const INACTIVE_STORE = createArchiveStore();
export const ArchiveStoreContext = createContext<ArchiveStore>(INACTIVE_STORE);
export const useArchiveStore = () => useContext(ArchiveStoreContext);

/** When this asset deletes, if it is archived; undefined otherwise. */
export function useArchivedAt(assetId: string | undefined) {
  const store = useArchiveStore();
  return useSyncExternalStore(
    store.subscribe,
    () => (assetId ? store.deleteAt(assetId) : undefined),
    () => undefined,
  );
}

/** The star F just set on this asset, until the gallery query carries it. */
export function useStarOverride(assetId: string | undefined) {
  const store = useArchiveStore();
  return useSyncExternalStore(
    store.subscribe,
    () => (assetId ? store.starOverride(assetId) : undefined),
    () => undefined,
  );
}

/** Whether this asset is a hero frame on its world page (the HERO chip). */
export function useIsHero(assetId: string | undefined) {
  const store = useArchiveStore();
  return useSyncExternalStore(
    store.subscribe,
    () => (assetId ? store.isHero(assetId) : false),
    () => false,
  );
}

export function useArchiveItems() {
  const store = useArchiveStore();
  return useSyncExternalStore(store.subscribe, store.items, () => EMPTY_ARCHIVE);
}

export function useReviewActive() {
  const store = useArchiveStore();
  return useSyncExternalStore(store.subscribe, store.active, () => false);
}

function useTrayOpen() {
  const store = useArchiveStore();
  return useSyncExternalStore(store.subscribe, store.trayOpen, () => false);
}

/** Seconds left before an archived asset deletes, ticking once a second. */
function useCountdown(deleteAt: number | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deleteAt === undefined) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [deleteAt]);
  if (deleteAt === undefined) return "";
  const seconds = Math.min(600, Math.max(0, Math.ceil((deleteAt - now) / 1000)));
  return seconds
    ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
    : "Deleting…";
}

/**
 * The archived state on a frame: the picture stays visible, grayed, with
 * one small chip that counts down and restores. Nothing covers the image.
 */
export function ArchivedChip({
  assetId,
  deleteAt,
}: {
  assetId: string;
  deleteAt: number;
}) {
  const store = useArchiveStore();
  const left = useCountdown(deleteAt);
  return (
    <span className="asset-review-chip" data-review-restore>
      <span className="asset-review-chip-label">Archived</span>
      <span className="asset-review-chip-time">{left}</span>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          store.restore(assetId);
        }}
        aria-label="Restore to the gallery"
        title="Restore (D, or double-click the frame)"
      >
        Restore
      </button>
    </span>
  );
}

const KEYS = [
  { key: "F", label: "Feature" },
  { key: "D", label: "Archive" },
  { key: "H", label: "Hero" },
  { key: "C", label: "Comment" },
  { key: "V", label: "Scene idea" },
  { key: "R", label: "Review" },
] as const;

/**
 * The key hints and the Archive toggle as one segment of the bottom dock, so
 * the two can never sit on top of each other at any width.
 */
export function ReviewDockHints() {
  const store = useArchiveStore();
  const active = useReviewActive();
  const count = useArchiveItems().length;
  const open = useTrayOpen();
  if (!active) return null;
  return (
    <div className="asset-review-dock" aria-label="Frame keys">
      <span className="asset-review-dock-keys">
        {KEYS.map(({ key, label }) => (
          <span
            key={key}
            title={
              key === "R"
                ? "R: promote the hovered frame (or the selection) to the director review · Shift+R: to the last place"
                : `${key}: ${label} the hovered frame`
            }
          >
            <kbd>{key}</kbd>
            <span className="asset-review-dock-label">{label}</span>
          </span>
        ))}
      </span>
      <button
        type="button"
        className="asset-review-dock-archive"
        onClick={() => store.setTrayOpen(!open)}
        aria-expanded={open}
        aria-label={`Archive tray, ${count} ${count === 1 ? "frame" : "frames"}`}
        data-open={open || undefined}
      >
        Archive
        <span>{count}</span>
      </button>
    </div>
  );
}

/** The same keys, small, in the expanded view's header. */
export function ReviewHeaderHints({ assetId }: { assetId?: string }) {
  const active = useReviewActive();
  const deleteAt = useArchivedAt(assetId);
  if (!active || !assetId) return null;
  if (deleteAt !== undefined)
    return <ArchivedChip assetId={assetId} deleteAt={deleteAt} />;
  return (
    <span className="asset-review-header-keys" aria-label="Frame keys">
      {KEYS.map(({ key, label }) => (
        <span key={key}>
          <kbd>{key}</kbd>
          {label}
        </span>
      ))}
    </span>
  );
}

function ArchiveTrayItem({ item }: { item: ArchiveItem }) {
  const store = useArchiveStore();
  const left = useCountdown(item.deleteAt);
  return (
    <div className="asset-review-archive-item">
      <button
        type="button"
        className="asset-review-archive-image"
        onDoubleClick={() => store.restore(item.assetId)}
        aria-label={`Restore ${item.name} with a double-click`}
      >
        {item.thumb && (
          <Image
            src={item.thumb}
            alt={item.name}
            width={200}
            height={130}
            unoptimized
          />
        )}
      </button>
      <span>{left}</span>
      <button
        type="button"
        className="asset-review-restore"
        onClick={() => store.restore(item.assetId)}
      >
        Restore
      </button>
    </div>
  );
}

export function ArchiveTray() {
  const store = useArchiveStore();
  const open = useTrayOpen();
  const items = useArchiveItems();
  useEffect(() => {
    if (!open) return;
    // Escape closes the tray first, before it reaches an open detail view.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      store.setTrayOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, store]);
  if (!open) return null;
  return (
    <aside className="asset-review-tray" aria-label="Archived assets">
      <header>
        <strong>ARCHIVE</strong>
        <button
          type="button"
          onClick={() => store.setTrayOpen(false)}
          aria-label="Close archive"
        >
          ×
        </button>
      </header>
      <p>Deleted when the timer ends. Restore, or double-click a frame.</p>
      <div className="asset-review-archive-grid">
        {items.map((item) => (
          <ArchiveTrayItem key={item.assetId} item={item} />
        ))}
        {!items.length && <p>Archive is empty.</p>}
      </div>
    </aside>
  );
}

/** A frame for the promote palette, read off its tile when it is on screen. */
function frameOf(id: string, node?: HTMLElement | null): PromoteFrame {
  const tile =
    node ??
    document.querySelector<HTMLElement>(`[data-review-id="${CSS.escape(id)}"]`);
  return {
    id,
    thumb: tile?.dataset.reviewSrc || undefined,
    name: tile?.dataset.reviewName || undefined,
  };
}

export function AssetReviewControls({
  ownerUserId,
  enabled,
  selectedAssetIds,
  children,
}: {
  ownerUserId?: string;
  enabled: boolean;
  /** The grid selection: R promotes all of it when several are selected. */
  selectedAssetIds?: string[];
  children: ReactNode;
}) {
  const { isAuthenticated } = useConvexAuth();
  const active = Boolean(enabled && ownerUserId && isAuthenticated);
  const archived =
    useQuery(
      api.assetReview.list,
      active ? { ownerUserId: ownerUserId! } : "skip",
    ) ?? EMPTY_ARCHIVE;
  const [store] = useState(createArchiveStore);
  const archive = useMutation(api.assetReview.archive);
  const restoreMutation = useMutation(api.assetReview.restore);
  const setStarred = useMutation(api.assets.setAssetStarred);
  const saveStory = useMutation(api.stories.saveStory);
  const addComment = useMutation(api.assetComments.addAssetComment);
  const setHeroInsert = useMutation(api.worldPage.setHeroInsert);
  const heroRows = useQuery(
    api.worldPage.listHeroAssetIds,
    active ? { ownerUserId: ownerUserId! } : "skip",
  );
  const coral = useCoralToastSafe();
  const notify = useCallback(
    (title: string, warning = false) =>
      coral?.toast(title, undefined, warning ? "warning" : "success", 4000),
    [coral],
  );
  const [editor, setEditor] = useState<{
    target: Target;
    kind: "comment" | "scene";
    key: string;
  } | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(new Set<string>());
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const {
    open: openPromote,
    sendToLast: promoteToLast,
    isOpen: promoteOpen,
    element: promoteElement,
  } = useReviewPromote({ ownerUserId, active });
  const selection = useRef<string[]>([]);

  useEffect(() => {
    selection.current = selectedAssetIds ?? [];
  }, [selectedAssetIds]);

  useEffect(() => {
    store.set(active ? archived : EMPTY_ARCHIVE, active);
  }, [store, active, archived]);

  useEffect(() => {
    store.setHeroIds(new Set((heroRows ?? []).map((row) => row.assetId as string)));
  }, [store, heroRows]);

  const restore = useCallback(
    async (id: string) => {
      if (!active || inFlight.current.has(id)) return;
      inFlight.current.add(id);
      try {
        await restoreMutation({
          ownerUserId: ownerUserId!,
          assetId: id as Id<"assets">,
        });
        notify("Restored to the gallery");
      } catch (error) {
        notify(
          error instanceof Error ? error.message : "Could not restore asset",
          true,
        );
      } finally {
        inFlight.current.delete(id);
      }
    },
    [active, ownerUserId, restoreMutation, notify],
  );

  useEffect(() => {
    store.bindRestore((id) => {
      void restore(id);
    });
  }, [store, restore]);

  useEffect(() => {
    if (!editor) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    textarea.current?.focus();
    return () => previousFocus.current?.focus();
  }, [editor]);

  useEffect(() => {
    if (!active) return;
    const move = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    const keydown = (event: KeyboardEvent) => {
      if (editor || promoteOpen) return;
      // The key set and the typing guard live in lib/asset-hotkeys.ts.
      const promoteKey = promoteHotkeyOf(event);
      const key = promoteKey ? null : assetHotkeyOf(event);
      // 2 and O belong to the world page.
      if (!promoteKey && (!key || key === ASSET_HOTKEYS.drop || key === ASSET_HOTKEYS.open)) return;
      // Other open dialogs own their keys. The gallery detail view is allowed.
      const visible = (node: HTMLElement) => node.getClientRects().length > 0;
      if (
        Array.from(
          document.querySelectorAll<HTMLElement>(
            '[role="dialog"]:not([data-asset-detail])',
          ),
        ).some(visible) ||
        document.querySelector('[data-state="open"][role="menu"]')
      )
        return;
      const detail = Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-review-detail][data-review-id]",
        ),
      ).find(visible);
      // Keep the existing reviewer-note shortcut while inspecting an edit.
      if (
        key === ASSET_HOTKEYS.comment &&
        detail
          ?.querySelector<HTMLElement>('[aria-label="Note for the reviewer"]')
          ?.getClientRects().length
      )
        return;
      if (
        detail?.querySelector<HTMLElement>(".lm-wipe")?.getClientRects()
          .length &&
        key === ASSET_HOTKEYS.archive
      )
        return;
      const pointed = pointer.current
        ? document
            .elementFromPoint(pointer.current.x, pointer.current.y)
            ?.closest<HTMLElement>("[data-review-id]")
        : null;
      const focused =
        document.activeElement?.closest<HTMLElement>("[data-review-id]");
      const frame = detail ?? pointed ?? focused;
      if (promoteKey) {
        // R: the open frame; else the selection when several are picked (or
        // when nothing is hovered); else the hovered frame.
        const usable = frame?.dataset.reviewId && frame.dataset.reviewDisabled !== "true" ? frame : null;
        const picked = selection.current;
        const frames: PromoteFrame[] =
          !detail && (picked.length > 1 || (picked.length === 1 && !usable))
            ? picked.map((id) => frameOf(id))
            : usable
              ? [frameOf(usable.dataset.reviewId!, usable)]
              : [];
        if (!frames.length) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (promoteKey === "last") void promoteToLast(frames);
        else openPromote(frames);
        return;
      }
      if (!frame?.dataset.reviewId || frame.dataset.reviewDisabled === "true")
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const target = {
        id: frame.dataset.reviewId,
        src: frame.dataset.reviewSrc ?? "",
        name: frame.dataset.reviewName ?? "Scene",
      };
      if (key === ASSET_HOTKEYS.hero) {
        const was = store.isHero(target.id);
        const pair = event.shiftKey;
        if (!pair) store.setHeroOverride(target.id, !was);
        void setHeroInsert({
          ownerUserId: ownerUserId!,
          assetId: target.id as Id<"assets">,
          action: pair ? "pair" : "toggle",
        })
          .then((result) => notify(heroNotice(result)))
          .catch((error) =>
            notify(error instanceof Error ? error.message : "Could not make it a hero", true),
          )
          .finally(() => store.setHeroOverride(target.id, undefined));
      } else if (key === ASSET_HOTKEYS.feature) {
        // Optimistic: the card repaints from the store this frame; the
        // override clears once the mutation (and so the query) has landed.
        const current = store.starOverride(target.id);
        const next = !(current ?? frame.dataset.reviewStarred === "true");
        store.setStarOverride(target.id, next);
        void setStarred({
          ownerUserId: ownerUserId!,
          assetId: target.id as Id<"assets">,
          starred: next,
        })
          .then(() => notify(next ? "Featured · leads the public page" : "Unfeatured"))
          .catch((error) =>
            notify(error instanceof Error ? error.message : "Could not feature asset", true),
          )
          .finally(() => store.setStarOverride(target.id, undefined));
      } else if (key === ASSET_HOTKEYS.archive) {
        if (inFlight.current.has(target.id)) return;
        // D toggles: on an archived frame it brings the frame back.
        if (store.deleteAt(target.id) !== undefined) {
          void restore(target.id);
          return;
        }
        inFlight.current.add(target.id);
        void archive({
          ownerUserId: ownerUserId!,
          assetId: target.id as Id<"assets">,
        })
          .then(() => notify("Archived · deletes in 10 minutes · D restores"))
          .catch((error) =>
            notify(
              error instanceof Error ? error.message : "Could not archive asset",
              true,
            ),
          )
          .finally(() => inFlight.current.delete(target.id));
      } else {
        setText("");
        setEditor({
          target,
          kind: key === ASSET_HOTKEYS.comment ? "comment" : "scene",
          key: `asset-note:${crypto.randomUUID()}`,
        });
      }
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("keydown", keydown, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("keydown", keydown, true);
    };
  }, [active, ownerUserId, archive, restore, notify, store, editor, setStarred, setHeroInsert, promoteOpen, openPromote, promoteToLast]);

  async function save() {
    if (!editor || !text.trim() || busy) return;
    setBusy(true);
    try {
      if (editor.kind === "comment") {
        await addComment({
          ownerUserId: ownerUserId!,
          assetId: editor.target.id as Id<"assets">,
          body: text.trim(),
          context: "Gallery hotkey comment on the displayed frame.",
        });
      } else {
        await saveStory({
          ownerUserId: ownerUserId!,
          ingestKey: editor.key,
          title: text.trim().split("\n")[0].slice(0, 200),
          body: text.trim(),
          kind: "idea",
          status: "idea",
          tagNames: ["scene-note", "agent-review"],
          assetIds: [editor.target.id as Id<"assets">],
        });
      }
      setEditor(null);
      notify(
        editor.kind === "comment"
          ? "Comment saved · queued for your agent"
          : "Saved in Stories / Scripts · ready for agent review",
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not save note",
        true,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ArchiveStoreContext.Provider value={store}>
      {children}
      {active && <ArchiveTray />}
      {promoteElement}
      {active &&
        editor &&
        createPortal(
          <div
            className="asset-review-backdrop"
            onClick={(event) => event.stopPropagation()}
          >
            <div
              ref={dialog}
              className="asset-review-editor"
              role="dialog"
              aria-modal="true"
              aria-labelledby="asset-note-title"
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Escape" && !busy) {
                  event.preventDefault();
                  setEditor(null);
                }
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void save();
                }
                if (event.key === "Tab") {
                  const nodes = dialog.current?.querySelectorAll<HTMLElement>(
                    "textarea, button:not(:disabled)",
                  );
                  if (!nodes?.length) return;
                  const first = nodes[0],
                    last = nodes[nodes.length - 1];
                  if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                  }
                  if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                  }
                }
              }}
            >
              {editor.target.src && (
                <Image
                  className="asset-review-note-image"
                  src={editor.target.src}
                  alt="Source scene"
                  width={440}
                  height={620}
                  unoptimized
                />
              )}
              <div className="asset-review-note-body">
                <header>
                  <h2 id="asset-note-title">
                    {editor.kind === "comment"
                      ? "ASSET COMMENT"
                      : "SCENE / BEAT IDEA"}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setEditor(null)}
                    disabled={busy}
                    aria-label="Close note"
                  >
                    ×
                  </button>
                </header>
                <p>
                  Saved with this frame. Your agent can pick it up on the next
                  routine.
                </p>
                <textarea
                  ref={textarea}
                  aria-label={
                    editor.kind === "comment"
                      ? "Asset comment"
                      : "Scene or beat idea"
                  }
                  placeholder={
                    editor.kind === "comment"
                      ? "What should the agent know?"
                      : "What happens in this scene?"
                  }
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  disabled={busy}
                  maxLength={editor.kind === "comment" ? 4000 : 200000}
                />
                <footer>
                  <span>⌘ / Ctrl + Enter to save</span>
                  <button
                    type="button"
                    disabled={busy || !text.trim()}
                    onClick={() => {
                      void save();
                    }}
                  >
                    {busy ? "Saving…" : "Save note"}
                  </button>
                </footer>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </ArchiveStoreContext.Provider>
  );
}
