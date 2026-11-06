"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WorldTile } from "./types";
import { layoutWall, type WallBox } from "./wall-layout";
import { InsertFrames, OFF_LABEL, useNearVisible } from "./world-insert";
import { claimPlayback, lowData } from "./playback";

// The wall. Every box is computed from aspect ratios (wall-layout.ts), but
// only the boxes within a few screens of the viewport mount: a thousand
// frames cost a thousand rectangles of arithmetic, not a thousand images.

const OVERSCAN_ABOVE = 900;
const OVERSCAN_BELOW = 1600;
// Ask for the next page this far before the end of the laid-out wall.
const PREFETCH_DISTANCE = 2400;
// An insert holds a sticky full-screen frame for this many screens of scroll.
const INSERT_SCREENS = 1.4;

export type WallOwnerState = {
  featured: (id: string) => boolean;
  archived: (id: string) => boolean;
  hero: (id: string) => boolean;
  /** Why the frame is off the public page (admin), with the owner's 2 key applied. */
  off: (id: string) => WorldTile["off"];
  flashId: string | null;
};

/** The viewport height, steady while a phone's address bar slides. */
const useSteadyViewportHeight = () => {
  // Read lazily: the wall lays out nothing until it has measured its width,
  // so the server value never reaches the markup.
  const [height, setHeight] = useState(() =>
    typeof window === "undefined" ? 800 : window.innerHeight,
  );
  useEffect(() => {
    let width = window.innerWidth;
    let current = window.innerHeight;
    const resize = () => {
      if (window.innerWidth !== width || Math.abs(window.innerHeight - current) > 150) {
        width = window.innerWidth;
        current = window.innerHeight;
        setHeight(current);
      }
    };
    window.addEventListener("resize", resize, { passive: true });
    return () => window.removeEventListener("resize", resize);
  }, []);
  return height;
};

export const WorldMasonry = memo(function WorldMasonry({
  tiles,
  inserts,
  complete,
  onOpen,
  onNearEnd,
  onIntent,
  owner,
  onRestore,
}: {
  tiles: WorldTile[];
  /** Hero inserts to cut into the wall, in order (the opening hero excluded). */
  inserts: Array<{ tiles: WorldTile[] }>;
  /** Every frame is loaded: the last chunk levels too. */
  complete: boolean;
  onOpen: (index: number) => void;
  onNearEnd: () => void;
  /** First pointer on a tile: warm up the lightbox chunk. */
  onIntent?: () => void;
  owner?: WallOwnerState;
  onRestore?: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [view, setView] = useState({ top: 0, bottom: 0 });
  const viewportHeight = useSteadyViewportHeight();

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const ratios = useMemo(() => tiles.map((tile) => tile.h / tile.w), [tiles]);
  const layout = useMemo(
    () =>
      layoutWall({
        ratios,
        inserts: inserts.length,
        width,
        gap: 4,
        insertHeight: Math.round(viewportHeight * INSERT_SCREENS),
        complete,
      }),
    [ratios, inserts.length, width, viewportHeight, complete],
  );

  // Which slice of the wall is near the screen.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const node = ref.current;
      if (!node) return;
      const top = -node.getBoundingClientRect().top;
      setView((current) => {
        const next = { top, bottom: top + window.innerHeight };
        // Re-render only after a meaningful scroll.
        return Math.abs(current.top - next.top) < 120 && current.bottom - current.top === next.bottom - next.top
          ? current
          : next;
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (view.bottom === 0) return;
    if (view.bottom > layout.height - PREFETCH_DISTANCE) onNearEnd();
  }, [layout.height, view.bottom, onNearEnd]);

  const lo = view.top - OVERSCAN_ABOVE;
  const hi = view.bottom + OVERSCAN_BELOW;
  const visible: WallBox[] = layout.boxes.filter((box) => box.y + box.h >= lo && box.y <= hi);
  const sizes = `${Math.round(layout.colW) || 400}px`;

  return (
    <div ref={ref} className="wp-grid" style={{ height: layout.height }}>
      {visible.map((box) => {
        if (box.kind === "insert") {
          const insert = inserts[box.insert];
          if (!insert) return null;
          return (
            <Cut
              key={`cut-${box.insert}-${insert.tiles.map((tile) => tile.id).join("-")}`}
              top={box.y}
              height={box.h}
              tiles={insert.tiles}
              owner={owner}
            />
          );
        }
        if (box.kind === "filler") {
          const source = tiles[box.source];
          if (!source) return null;
          return <Filler key={`filler-${box.x}-${box.y}`} box={box} tile={source} />;
        }
        const tile = tiles[box.index];
        return (
          <Tile
            key={tile.id}
            index={box.index}
            tile={tile}
            box={box}
            sizes={sizes}
            eager={box.index < 8}
            onOpen={onOpen}
            onIntent={onIntent}
            featured={owner?.featured(tile.id) ?? false}
            archived={owner?.archived(tile.id) ?? false}
            hero={owner?.hero(tile.id) ?? false}
            off={owner?.off(tile.id)}
            flash={owner?.flashId === tile.id}
            onRestore={onRestore}
          />
        );
      })}
    </div>
  );
});

// ------------------------------------------------------------------ cut

/** A full-screen insert in the wall: the frame pins for a screen and a half and pulls back slowly. */
function Cut({
  top,
  height,
  tiles,
  owner,
}: {
  top: number;
  height: number;
  tiles: WorldTile[];
  owner?: WallOwnerState;
}) {
  const { ref, near, visible } = useNearVisible<HTMLElement>();
  return (
    <section ref={ref} className="wp-cut" style={{ top, height }} aria-hidden>
      <div className="wp-cut-pin">
        <InsertFrames tiles={tiles} near={near} visible={visible} owner={owner} />
        <div className="wp-cut-shade" />
      </div>
    </section>
  );
}

// --------------------------------------------------------------- filler

/** Closes a column's last gap with a slow drifting detail of a neighbouring frame. */
const Filler = memo(function Filler({
  box,
  tile,
}: {
  box: { x: number; y: number; w: number; h: number };
  tile: WorldTile;
}) {
  // A stable, varied start point per filler, so neighbours never drift in step.
  const seed = (box.x * 7 + box.y * 13) % 100;
  return (
    <div
      className="wp-filler"
      aria-hidden
      style={{
        transform: `translate3d(${box.x}px, ${box.y}px, 0)`,
        width: box.w,
        height: box.h,
        ["--wp-drift-x" as string]: `${seed % 2 ? 50 - (seed % 30) : 50 + (seed % 30)}%`,
        ["--wp-drift-delay" as string]: `-${seed / 4}s`,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a crop of a frame already on screen; same cached thumb */}
      <img src={tile.src} srcSet={tile.srcSet} sizes={`${box.w * 2}px`} alt="" loading="lazy" decoding="async" draggable={false} />
    </div>
  );
});

// ----------------------------------------------------------------- tile

const coarsePointer = () =>
  typeof window !== "undefined" && window.matchMedia("(hover: none)").matches;

const Tile = memo(function Tile({
  index,
  tile,
  box,
  sizes,
  eager,
  onOpen,
  onIntent,
  featured,
  archived,
  hero,
  off,
  flash,
  onRestore,
}: {
  index: number;
  tile: WorldTile;
  box: { x: number; y: number; w: number; h: number };
  sizes: string;
  eager: boolean;
  onOpen: (index: number) => void;
  onIntent?: () => void;
  featured: boolean;
  archived: boolean;
  hero: boolean;
  off: WorldTile["off"];
  flash: boolean;
  onRestore?: (id: string) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  const [play, setPlay] = useState(false);
  const [playing, setPlaying] = useState(false);
  const node = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const isVideo = tile.kind === "video";

  // A clip plays muted while it is in view, on every device: the wall never
  // shows a still of a film. Save-Data and slow links keep the poster.
  useEffect(() => {
    if (!isVideo || !node.current || lowData()) return;
    const observer = new IntersectionObserver(
      ([entry]) => setPlay(entry.isIntersecting),
      { threshold: 0.2, rootMargin: coarsePointer() ? "-15% 0px -15% 0px" : "0px" },
    );
    observer.observe(node.current);
    return () => observer.disconnect();
  }, [isVideo]);

  useEffect(() => {
    const element = video.current;
    if (!play || !element || archived) return;
    const release = claimPlayback(() => {
      element.pause();
      setPlay(false);
    });
    void element.play().catch(() => {});
    return () => {
      release();
      element.pause();
    };
  }, [play, archived]);

  const onImg = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth) setLoaded(true);
  }, []);

  // Once a clip has been in view it keeps its element (paused off screen),
  // so scrolling back does not fetch it again.
  const [mounted, setMounted] = useState(false);
  if (play && !mounted) setMounted(true);

  return (
    <div
      ref={node}
      className="wp-tile"
      data-wp-id={tile.id}
      data-archived={archived || undefined}
      data-off={off || undefined}
      data-featured={featured || undefined}
      style={{
        transform: `translate3d(${box.x}px, ${box.y}px, 0)`,
        width: box.w,
        height: box.h,
        // A frame whose file fails stays out of sight rather than a dead block.
        visibility: broken ? "hidden" : undefined,
      }}
      onClick={() => (archived ? undefined : onOpen(index))}
      onDoubleClick={() => archived && onRestore?.(tile.id)}
      onPointerEnter={onIntent}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- R2 thumbs with their own srcset; next/image would re-encode them. */}
      <img
        ref={onImg}
        src={tile.src}
        srcSet={tile.srcSet}
        sizes={sizes}
        alt=""
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        draggable={false}
        data-loaded={loaded || undefined}
        onLoad={() => setLoaded(true)}
        onError={() => {
          setBroken(true);
          console.warn("world-page: frame failed to load", tile.id);
        }}
      />
      {isVideo && mounted && !archived && (
        <video
          ref={video}
          src={tile.full}
          muted
          loop
          playsInline
          preload="metadata"
          data-playing={playing || undefined}
          onPlaying={() => setPlaying(true)}
        />
      )}
      {(hero || off) && (
        <span className="wp-chips">
          {hero && <span className="wp-chip wp-chip-hero">Hero</span>}
          {off && <span className="wp-chip">{OFF_LABEL[off]}</span>}
        </span>
      )}
      {archived && (
        <span className="wp-tile-veil">Deleted · double-click or D to restore</span>
      )}
      {flash && <span className="wp-flash" aria-hidden />}
    </div>
  );
});
