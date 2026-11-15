"use client";
/* eslint-disable @next/next/no-img-element -- this page is also served on another domain through a rewrite, so it uses plain <img> with srcset, never next/image. */

import { memo, useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import {
  mediaUrl, shortDate, srcSetOf, thumbAtLeast,
  type GridSize, type ReviewItem, type ReviewVersion, type Verdict,
} from "@/lib/review-client";
import { StyleVote, type StyleMark, type TileAction } from "./Grid";
import { Check, ChevronDown } from "./icons";
import { Floating, usePopover } from "./Floating";
import type { Person } from "./people";

// The style book (?mode=styles): every frame of the round grouped by style,
// across all folders, one "page" per style. Michael, 15 Nov 2026: "think of it
// as a PDF, a grid of images per style ... really minimize UI, just have the
// styles to compare". So: a thin top line, a sticky index of styles, then per
// style its name, count and (owner only) one quiet description line over a
// uniform grid of 16:9 cells. Tiles carry nothing but the picture; the place
// and code show on hover. Inside a style the frames run in folder order (the
// script order of places, then characters), so every style reads in the same
// place sequence and styles compare side by side. Print starts each style on
// a new sheet, so the browser's Print → PDF gives a clean style book.
//
// Tiles keep the grid's hooks (.rv-t[data-id], the hovered target, data-act),
// so every key, the open view, selection and the flashes work as elsewhere.

export type BookGroup = {
  key: string;
  title: string;
  styleId?: string;
  /** Owner only: the style is hidden from the director. */
  hidden?: boolean;
  /** Owner only: the style's one-line look. */
  line?: string;
  items: ReviewItem[];
};

type Props = {
  title: string;
  groups: BookGroup[];
  total: number;
  folderName: Map<string, string>;
  mediaBase: string;
  isOwner: boolean;
  canVote: boolean;
  archived: (assetId: string) => boolean;
  selected: Set<string>;
  size: GridSize;
  onSize: (size: GridSize) => void;
  modeSwitch: ReactNode;
  rounds: ReviewVersion[];
  shownId?: string;
  onRound: (version: ReviewVersion) => void;
  loading: boolean;
  targetRef: MutableRefObject<string | null>;
  onAct: (action: TileAction, assetId: string, tile: HTMLElement) => void;
  onOpen: (assetId: string) => void;
  onToggle: (assetId: string) => void;
  onRange: (assetId: string) => void;
  onClear: () => void;
  styleMarks: Map<string, StyleMark>;
  people: Map<string, Person>;
  onStyleVerdict?: (styleId: string, verdict: Verdict) => void;
};

/** Columns per density: wide screens, then up to 1100 px. Phones always show 2. */
const COLS = { s: 6, m: 4, l: 3 } as const;
const COLS_MID = { s: 5, m: 3, l: 2 } as const;
const sizesFor = (size: GridSize) =>
  `(max-width: 640px) calc((100vw - 36px) / 2), (max-width: 1100px) calc((100vw - 48px) / ${COLS_MID[size]}), calc((100vw - 64px) / ${COLS[size]})`;

// The first row loads at once (the first frame at high priority); the rest lazily.
const EAGER = 6;
const pad = (value: number) => String(value).padStart(2, "0");
const pageId = (key: string) => `rv-bk-${key}`;

export function StyleBook(props: Props) {
  const {
    title, groups, total, folderName, mediaBase, isOwner, canVote, archived, selected, size, onSize, modeSwitch,
    rounds, shownId, onRound, loading, targetRef, onAct, onOpen, onToggle, onRange, onClear, styleMarks, people, onStyleVerdict,
  } = props;
  const headRef = useRef<HTMLElement>(null);
  const indexRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(groups[0]?.key ?? "");
  const sizes = sizesFor(size);
  const styleCount = groups.filter((group) => group.styleId).length;

  // ---------------------------------------------------------- index: which style is on screen
  const groupsKey = groups.map((group) => group.key).join("|");
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = (headRef.current?.getBoundingClientRect().bottom ?? 0) + 24;
      let current = groups[0]?.key ?? "";
      for (const group of groups) {
        const top = document.getElementById(pageId(group.key))?.getBoundingClientRect().top;
        if (top === undefined || top > line) break;
        current = group.key;
      }
      // At the very bottom the last style is the one being read.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = groups[groups.length - 1]?.key ?? current;
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
    // groupsKey stands for groups: re-measure only when the pages change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupsKey]);

  // Keep the style being read in view in the index strip.
  useEffect(() => {
    const strip = indexRef.current;
    const node = strip?.querySelector<HTMLElement>(`[data-key="${active}"]`);
    if (!strip || !node) return;
    const left = node.offsetLeft - strip.clientWidth / 2 + node.offsetWidth / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [active]);

  const jump = useCallback((key: string) => {
    setActive(key);
    document.getElementById(pageId(key))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Print → PDF: lazy frames far down the book are not loaded yet; ask for all of them.
  useEffect(() => {
    const loadAll = () => {
      for (const image of document.querySelectorAll<HTMLImageElement>(".rv-bk img[loading='lazy']")) image.loading = "eager";
    };
    window.addEventListener("beforeprint", loadAll);
    return () => window.removeEventListener("beforeprint", loadAll);
  }, []);

  // ---------------------------------------------------------- pointer (delegated, as in the grid)
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
    const target = event.target as Element;
    const tile = target.closest<HTMLElement>("[data-id]");
    if (!tile) {
      if (!target.closest("button, a, input, [data-nodrag]")) onClear();
      return;
    }
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
  }, [onAct, onOpen, onRange, onToggle, onClear]);

  // ---------------------------------------------------------- rounds
  const [roundOpen, setRoundOpen, roundRef, roundPop] = usePopover();
  const shown = rounds.find((row) => row.id === shownId);
  const roundName = (row: ReviewVersion) => (
    <>
      {row.label}
      {row.isDraft ? <span className="st"> · Draft</span> : null}
    </>
  );

  let position = 0;
  return (
    <div className="rv-bk" data-size={size}>
      <header className="rv-bk-head" ref={headRef}>
        <div className="rv-bk-bar">
          <div className="rv-bk-title">
            <h1>{title}</h1>
            <span className="rv-bk-sum">{styleCount} {styleCount === 1 ? "style" : "styles"} · {total} {total === 1 ? "frame" : "frames"}</span>
          </div>
          <div className="rv-bk-tools">
            {shown ? (
              rounds.length > 1 ? (
                <button
                  type="button"
                  ref={roundRef}
                  className="rv-bk-round"
                  aria-haspopup="menu"
                  aria-expanded={roundOpen}
                  onClick={() => setRoundOpen(!roundOpen)}
                >
                  {roundName(shown)}
                  <ChevronDown size={11} />
                </button>
              ) : (
                <span className="rv-bk-round">{roundName(shown)}</span>
              )
            ) : null}
            {roundOpen ? (
              <Floating anchorRef={roundRef} popRef={roundPop} placement="bottom-end" role="menu" label="Rounds">
                <div className="rv-pop-h">Rounds</div>
                {[...rounds].reverse().map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={row.id === shownId}
                    className="rv-opt"
                    onClick={() => {
                      setRoundOpen(false);
                      if (row.id !== shownId) onRound(row);
                    }}
                  >
                    <span className="ck">{row.id === shownId ? <Check size={13} /> : null}</span>
                    {roundName(row)}
                    {row.title ? <span className="rv-bk-rt">{row.title}</span> : null}
                    <span className="r">{row.isDraft ? "only you" : row.isCurrent ? "current" : shortDate(row.publishedAt)}</span>
                  </button>
                ))}
              </Floating>
            ) : null}
            {modeSwitch}
            <div className="rv-size rv-bk-size" role="group" aria-label="Frame size">
              {(["s", "m", "l"] as GridSize[]).map((value) => (
                <button key={value} type="button" aria-pressed={size === value} onClick={() => onSize(value)} title={`${value.toUpperCase()} frames · keys − and +`}>
                  {value.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
        {groups.length > 1 ? (
          <nav className="rv-bk-index" ref={indexRef} aria-label="Styles">
            {groups.map((group) => (
              <button
                key={group.key}
                type="button"
                data-key={group.key}
                aria-current={active === group.key ? "true" : undefined}
                onClick={() => jump(group.key)}
              >
                {group.title}
                <span className="n">{group.items.length}</span>
              </button>
            ))}
          </nav>
        ) : null}
      </header>

      <main
        className="rv-bk-pages"
        data-loading={loading ? "" : undefined}
        onPointerOver={onPointerOver}
        onPointerLeave={onPointerLeave}
        onClick={onClick}
      >
        {groups.length > 0 ? (
          <div className="rv-bk-print" aria-hidden="true">
            <b>{title}</b>
            <span>Styles{shown ? ` · ${shown.label}` : ""} · {styleCount} {styleCount === 1 ? "style" : "styles"} · {total} {total === 1 ? "frame" : "frames"}</span>
          </div>
        ) : null}
        {groups.length === 0 ? (
          <div className="rv-empty">
            <b>No frames here yet</b>
            {shown ? `${shown.label} · nothing to compare` : "Nothing to compare"}
          </div>
        ) : null}
        {groups.map((group, page) => {
          const mark = group.styleId ? styleMarks.get(group.styleId) : undefined;
          return (
            <section key={group.key} id={pageId(group.key)} className="rv-bk-page" aria-label={group.title}>
              <div className="rv-bk-page-h">
                <div className="rv-bk-kick"><span className="pr">{title} · </span>{pad(page + 1)} / {pad(groups.length)}</div>
                <div className="rv-bk-name">
                  <h2>{group.title}</h2>
                  <span className="n">{group.items.length} {group.items.length === 1 ? "frame" : "frames"}</span>
                  {isOwner && group.hidden ? <span className="rv-bk-tag" title="The director does not see this style">hidden</span> : null}
                  {group.styleId ? (
                    <StyleVote styleId={group.styleId} label={group.title} mark={mark} people={people} onVote={canVote ? onStyleVerdict : undefined} />
                  ) : null}
                </div>
                {isOwner && group.line ? <p className="rv-bk-line" title={group.line}>{group.line}</p> : null}
              </div>
              <div className="rv-bk-grid">
                {group.items.map((item) => {
                  const at = position;
                  position += 1;
                  return (
                    <BookTile
                      key={`${group.key}-${item.id}`}
                      item={item}
                      mediaBase={mediaBase}
                      sizes={sizes}
                      eager={at < EAGER}
                      high={at === 0}
                      place={folderName.get(item.folderId) ?? ""}
                      archived={archived(item.assetId)}
                      selected={selected.has(item.assetId)}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}

type TileProps = {
  item: ReviewItem;
  mediaBase: string;
  sizes: string;
  eager: boolean;
  high: boolean;
  place: string;
  archived: boolean;
  selected: boolean;
};

const BookTile = memo(function BookTile({ item, mediaBase, sizes, eager, high, place, archived, selected }: TileProps) {
  const poster = thumbAtLeast(item.thumbs, 480);
  const [playing, setPlaying] = useState(false);
  const isVideo = item.kind === "video";
  return (
    <div
      className="rv-t rv-bk-t"
      data-id={item.assetId}
      data-sel={selected ? "" : undefined}
      data-arch={archived ? "" : undefined}
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
          alt={place ? `${place} · ${item.code}` : item.code}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={high ? "high" : undefined}
          decoding="async"
          draggable={false}
        />
      ) : null}
      {isVideo && playing && item.original ? (
        <video src={mediaUrl(mediaBase, item.original)} muted loop autoPlay playsInline preload="auto" />
      ) : null}
      {item.held ? (
        <button type="button" className="rv-bk-held" data-act="release" title="Held · only you see it. Click to release it into the round the director gets.">
          Held<span className="rel">Release</span>
        </button>
      ) : null}
      {archived ? <span className="rv-bk-held arch">Archived</span> : null}
      <div className="rv-bk-cap">
        <span className="pl">{place}</span>
        <button type="button" className="rv-code" data-act="copy" title="Copy this frame's code">{item.code}</button>
      </div>
      {selected ? (
        <span className="rv-bk-check">
          <Check size={12} />
        </span>
      ) : null}
    </div>
  );
});
