"use client";
/* eslint-disable @next/next/no-img-element -- R2 thumbnails at their own sizes; the gallery grid does the same. */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, Loader2, Plus, Send, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MOODBOARD_LIMITS } from "@/lib/moodboards";
import { queueMoodboardPick } from "@/lib/moodboard-pick-handoff";
import { MoodboardKeyHint, useMoodboardSurface } from "@/components/gallery/moodboard-frame-keys";
import { syncOf, useSendToMidjourney } from "./moodboard-sync";

// The moodboard studio on the project page: the project's images on the left
// (the whole world, or one shelf or style), the open moodboard on the right.
// Drag frames across (or + on a frame, or select several and drag them as
// one), reorder by dragging inside the board, remove with × or D on the
// hovered or open image (Z puts it back; moodboard-frame-keys.tsx), O or a
// double-click opens a board image large. Every change is
// saved at once (journaled under the session "moodboard-studio"). Michael,
// 9 Nov 2026: build moodboards without leaving the images.

export type StudioShelf = { id: Id<"folders">; name: string; group?: string; count: number; artDirector: boolean };

type Props = {
  ownerUserId: string;
  world: { id: Id<"folders">; key: string; name: string };
  shelves: StudioShelf[];
  /** The open board, "new" for the create form. */
  boardId: string;
  onBoard: (boardId: string) => void;
  onClose: () => void;
};

const DRAG_ASSETS = "application/x-lm-assets";
const DRAG_ITEM = "application/x-lm-board-item";
const SESSION = "moodboard-studio";
const PAGE = 60;

const errorText = (error: unknown) =>
  error instanceof Error ? error.message.replace(/^.*ConvexError: /, "").replace(/\s+at\s[\s\S]*$/, "") : "That did not save.";

const isTyping = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  return Boolean(element?.isContentEditable || element?.closest?.("input, textarea, select"));
};

// Move `moving` before `before` (or to the end) in an order of asset ids.
const placeBefore = (order: string[], moving: string[], before: string | null) => {
  const rest = order.filter((id) => !moving.includes(id));
  const at = before ? rest.indexOf(before) : -1;
  if (at < 0) return [...rest, ...moving];
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
};

export function MoodboardStudio({ ownerUserId, world, shelves, boardId, onBoard, onClose }: Props) {
  const router = useRouter();
  // ------------------------------------------------------------ left: the images
  const [source, setSource] = useState<string>("world");
  const worldPage = usePaginatedQuery(
    api.assets.listGalleryAssetsPage,
    source === "world" ? { ownerUserId, folderId: world.id, includeDescendants: true, mergeOwners: true, kind: "image" } : "skip",
    { initialNumItems: PAGE },
  );
  const shelfPage = usePaginatedQuery(
    api.assets.listFolderAssetsPage,
    source !== "world" ? { ownerUserId, folderId: source as Id<"folders">, kind: "image" } : "skip",
    { initialNumItems: PAGE },
  );
  const page = source === "world" ? worldPage : shelfPage;
  const pictures = useMemo(() => {
    const seen = new Set<string>();
    return page.results.filter((row) => (seen.has(row._id) ? false : (seen.add(row._id), true)));
  }, [page.results]);

  const groups = useMemo(() => {
    const out = new Map<string, StudioShelf[]>();
    for (const shelf of shelves) {
      const label = shelf.artDirector ? "Art director" : shelf.group || "Shelves";
      out.set(label, [...(out.get(label) ?? []), shelf]);
    }
    return [...out.entries()];
  }, [shelves]);

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // More frames as the end of the grid comes into view.
  const leftRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const { status, loadMore } = page;
  useEffect(() => {
    const sentinel = moreRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((entry) => entry.isIntersecting) && status === "CanLoadMore") loadMore(PAGE); },
      { root: leftRef.current, rootMargin: "800px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [status, loadMore, source]);

  // ------------------------------------------------------------ right: the board
  const boards = useQuery(api.moodboards.listMoodboards, { ownerUserId, folderId: world.id, includeChildren: true, previewLimit: 0 });
  const isNew = boardId === "new";
  const detail = useQuery(api.moodboards.getMoodboard, isNew ? "skip" : { ownerUserId, moodboardId: boardId as Id<"moodboards"> });
  const board = detail?.moodboard;
  const items = useMemo(() => detail?.items ?? [], [detail]);
  const onBoardIds = useMemo(() => new Set(items.map((item) => item.assetId as string)), [items]);

  const create = useMutation(api.moodboards.createMoodboard);
  const add = useMutation(api.moodboards.addMoodboardItems);
  const remove = useMutation(api.moodboards.removeMoodboardItems);
  const reorder = useMutation(api.moodboards.reorderMoodboardItems);
  const { state: sendState, send } = useSendToMidjourney(ownerUserId, world.id);

  const [saving, setSaving] = useState(0);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const run = useCallback(async (work: () => Promise<unknown>) => {
    setSaving((count) => count + 1);
    setError("");
    try {
      await work();
      setSavedAt(Date.now());
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setSaving((count) => count - 1);
    }
  }, []);

  const addAssets = useCallback((ids: string[], before: string | null = null) => {
    if (!board) return;
    const fresh = [...new Set(ids)].filter((id) => !onBoardIds.has(id));
    const moving = before ? [...new Set(ids)] : fresh;
    if (!moving.length) return;
    const order = items.map((item) => item.assetId as string);
    void run(async () => {
      for (let at = 0; at < fresh.length; at += MOODBOARD_LIMITS.itemsPerCall) {
        await add({ ownerUserId, moodboardId: board._id, assetIds: fresh.slice(at, at + MOODBOARD_LIMITS.itemsPerCall) as Id<"assets">[], session: SESSION });
      }
      if (before) {
        await reorder({ ownerUserId, moodboardId: board._id, assetIds: placeBefore([...order, ...fresh], moving, before) as Id<"assets">[], session: SESSION });
      }
    });
    setSelected(new Set());
  }, [board, onBoardIds, items, run, add, reorder, ownerUserId]);

  // The expanded view of one board image. When that image leaves the board
  // (D), the view stays on the image that took its place.
  const [openAt, setOpenAt] = useState<{ id: string; index: number } | null>(null);
  const openItem = openAt && items.length
    ? items.find((item) => item.assetId === openAt.id) ?? items[Math.min(openAt.index, items.length - 1)]
    : null;
  const openIndex = openItem ? items.indexOf(openItem) : -1;
  const openBoardItem = (id: string) => {
    const index = items.findIndex((item) => item.assetId === id);
    if (index >= 0) setOpenAt({ id, index });
  };
  const step = (offset: number) => {
    if (!openItem || items.length < 2) return;
    const index = (openIndex + offset + items.length) % items.length;
    setOpenAt({ id: items[index].assetId, index });
  };
  useMoodboardSurface(Boolean(board));

  const removeAsset = (id: string) => {
    if (!board) return;
    void run(() => remove({ ownerUserId, moodboardId: board._id, assetIds: [id as Id<"assets">], session: SESSION }));
  };

  // ------------------------------------------------------------ drag and drop
  const [over, setOver] = useState<string | null>(null); // "board" or the item it would go before
  const dragIds = (id: string) => (selected.has(id) ? [...selected] : [id]);
  const startDrag = (event: DragEvent, id: string) => {
    const ids = dragIds(id);
    event.dataTransfer.setData(DRAG_ASSETS, JSON.stringify(ids));
    event.dataTransfer.setData("text/plain", ids.join("\n"));
    event.dataTransfer.effectAllowed = "copyMove";
  };
  const accepts = (event: DragEvent) => event.dataTransfer.types.includes(DRAG_ASSETS) || event.dataTransfer.types.includes(DRAG_ITEM);
  const dropAt = (event: DragEvent, before: string | null) => {
    event.preventDefault();
    event.stopPropagation();
    setOver(null);
    const fromLeft = event.dataTransfer.getData(DRAG_ASSETS);
    if (fromLeft) {
      try { addAssets(JSON.parse(fromLeft) as string[], before); } catch { /* not ours */ }
      return;
    }
    const moving = event.dataTransfer.getData(DRAG_ITEM);
    if (!moving || !board || moving === before) return;
    const order = items.map((item) => item.assetId as string);
    void run(() => reorder({ ownerUserId, moodboardId: board._id, assetIds: placeBefore(order, [moving], before) as Id<"assets">[], session: SESSION }));
  };

  // ------------------------------------------------------------ new board
  const [name, setName] = useState("");
  const [place, setPlace] = useState<string>(world.id);
  const [creating, setCreating] = useState(false);
  const createBoard = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    setError("");
    try {
      const result = await create({ ownerUserId, folderId: place as Id<"folders">, name: name.trim(), session: SESSION });
      const start = [...selected];
      if (start.length) {
        for (let at = 0; at < start.length; at += MOODBOARD_LIMITS.itemsPerCall) {
          await add({ ownerUserId, moodboardId: result.moodboardId, assetIds: start.slice(at, at + MOODBOARD_LIMITS.itemsPerCall) as Id<"assets">[], session: SESSION });
        }
        setSelected(new Set());
      }
      setName("");
      onBoard(result.moodboardId);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setCreating(false);
    }
  };

  // ------------------------------------------------------------ keys, scroll lock
  const keys = useRef<{
    selectedSize: number; clear: () => void; close: () => void;
    isOpen: boolean; closeOpen: () => void; open: (id: string) => void; step: (offset: number) => void;
  }>({ selectedSize: 0, clear: () => {}, close: onClose, isOpen: false, closeOpen: () => {}, open: () => {}, step: () => {} });
  useEffect(() => {
    keys.current = {
      selectedSize: selected.size, clear: () => setSelected(new Set()), close: onClose,
      isOpen: Boolean(openItem), closeOpen: () => setOpenAt(null), open: openBoardItem, step,
    };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      const current = keys.current;
      if (event.key === "Escape") {
        event.preventDefault();
        if (current.isOpen) current.closeOpen();
        else if (current.selectedSize) current.clear();
        else current.close();
        return;
      }
      if (current.isOpen && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        current.step(event.key === "ArrowLeft" ? -1 : 1);
        return;
      }
      if (event.key.toLowerCase() === "o" && !event.repeat) {
        if (current.isOpen) { event.preventDefault(); current.closeOpen(); return; }
        const hovered = document.querySelector<HTMLElement>(".lms-item:hover")?.dataset.mbAsset;
        if (hovered) { event.preventDefault(); current.open(hovered); }
      }
    };
    window.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, []);

  const sync = board ? syncOf(board) : null;
  const sendFor = board ? sendState[board._id] : undefined;
  const openInGallery = (pick: boolean) => {
    if (!board) return;
    if (pick) queueMoodboardPick({ id: board._id, name: board.name, folderId: board.folderId });
    router.push(`/moodboards/${encodeURIComponent(board._id)}`);
  };

  return (
    <div className="lms" role="dialog" aria-modal="true" aria-label="Moodboard studio">
      <style>{CSS}</style>
      <header className="lms-bar">
        <span className="lms-kicker">Moodboards · {world.name}</span>
        <span className="lms-hint">Drag frames onto the board · click to select several · D takes a board image off · Esc closes</span>
        <button type="button" className="lms-icon" onClick={onClose} aria-label="Close the moodboard studio"><X size={16} /></button>
      </header>

      <div className="lms-split">
        {/* ------------------------------------------------ the project's images */}
        <section className="lms-left" ref={leftRef} aria-label="Project images">
          <div className="lms-sources" role="tablist" aria-label="Where the images come from">
            <button type="button" role="tab" aria-selected={source === "world"} className="lms-src" onClick={() => setSource("world")}>Whole world</button>
            {groups.map(([label, rows]) => (
              <Fragment key={label}>
                <span className="lms-src-group">{label}</span>
                {rows.map((shelf) => (
                  <button key={shelf.id} type="button" role="tab" aria-selected={source === shelf.id} className="lms-src" onClick={() => setSource(shelf.id)}>
                    {shelf.name}<span>{shelf.count}</span>
                  </button>
                ))}
              </Fragment>
            ))}
          </div>

          {page.status === "LoadingFirstPage" ? (
            <div className="lms-wait"><Loader2 className="animate-spin" size={16} aria-label="Loading images" /></div>
          ) : pictures.length === 0 ? (
            <p className="lms-empty">No images here.</p>
          ) : (
            <div className="lms-grid">
              {pictures.map((picture) => {
                const id = picture._id as string;
                const on = onBoardIds.has(id);
                return (
                  <div
                    key={id}
                    className="lms-tile"
                    data-sel={selected.has(id) ? "" : undefined}
                    data-on={on ? "" : undefined}
                    draggable
                    onDragStart={(event) => startDrag(event, id)}
                    onClick={() => toggle(id)}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected.has(id)}
                    aria-label={picture.name ?? "Image"}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(id); } }}
                  >
                    <img
                      src={picture.thumbUrl ?? picture.url}
                      alt=""
                      width={picture.thumbWidth ?? picture.width}
                      height={picture.thumbHeight ?? picture.height}
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                    />
                    {on ? <span className="lms-chip on"><Check size={11} aria-hidden />On board</span> : board ? (
                      <button type="button" className="lms-chip add" onClick={(event) => { event.stopPropagation(); addAssets([id]); }}>
                        <Plus size={11} aria-hidden />Add
                      </button>
                    ) : null}
                    {selected.has(id) ? <span className="lms-check"><Check size={12} aria-hidden /></span> : null}
                  </div>
                );
              })}
            </div>
          )}
          <div ref={moreRef} className="lms-more">{page.status === "LoadingMore" ? <Loader2 className="animate-spin" size={14} /> : null}</div>

          {selected.size ? (
            <div className="lms-selbar">
              <span>{selected.size} selected</span>
              {board ? <button type="button" className="lms-btn" onClick={() => addAssets([...selected])}><Plus size={12} aria-hidden />Add to {board.name}</button> : null}
              {isNew ? <span className="lms-mono">They go on the new board</span> : null}
              <button type="button" className="lms-btn ghost" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          ) : null}
        </section>

        {/* ------------------------------------------------ the moodboard */}
        <aside
          className="lms-right"
          data-over={over === "board" ? "" : undefined}
          data-mb-board={board?._id}
          data-mb-name={board?.name}
          data-mb-mj={board && (board.mjCode || board.mjMoodboardId) ? "1" : undefined}
          aria-label="Moodboard"
          onDragOver={(event) => { if (board && accepts(event)) { event.preventDefault(); if (over === null) setOver("board"); } }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(null); }}
          onDrop={(event) => dropAt(event, null)}
        >
          <div className="lms-switch">
            <select
              className="lms-select"
              value={boardId}
              onChange={(event) => onBoard(event.target.value)}
              aria-label="Which moodboard"
            >
              <option value="new">+ New moodboard</option>
              {(boards ?? []).map((row) => <option key={row._id} value={row._id}>{row.name} · {row.itemCount}</option>)}
            </select>
            <span className="lms-save lms-mono" aria-live="polite">
              {saving > 0 ? <><Loader2 size={11} className="animate-spin" aria-hidden />Saving</> : savedAt ? <><Check size={11} aria-hidden />Saved</> : null}
            </span>
          </div>

          {isNew ? (
            <form className="lms-new" onSubmit={createBoard}>
              <h2>New moodboard</h2>
              <label>
                <span className="lms-mono">Name</span>
                <input autoFocus required maxLength={MOODBOARD_LIMITS.name} value={name} onChange={(event) => setName(event.target.value)} placeholder="CAS · School by day" />
              </label>
              <label>
                <span className="lms-mono">Belongs to</span>
                <select value={place} onChange={(event) => setPlace(event.target.value)}>
                  <option value={world.id}>{world.name}</option>
                  {shelves.map((shelf) => <option key={shelf.id} value={shelf.id}>{shelf.group ? `${shelf.group} · ` : ""}{shelf.name}</option>)}
                </select>
              </label>
              <button type="submit" className="lms-btn" disabled={!name.trim() || creating}>
                {creating ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Plus size={12} aria-hidden />}
                {selected.size ? `Create with ${selected.size} selected` : "Create"}
              </button>
              <p className="lms-mono lms-dim">Then drag frames from the left onto it.</p>
            </form>
          ) : detail === undefined ? (
            <div className="lms-wait"><Loader2 className="animate-spin" size={16} aria-label="Loading the moodboard" /></div>
          ) : board ? (
            <>
              <div className="lms-head">
                <h2>{board.name}</h2>
                <span className="lms-mono lms-dim">{items.length} {items.length === 1 ? "image" : "images"} · {detail.folderName}</span>
                {sync ? (
                  <div className="lms-sync" data-tone={sync.tone}>
                    <span className="lms-mono">{sync.label}{board.mjCode ? ` · ${board.mjCode}` : ""}</span>
                    {sync.action && items.length ? (
                      sendFor === "done" ? <span className="lms-mono"><Check size={11} aria-hidden /> Asked an agent · Tasks</span> : (
                        <button type="button" className="lms-btn small" disabled={sendFor === "busy"} onClick={() => void send(board)}>
                          {sendFor === "busy" ? <Loader2 size={11} className="animate-spin" aria-hidden /> : <Send size={11} aria-hidden />}{sync.action}
                        </button>
                      )
                    ) : null}
                  </div>
                ) : null}
                {sendFor && sendFor !== "busy" && sendFor !== "done" ? <p className="lms-err" role="alert">{sendFor}</p> : null}
                <div className="lms-links">
                  <button type="button" className="lms-link" onClick={() => openInGallery(false)}>Open in the gallery<ArrowUpRight size={11} aria-hidden /></button>
                  <button type="button" className="lms-link" onClick={() => openInGallery(true)}>Pick across the whole gallery<ArrowUpRight size={11} aria-hidden /></button>
                </div>
              </div>

              {items.length === 0 ? (
                <div className="lms-drop">Drag frames here</div>
              ) : (
                <div className="lms-items">
                  {items.map((item, index) => (
                    <div
                      key={item.itemId}
                      className="lms-item"
                      data-before={over === item.assetId ? "" : undefined}
                      data-mb-asset={item.assetId}
                      onDoubleClick={() => openBoardItem(item.assetId)}
                      draggable
                      onDragStart={(event) => { event.dataTransfer.setData(DRAG_ITEM, item.assetId); event.dataTransfer.effectAllowed = "move"; }}
                      onDragOver={(event) => { if (accepts(event)) { event.preventDefault(); event.stopPropagation(); if (over !== item.assetId) setOver(item.assetId); } }}
                      onDrop={(event) => dropAt(event, item.assetId)}
                    >
                      <img src={item.thumbUrl ?? item.url} alt="" loading="lazy" draggable={false} width={item.width} height={item.height} />
                      <span className="lms-n lms-mono">{index + 1}</span>
                      <button type="button" className="lms-x" onClick={() => removeAsset(item.assetId)} aria-label="Take off the board"><X size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
              {error ? <p className="lms-err" role="alert">{error}</p> : null}
              {items.length ? <MoodboardKeyHint className="lms-keys" extra={[{ key: "O", label: "Open" }, { key: "Esc", label: "Close" }]} /> : null}
            </>
          ) : null}
          {isNew && error ? <p className="lms-err" role="alert">{error}</p> : null}
        </aside>
      </div>

      {board && openItem ? (
        <div
          className="lms-lb"
          role="dialog"
          aria-label={`${board.name}, image ${openIndex + 1} of ${items.length}`}
          data-mb-open=""
          data-mb-board={board._id}
          data-mb-name={board.name}
          data-mb-mj={board.mjCode || board.mjMoodboardId ? "1" : undefined}
          data-mb-asset={openItem.assetId}
        >
          <button type="button" className="lms-lb-bg" onClick={() => setOpenAt(null)} aria-label="Close the large view" />
          <img key={openItem.assetId} src={openItem.url ?? openItem.thumbUrl} alt="" width={openItem.width} height={openItem.height} />
          <span className="lms-lb-n lms-mono">{String(openIndex + 1).padStart(2, "0")} / {String(items.length).padStart(2, "0")} · {board.name}</span>
          <button type="button" className="lms-icon lms-lb-close" onClick={() => setOpenAt(null)} aria-label="Close the large view"><X size={16} /></button>
          {items.length > 1 ? (
            <>
              <button type="button" className="lms-lb-step" data-side="left" onClick={() => step(-1)} aria-label="Previous image"><ChevronLeft size={20} /></button>
              <button type="button" className="lms-lb-step" data-side="right" onClick={() => step(1)} aria-label="Next image"><ChevronRight size={20} /></button>
            </>
          ) : null}
          <MoodboardKeyHint className="lms-lb-keys" extra={[{ key: "← →", label: "Step" }, { key: "O", label: "Close" }]} />
        </div>
      ) : null}
    </div>
  );
}

const CSS = `
.lms{position:fixed;inset:0;z-index:80;display:grid;grid-template-rows:auto 1fr;background:var(--lm-paper);color:var(--lm-text-primary);font-family:var(--font-geist-sans),system-ui,sans-serif}
.lms-mono,.lms-kicker,.lms-hint,.lms-src span,.lms-src-group,.lms-chip,.lms-save{font-family:var(--font-geist-mono),ui-monospace,monospace}
.lms-bar{display:flex;align-items:center;gap:16px;padding:10px 16px;border-bottom:1px solid var(--lm-border-subtle)}
.lms-kicker{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}
.lms-hint{flex:1;font-size:10px;letter-spacing:.06em;color:var(--lm-text-ghost);text-transform:uppercase}
.lms-icon{display:grid;place-items:center;width:30px;height:30px;border-radius:999px;color:var(--lm-text-secondary)}
.lms-icon:hover{background:var(--lm-surface-1);color:var(--lm-text-primary)}
.lms-split{display:grid;grid-template-columns:minmax(0,1fr) 420px;min-height:0}
.lms-left{position:relative;overflow-y:auto;padding:14px 16px 90px;min-height:0}
.lms-sources{position:sticky;top:-14px;z-index:2;display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:-14px -16px 14px;padding:12px 16px;background:color-mix(in srgb,var(--lm-paper) 92%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--lm-border-subtle)}
.lms-src{display:inline-flex;align-items:center;gap:6px;padding:6px 11px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--lm-text-secondary);box-shadow:inset 0 0 0 1px var(--lm-border-strong)}
.lms-src span{font-size:10px;font-weight:500;color:var(--lm-text-ghost)}
.lms-src:hover{color:var(--lm-text-primary)}
.lms-src[aria-selected="true"]{background:var(--lm-ink);color:var(--lm-paper);box-shadow:none}
.lms-src[aria-selected="true"] span{color:inherit;opacity:.6}
.lms-src-group{margin-left:8px;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--lm-text-ghost)}
.lms-grid{columns:4 200px;column-gap:8px}
.lms-tile{position:relative;break-inside:avoid;margin-bottom:8px;border-radius:6px;overflow:hidden;cursor:grab;outline:none;background:var(--lm-surface-1)}
.lms-tile img{display:block;width:100%;height:auto}
.lms-tile:focus-visible{box-shadow:0 0 0 2px var(--lm-coral)}
.lms-tile[data-sel]{box-shadow:0 0 0 2px var(--lm-ink)}
.lms-tile[data-on] img{opacity:.45}
.lms-chip{position:absolute;right:6px;bottom:6px;display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:999px;font-size:9.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;background:rgba(10,8,5,.78);color:#FFF4EA}
.lms-chip.add{opacity:0;transition:opacity .15s}
.lms-tile:hover .lms-chip.add,.lms-tile:focus-visible .lms-chip.add{opacity:1}
.lms-check{position:absolute;left:6px;top:6px;display:grid;place-items:center;width:22px;height:22px;border-radius:999px;background:var(--lm-ink);color:var(--lm-paper)}
.lms-more{display:grid;place-items:center;height:40px;color:var(--lm-text-ghost)}
.lms-wait{display:grid;place-items:center;height:160px;color:var(--lm-text-ghost)}
.lms-empty{padding:40px 0;font-size:13px;color:var(--lm-text-tertiary)}
.lms-selbar{position:sticky;bottom:12px;z-index:3;display:flex;align-items:center;gap:10px;width:max-content;max-width:100%;margin:0 auto;padding:8px 10px 8px 16px;border-radius:999px;background:var(--lm-ink);color:var(--lm-paper);font-size:12px;font-weight:700;box-shadow:0 10px 30px rgba(0,0,0,.25)}
.lms-selbar .lms-btn{background:var(--lm-paper);color:var(--lm-ink)}
.lms-selbar .lms-btn.ghost{background:transparent;color:var(--lm-paper);box-shadow:inset 0 0 0 1px rgba(255,244,234,.3)}
.lms-selbar .lms-mono{font-size:10px;opacity:.7}
.lms-right{display:flex;flex-direction:column;gap:14px;min-height:0;overflow-y:auto;padding:14px 16px 40px;border-left:1px solid var(--lm-border-subtle);background:var(--lm-surface-1);transition:box-shadow .15s}
.lms-right[data-over]{box-shadow:inset 0 0 0 2px var(--lm-coral)}
.lms-switch{display:flex;align-items:center;gap:10px}
.lms-select,.lms-new input,.lms-new select{width:100%;min-width:0;padding:8px 10px;border-radius:8px;font-size:13px;font-weight:600;background:var(--lm-paper);color:var(--lm-text-primary);border:1px solid var(--lm-border-strong)}
.lms-save{display:inline-flex;align-items:center;gap:4px;flex:0 0 auto;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--lm-text-tertiary)}
.lms-head{display:grid;gap:6px}
.lms h2{margin:0;font-size:20px;font-weight:900;text-transform:uppercase;letter-spacing:-.01em;line-height:1.05}
.lms-dim{font-size:10.5px;color:var(--lm-text-tertiary)}
.lms-sync{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.lms-sync .lms-mono{font-size:10.5px;color:var(--lm-text-tertiary)}
.lms-sync[data-tone="ok"] .lms-mono{color:var(--lm-teal,#79B791)}
.lms-sync[data-tone="drift"] > .lms-mono:first-child{color:var(--lm-ember,#FF8C42)}
.lms-links{display:flex;flex-wrap:wrap;gap:12px}
.lms-link{display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--lm-text-secondary)}
.lms-link:hover{color:var(--lm-text-primary)}
.lms-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px 14px;border-radius:999px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;background:var(--lm-ink);color:var(--lm-paper)}
.lms-btn.small{padding:5px 10px;font-size:10px}
.lms-btn:disabled{opacity:.45;cursor:default}
.lms-drop{display:grid;place-items:center;min-height:220px;border:1.5px dashed var(--lm-border-strong);border-radius:10px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--lm-text-ghost)}
.lms-items{columns:2;column-gap:6px}
.lms-item{position:relative;break-inside:avoid;margin-bottom:6px;border-radius:5px;overflow:hidden;cursor:grab;background:var(--lm-paper)}
.lms-item img{display:block;width:100%;height:auto}
.lms-item[data-before]{box-shadow:0 -3px 0 0 var(--lm-coral)}
.lms-n{position:absolute;left:5px;top:5px;padding:1px 5px;border-radius:4px;font-size:9.5px;background:rgba(10,8,5,.7);color:#FFF4EA}
.lms-x{position:absolute;right:5px;top:5px;display:grid;place-items:center;width:22px;height:22px;border-radius:999px;background:rgba(10,8,5,.75);color:#FFF4EA;opacity:0;transition:opacity .15s}
.lms-item:hover .lms-x,.lms-x:focus-visible{opacity:1}
.lms-keys{position:sticky;bottom:0;align-self:center;margin-top:auto}
.lms-lb{position:fixed;inset:0;z-index:90;display:grid;place-items:center;padding:56px 72px 76px}
.lms-lb-bg{position:absolute;inset:0;background:color-mix(in srgb,var(--lm-paper) 94%,transparent);cursor:zoom-out}
.lms-lb img{position:relative;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;border-radius:6px;box-shadow:0 30px 80px rgba(0,0,0,.45)}
.lms-lb-n{position:absolute;left:20px;top:18px;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--lm-text-secondary)}
.lms-lb-close{position:absolute;right:14px;top:12px}
.lms-lb-step{position:absolute;top:50%;display:grid;place-items:center;width:44px;height:44px;margin-top:-22px;border-radius:999px;color:var(--lm-text-secondary)}
.lms-lb-step:hover{background:var(--lm-surface-1);color:var(--lm-text-primary)}
.lms-lb-step[data-side="left"]{left:14px}
.lms-lb-step[data-side="right"]{right:14px}
.lms-lb-keys{position:absolute;left:50%;bottom:20px;transform:translateX(-50%)}
.lms-new{display:grid;gap:12px}
.lms-new label{display:grid;gap:5px}
.lms-new .lms-mono{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--lm-text-tertiary)}
.lms-err{font-size:12px;color:var(--lm-coral)}
@media (max-width:860px){
  .lms-split{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr) minmax(0,45%)}
  .lms-right{border-left:0;border-top:1px solid var(--lm-border-subtle)}
  .lms-hint{display:none}
}
`;
