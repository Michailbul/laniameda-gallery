"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WorldTile } from "./types";

// Windowed masonry. Every tile's box is computed from its aspect ratio
// (shortest column first), but only the tiles within a few screens of the
// viewport are mounted. A thousand frames cost a thousand rectangles of
// arithmetic, not a thousand images.

const OVERSCAN_ABOVE = 900;
const OVERSCAN_BELOW = 1600;
// Ask for the next page this far before the end of the laid-out grid.
const PREFETCH_DISTANCE = 2400;

// Few, large frames: a pitch, not a contact sheet. Phones get one column.
const columnsFor = (width: number) =>
  width < 640 ? 1 : width < 1200 ? 2 : width < 1800 ? 3 : 4;
// Every so often a landscape frame runs the full width, cropped to scope
// (2.39:1): the grid breathes like a cut instead of a wall of equal tiles.
const BAND_EVERY = 9;
const BAND_RATIO = 2.39;

type Box = { x: number; y: number; w: number; h: number; band?: boolean };

export type MasonryOwnerState = {
  featured: (id: string) => boolean;
  archived: (id: string) => boolean;
  flashId: string | null;
};

export const WorldMasonry = memo(function WorldMasonry({
  tiles,
  onOpen,
  onNearEnd,
  onIntent,
  owner,
  onRestore,
}: {
  tiles: WorldTile[];
  onOpen: (index: number) => void;
  onNearEnd: () => void;
  /** First pointer on a tile: warm up the lightbox chunk. */
  onIntent?: () => void;
  owner?: MasonryOwnerState;
  onRestore?: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [view, setView] = useState({ top: 0, bottom: 0 });
  const [hovering, setHovering] = useState(false);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const gap = width < 640 ? 2 : 3;
  const layout = useMemo(() => {
    if (!width) return { boxes: [] as Box[], height: 0, colW: 0 };
    const cols = columnsFor(width);
    const colW = (width - gap * (cols - 1)) / cols;
    const heights = new Array<number>(cols).fill(0);
    let sinceBand = 0;
    const last = new Array<number>(cols).fill(-1);
    const boxes: Box[] = [];
    // Level the columns above a band by stretching each column's last frame
    // (it is cropped by object-fit), so the band never sits under holes.
    // Only when every stretch stays small; otherwise the band waits.
    const levelFor = (target: number) => {
      for (let c = 0; c < cols; c++) {
        const short = target - heights[c];
        if (short <= 1) continue;
        if (last[c] < 0 || short > boxes[last[c]].h * 0.35) return false;
      }
      for (let c = 0; c < cols; c++) {
        const short = target - heights[c];
        if (short > 1) boxes[last[c]] = { ...boxes[last[c]], h: boxes[last[c]].h + Math.round(short) };
      }
      return true;
    };
    tiles.forEach((tile) => {
      sinceBand += 1;
      // Only a frame with the pixels for it runs full width.
      if (
        cols > 1 &&
        sinceBand >= BAND_EVERY &&
        tile.w / tile.h >= 1.6 &&
        tile.w >= width * 0.8 &&
        // Places only: a face or a shallow-focus scene goes soft at full
        // width; a city or a valley holds it.
        tile.section === "locations"
      ) {
        const y = Math.max(...heights);
        if (levelFor(y)) {
          sinceBand = 0;
          const h = Math.round(width / BAND_RATIO);
          heights.fill(y + h + gap);
          last.fill(-1);
          boxes.push({ x: 0, y, w: Math.round(width), h, band: true });
          return;
        }
      }
      let col = 0;
      for (let i = 1; i < cols; i++) if (heights[i] < heights[col] - 1) col = i;
      const ratio = Math.min(2.4, Math.max(0.3, tile.h / tile.w));
      const h = Math.round(colW * ratio);
      last[col] = boxes.length;
      boxes.push({ x: Math.round(col * (colW + gap)), y: heights[col], w: Math.round(colW), h });
      heights[col] += h + gap;
    });
    return { boxes, height: Math.max(0, ...heights) - gap, colW };
  }, [tiles, width, gap]);

  // Which slice of the grid is near the screen.
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
  const visible: number[] = [];
  layout.boxes.forEach((box, index) => {
    if (box.y + box.h >= lo && box.y <= hi) visible.push(index);
  });

  const sizes = `${Math.round(layout.colW) || 400}px`;
  return (
    <div
      ref={ref}
      className="wp-grid"
      style={{ height: layout.height }}
      data-hovering={hovering || undefined}
      onPointerOver={() => !hovering && setHovering(true)}
      onPointerLeave={() => setHovering(false)}
    >
      {visible.map((index) => {
        const tile = tiles[index];
        const box = layout.boxes[index];
        return (
          <Tile
            key={tile.id}
            index={index}
            tile={tile}
            box={box}
            sizes={box.band ? "100vw" : sizes}
            eager={index < 8}
            onOpen={onOpen}
            onIntent={onIntent}
            featured={owner?.featured(tile.id) ?? false}
            archived={owner?.archived(tile.id) ?? false}
            flash={owner?.flashId === tile.id}
            onRestore={onRestore}
          />
        );
      })}
    </div>
  );
});

const coarsePointer = () =>
  typeof window !== "undefined" && window.matchMedia("(hover: none)").matches;

// Phones: one tile film at a time, and none on Save-Data or a slow link.
let playingTile: ((stop: boolean) => void) | null = null;
const claimPlayback = (stop: (stop: boolean) => void) => {
  if (playingTile && playingTile !== stop) playingTile(true);
  playingTile = stop;
};
const lowData = () => {
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  return Boolean(connection?.saveData || /(^|-)(2g|3g)$/.test(connection?.effectiveType ?? ""));
};

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
  flash,
  onRestore,
}: {
  index: number;
  tile: WorldTile;
  box: Box;
  sizes: string;
  eager: boolean;
  onOpen: (index: number) => void;
  onIntent?: () => void;
  featured: boolean;
  archived: boolean;
  flash: boolean;
  onRestore?: (id: string) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  const [play, setPlay] = useState(false);
  const [playing, setPlaying] = useState(false);
  const node = useRef<HTMLDivElement>(null);
  const isVideo = tile.kind === "video";

  // Phones have no hover: a video plays while it holds the middle of the screen.
  useEffect(() => {
    if (!isVideo || !coarsePointer() || !node.current || lowData()) return;
    const stop = () => {
      setPlay(false);
      setPlaying(false);
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio > 0.7) {
          claimPlayback(stop);
          setPlay(true);
        } else stop();
      },
      { threshold: [0, 0.7, 1], rootMargin: "-20% 0px -20% 0px" },
    );
    observer.observe(node.current);
    return () => observer.disconnect();
  }, [isVideo]);

  const onImg = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth) setLoaded(true);
  }, []);

  return (
    <div
      ref={node}
      className="wp-tile"
      data-wp-id={tile.id}
      data-archived={archived || undefined}
      data-band={box.band || undefined}
      style={{
        transform: `translate3d(${box.x}px, ${box.y}px, 0)`,
        width: box.w,
        height: box.h,
        // A frame whose file fails stays out of sight rather than a dead block.
        visibility: broken ? "hidden" : undefined,
      }}
      onClick={() => (archived ? undefined : onOpen(index))}
      onDoubleClick={() => archived && onRestore?.(tile.id)}
      onPointerEnter={() => {
        onIntent?.();
        if (isVideo && !coarsePointer()) setPlay(true);
      }}
      onPointerLeave={() => {
        if (isVideo && !coarsePointer()) {
          setPlay(false);
          setPlaying(false);
        }
      }}
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
      {isVideo && play && !archived && (
        <video
          src={tile.full}
          muted
          loop
          playsInline
          autoPlay
          preload="none"
          data-playing={playing || undefined}
          onPlaying={() => setPlaying(true)}
        />
      )}
      {featured && <span className="wp-tile-star" aria-label="Featured" />}
      {archived && (
        <span className="wp-tile-veil wp-mono">Archived · double-click to restore</span>
      )}
      {flash && <span className="wp-flash" aria-hidden />}
    </div>
  );
});
