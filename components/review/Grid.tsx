"use client";
/* eslint-disable @next/next/no-img-element -- this page is also served on another domain through a rewrite, so it uses plain <img> with srcset, never next/image. */

import { memo, useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { mediaUrl, srcSetOf, thumbAtLeast, type ReviewItem, type Verdict } from "@/lib/review-client";
import { Bubble, Check, ThumbDown, ThumbUp } from "./icons";

// The frames. Rows are justified in CSS (review.css, .rv-grid/.rv-t): every
// frame keeps its aspect ratio, a row shares one height, and the server
// render is already the final layout (no measuring, no shift). Events are
// delegated to the grid root: one listener set, memoised tiles.

export type GridGroup = {
  key: string;
  title?: string;
  kicker?: string;
  items: ReviewItem[];
};

export type TileMark = {
  verdict?: Verdict;
  mine?: Verdict;
  by?: string;
  comments: number;
  fresh: boolean;
};

export type TileAction = "like" | "dislike" | "comment" | "copy";

type GridProps = {
  groups: GridGroup[];
  marks: Map<string, TileMark>;
  selected: Set<string>;
  mediaBase: string;
  canVote: boolean;
  isOwner: boolean;
  size: "s" | "m" | "l";
  targetRef: MutableRefObject<string | null>;
  onAct: (action: TileAction, assetId: string, tile: HTMLElement) => void;
  onOpen: (assetId: string) => void;
  onToggle: (assetId: string) => void;
  onRange: (assetId: string) => void;
  onBox: (ids: Set<string>) => void;
  onClear: () => void;
  onSelectGroup?: (ids: string[]) => void;
};

const PER_ROW = { s: 5, m: 3, l: 2 } as const;
const PER_ROW_NARROW = { s: 3, m: 2, l: 1 } as const;
const SIDE = 312; // sidebar + content padding, in px

// Typical aspect ratio of a group (wide shots ~1.78, portraits ~0.67),
// kept between 1.2 and 2.4 so portrait folders get taller rows.
const baseRatio = (items: ReviewItem[]) => {
  if (items.length === 0) return 1.7778;
  const ratios = items.map((item) => item.width / Math.max(1, item.height)).sort((a, b) => a - b);
  const median = ratios[Math.floor(ratios.length / 2)]!;
  return Math.min(2.4, Math.max(1.2, median));
};

// How wide a tile is on screen, for the browser to pick a thumb.
const sizesFor = (ratio: number, base: number, size: GridProps["size"]) => {
  const share = ratio / base;
  const wide = Math.min(1, (share / PER_ROW[size]) * 1.08);
  const narrow = Math.min(1, (share / PER_ROW_NARROW[size]) * 1.08);
  return `(max-width: 900px) ${Math.round(narrow * 100)}vw, calc((100vw - ${SIDE}px) * ${wide.toFixed(3)})`;
};

// The first frames load at once (the first at high priority: it is the
// largest paint); the rest load lazily as they near the screen.
const EAGER = 2;
const HIGH = 1;
// Very large views render in steps so a click never waits on hundreds of tiles.
const STEP = 120;

export function Grid(props: GridProps) {
  const { groups, marks, selected, mediaBase, canVote, isOwner, size, targetRef, onAct, onOpen, onToggle, onRange, onBox, onClear, onSelectGroup } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  const [limit, setLimit] = useState(STEP);
  const groupsKey = groups.map((group) => `${group.key}:${group.items.length}`).join("|");
  const [limitKey, setLimitKey] = useState(groupsKey);
  if (limitKey !== groupsKey) {
    setLimitKey(groupsKey);
    setLimit(STEP);
  }
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = moreRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setLimit((value) => value + STEP);
    }, { rootMargin: "1200px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [limit, total]);

  // ------------------------------------------------------------ pointer

  const onPointerOver = useCallback((event: React.PointerEvent) => {
    const tile = (event.target as Element).closest<HTMLElement>("[data-id]");
    const id = tile?.dataset.id ?? null;
    if (id === targetRef.current) return;
    document.querySelector(".rv-t[data-active]")?.removeAttribute("data-active");
    targetRef.current = id;
  }, [targetRef]);

  const onPointerLeave = useCallback(() => {
    targetRef.current = null;
  }, [targetRef]);

  const onClick = useCallback((event: React.MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const target = event.target as Element;
    const tile = target.closest<HTMLElement>("[data-id]");
    if (!tile) return;
    const id = tile.dataset.id!;
    const action = target.closest<HTMLElement>("[data-act]")?.dataset.act as TileAction | undefined;
    if (action) {
      event.stopPropagation();
      onAct(action, id, tile);
      return;
    }
    if (event.metaKey || event.ctrlKey) onToggle(id);
    else if (event.shiftKey) onRange(id);
    else onOpen(id);
  }, [onAct, onOpen, onRange, onToggle]);

  // Box selection: drag from empty space, or Shift + drag from anywhere.
  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0 || event.pointerType === "touch") return;
    const target = event.target as Element;
    if (target.closest("button, a, input, textarea, select, [data-nodrag]")) return;
    const onTile = Boolean(target.closest("[data-id]"));
    if (onTile && !event.shiftKey) return;
    const root = rootRef.current;
    const box = boxRef.current;
    if (!root || !box) return;

    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const startX = event.pageX;
    const startY = event.pageY;
    let pointerX = event.clientX;
    let pointerY = event.clientY;
    let dragging = false;
    let frame = 0;
    let scrollFrame = 0;
    const base = additive ? new Set(selectedRef.current) : new Set<string>();
    const tiles = [...root.querySelectorAll<HTMLElement>("[data-id]")].map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        id: element.dataset.id!,
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY,
        right: rect.right + window.scrollX,
        bottom: rect.bottom + window.scrollY,
      };
    });

    const update = () => {
      frame = 0;
      const x = pointerX + window.scrollX;
      const y = pointerY + window.scrollY;
      const left = Math.min(startX, x);
      const right = Math.max(startX, x);
      const top = Math.min(startY, y);
      const bottom = Math.max(startY, y);
      box.style.display = "block";
      box.style.left = `${left - window.scrollX}px`;
      box.style.top = `${top - window.scrollY}px`;
      box.style.width = `${right - left}px`;
      box.style.height = `${bottom - top}px`;
      const next = new Set(base);
      for (const tile of tiles) {
        if (tile.right >= left && tile.left <= right && tile.bottom >= top && tile.top <= bottom) next.add(tile.id);
      }
      onBox(next);
    };

    const autoScroll = () => {
      scrollFrame = 0;
      if (!dragging) return;
      const edge = 56;
      let delta = 0;
      if (pointerY > window.innerHeight - edge) delta = Math.min(24, (pointerY - (window.innerHeight - edge)) / 2);
      else if (pointerY < edge + 70) delta = -Math.min(24, (edge + 70 - pointerY) / 2);
      if (delta !== 0) {
        window.scrollBy(0, delta);
        if (!frame) frame = requestAnimationFrame(update);
        scrollFrame = requestAnimationFrame(autoScroll);
      }
    };

    const move = (moveEvent: PointerEvent) => {
      pointerX = moveEvent.clientX;
      pointerY = moveEvent.clientY;
      if (!dragging) {
        if (Math.abs(moveEvent.pageX - startX) + Math.abs(moveEvent.pageY - startY) < 6) return;
        dragging = true;
        root.closest(".rv")?.setAttribute("data-dragging", "");
        window.getSelection()?.removeAllRanges();
      }
      if (!frame) frame = requestAnimationFrame(update);
      if (!scrollFrame) scrollFrame = requestAnimationFrame(autoScroll);
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (frame) cancelAnimationFrame(frame);
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
      box.style.display = "none";
      root.closest(".rv")?.removeAttribute("data-dragging");
      if (dragging) {
        suppressClick.current = true;
        window.setTimeout(() => { suppressClick.current = false; }, 0);
      } else if (!onTile && !additive) {
        onClear();
      }
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }, [onBox, onClear]);

  // ------------------------------------------------------------ render

  const sections: Array<{ group: GridGroup; base: number; items: Array<{ item: ReviewItem; position: number }> }> = [];
  let rendered = 0;
  for (const group of groups) {
    if (rendered >= limit) break;
    const items = group.items.slice(0, limit - rendered).map((item, offset) => ({ item, position: rendered + offset }));
    rendered += items.length;
    sections.push({ group, base: baseRatio(group.items), items });
  }

  return (
    <div
      ref={rootRef}
      className="rv-groups"
      onPointerOver={onPointerOver}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      {sections.map(({ group, base, items }) => (
        <section key={group.key} className="rv-sec">
          {group.title ? (
            <div className="rv-sec-h">
              <h3>{group.title}</h3>
              <span className="n">{group.items.length}</span>
              {group.kicker ? <span className="n">{group.kicker}</span> : null}
              <span className="line" />
              {onSelectGroup && canVote ? (
                <button type="button" onClick={() => onSelectGroup(group.items.map((item) => item.assetId))}>
                  Select
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="rv-grid" style={{ "--base": base.toFixed(4) } as React.CSSProperties}>
            {items.map(({ item, position }) => {
              const mark = marks.get(item.assetId);
              return (
                <Tile
                  key={item.id}
                  item={item}
                  mediaBase={mediaBase}
                  sizes={sizesFor(item.width / Math.max(1, item.height), base, size)}
                  eager={position < EAGER}
                  high={position < HIGH}
                  verdict={mark?.verdict}
                  mine={mark?.mine}
                  by={mark?.by}
                  comments={mark?.comments ?? 0}
                  fresh={mark?.fresh ?? false}
                  selected={selected.has(item.assetId)}
                  canVote={canVote}
                  isOwner={isOwner}
                />
              );
            })}
          </div>
        </section>
      ))}
      {rendered < total ? <div ref={moreRef} style={{ height: 1 }} /> : null}
      <div ref={boxRef} className="rv-box" />
    </div>
  );
}

type TileProps = {
  item: ReviewItem;
  mediaBase: string;
  sizes: string;
  eager: boolean;
  high: boolean;
  verdict?: Verdict;
  mine?: Verdict;
  by?: string;
  comments: number;
  fresh: boolean;
  selected: boolean;
  canVote: boolean;
  isOwner: boolean;
};

const Tile = memo(function Tile(props: TileProps) {
  const { item, mediaBase, sizes, eager, high, verdict, mine, by, comments, fresh, selected, canVote, isOwner } = props;
  const ratio = item.width / Math.max(1, item.height);
  const poster = thumbAtLeast(item.thumbs, 960);
  const [playing, setPlaying] = useState(false);
  const isVideo = item.kind === "video";

  return (
    <div
      className="rv-t"
      data-id={item.assetId}
      data-v={verdict}
      data-sel={selected ? "" : undefined}
      style={{ "--ar": ratio.toFixed(4) } as React.CSSProperties}
      onPointerEnter={isVideo ? () => setPlaying(true) : undefined}
      onPointerLeave={isVideo ? () => setPlaying(false) : undefined}
    >
      {poster ? (
        <img
          src={mediaUrl(mediaBase, poster.src)}
          srcSet={srcSetOf(mediaBase, item.thumbs)}
          sizes={sizes}
          width={item.width}
          height={item.height}
          alt={item.code}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={high ? "high" : undefined}
          decoding="async"
          draggable={false}
        />
      ) : null}
      {isVideo && playing && item.original ? (
        <video src={mediaUrl(mediaBase, item.original)} muted loop autoPlay playsInline preload="auto" />
      ) : null}

      <div className="rv-t-top">
        <button type="button" className="rv-chip rv-code" data-act="copy" title="Copy this frame's code">
          {item.code}
        </button>
        {item.isNew ? <span className="rv-chip new">New</span> : null}
      </div>

      <div className="rv-t-marks">
        {fresh ? <span className="rv-chip fresh" title="New feedback">New</span> : null}
        {isOwner && mine && mine !== verdict ? (
          <span className="rv-chip mine">{mine === "like" ? <ThumbUp /> : <ThumbDown />}You</span>
        ) : null}
        {verdict === "like" ? (
          <span className="rv-chip like">
            <ThumbUp />
            {isOwner ? by ?? "Liked" : "Liked"}
          </span>
        ) : null}
        {verdict === "dislike" ? (
          <span className="rv-chip dislike">
            <ThumbDown />
            {isOwner ? by ?? "Disliked" : "Disliked"}
          </span>
        ) : null}
        {comments > 0 ? (
          <span className="rv-chip">
            <Bubble />
            {comments}
          </span>
        ) : null}
        {selected ? (
          <span className="rv-t-check">
            <Check size={13} />
          </span>
        ) : null}
      </div>

      {canVote ? (
        <div className="rv-t-acts">
          <button type="button" className="rv-pill like" data-act="like" aria-pressed={mine === "like"} title="Like (1)">
            <ThumbUp />
            <span>{mine === "like" ? "Liked" : "Like"}</span>
          </button>
          <button type="button" className="rv-pill dislike" data-act="dislike" aria-pressed={mine === "dislike"} title="Dislike (2)">
            <ThumbDown />
            <span>{mine === "dislike" ? "Disliked" : "Dislike"}</span>
          </button>
          <button type="button" className="rv-pill" data-act="comment" title="Comment (C)">
            <Bubble />
            <span>Comment</span>
          </button>
        </div>
      ) : null}
    </div>
  );
});
