"use client";

/* eslint-disable @next/next/no-img-element -- deck frames are plain stacked
   layers over R2 URLs; next/image adds nothing here and fights the
   cross-frame transitions. */

import { useEffect, useRef, useState, type RefObject } from "react";
import { resolveLayoutKind } from "@/lib/masonry-layout";

/**
 * A pack in the grid is a deck: the frames of one prompt (and its variations)
 * stacked on each other. The front frame rotates on its own, the cards behind
 * it shuffle along, and a row of tabs across the top says where in the pack
 * you are. Hovering holds the deck still; a tab jumps straight to its frame.
 */

export type PackDeckFrame = {
  id: string;
  src: string;
  fullSrc: string;
  posterSrc?: string;
  prompt: string;
  kind?: "image" | "video";
  contentType?: string;
};

export const PACK_ROTATE_INTERVAL_MS = 3400;
// Past this many frames the tabs become slivers; one track + a counter reads
// better.
const MAX_TABS = 12;
// Only a few frames around the front one are mounted: the next one preloads a
// full interval ahead, the rest stay unfetched until the deck gets to them.
// Deepest first, so DOM order alone stacks them (no z-index to fight the
// card's own).
const BACK_LAYER_DEPTHS = [2, 1] as const;

const isVideoFrame = (frame: PackDeckFrame) =>
  resolveLayoutKind({ kind: frame.kind, contentType: frame.contentType }) ===
  "video";

// Deterministic 0–1 from the card id, so a screen of packs doesn't flip in
// lockstep but a given card always keeps the same rhythm.
const phaseFor = (id: string) => {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
};

export function usePackRotation({
  id,
  count,
  paused,
  reducedMotion,
  containerRef,
}: {
  id: string;
  count: number;
  paused: boolean;
  reducedMotion: boolean;
  containerRef: RefObject<HTMLElement | null>;
}) {
  const [index, setIndex] = useState(0);
  const [advanced, setAdvanced] = useState(false);
  const [visible, setVisible] = useState(false);
  const enabled = count > 1;

  // Off-screen decks (the grid mounts a margin of rows past the viewport)
  // hold still: nobody is watching, and every flip costs a decode. Keyed on
  // `enabled` too: a card becomes a deck when a second member streams in.
  useEffect(() => {
    const node = containerRef.current;
    // Without an observer the deck simply holds still.
    if (!enabled || !node || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(Boolean(entry?.isIntersecting)),
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [containerRef, enabled]);

  const safeIndex = count > 0 ? index % count : 0;
  const rotating = enabled && visible && !paused && !reducedMotion;
  const durationMs = advanced
    ? PACK_ROTATE_INTERVAL_MS
    : Math.round(PACK_ROTATE_INTERVAL_MS * (0.55 + 0.9 * phaseFor(id)));

  useEffect(() => {
    if (!rotating) return;
    const timer = window.setTimeout(() => {
      setAdvanced(true);
      setIndex((current) => (current + 1) % count);
    }, durationMs);
    return () => window.clearTimeout(timer);
  }, [count, durationMs, rotating, safeIndex]);

  return {
    index: safeIndex,
    rotating,
    durationMs,
    jumpTo: (next: number) => setIndex(((next % count) + count) % count),
  };
}

function DeckFrameMedia({
  frame,
  playing = false,
  eager = false,
  onLoad,
}: {
  frame: PackDeckFrame;
  playing?: boolean;
  eager?: boolean;
  onLoad?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const reportedRef = useRef<string | null>(null);
  const isVideo = isVideoFrame(frame);
  const still = isVideo ? frame.posterSrc : frame.src;
  // Load can be seen three ways (event, cached-complete check, video data);
  // the owner hears about each frame once.
  const reportLoad = () => {
    if (!onLoad || reportedRef.current === frame.id) return;
    reportedRef.current = frame.id;
    onLoad();
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [playing]);

  // A video with no poster, or one being played, needs the real element; a
  // still is enough for everything else.
  if (isVideo && (playing || !still)) {
    return (
      <video
        ref={videoRef}
        src={frame.fullSrc}
        poster={still}
        muted
        loop
        playsInline
        preload={playing ? "auto" : "metadata"}
        className="absolute inset-0 h-full w-full object-contain"
        style={{ backgroundColor: "var(--media-stage-bg)" }}
        onLoadedMetadata={(event) => {
          // Nudge off 0 so the browser paints the first frame as a poster.
          if (!still && event.currentTarget.currentTime === 0) {
            event.currentTarget.currentTime = 0.001;
          }
        }}
        onLoadedData={reportLoad}
      />
    );
  }

  return (
    <img
      src={still || frame.fullSrc}
      alt={frame.prompt}
      draggable={false}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={`absolute inset-0 h-full w-full ${isVideo ? "object-contain" : "object-cover"}`}
      style={isVideo ? { backgroundColor: "var(--media-stage-bg)" } : undefined}
      ref={(node) => {
        // Cached frames can finish before onLoad is wired up.
        if (node?.complete && node.naturalWidth > 0) reportLoad();
      }}
      onLoad={reportLoad}
      onError={reportLoad}
    />
  );
}

/**
 * The front card's media: the current frame, the one it just replaced (on its
 * way out), and the next one (preloading, invisible). Roles move between the
 * same keyed elements, so a flip is a CSS transition, not a remount.
 */
export function PackDeckMedia({
  frames,
  index,
  playing,
  eager,
  onCoverLoad,
}: {
  frames: PackDeckFrame[];
  index: number;
  playing: boolean;
  eager?: boolean;
  onCoverLoad?: () => void;
}) {
  const [trail, setTrail] = useState<{ active: number; previous: number | null }>(
    { active: index, previous: null },
  );
  if (trail.active !== index) {
    setTrail({ active: index, previous: trail.active });
  }

  const count = frames.length;
  const next = (index + 1) % count;
  const roles = new Map<number, "active" | "leaving" | "next">();
  roles.set(index, "active");
  if (trail.previous !== null && trail.previous !== index && trail.previous < count) {
    roles.set(trail.previous, "leaving");
  }
  if (!roles.has(next)) roles.set(next, "next");

  return (
    <div className="pack-deck-media absolute inset-0 overflow-hidden">
      {[...roles.entries()].map(([frameIndex, role]) => {
        const frame = frames[frameIndex]!;
        return (
          <div
            key={frame.id}
            className="pack-deck-frame absolute inset-0"
            data-role={role}
            aria-hidden={role !== "active"}
          >
            <DeckFrameMedia
              frame={frame}
              eager={eager && frameIndex === 0}
              playing={role === "active" && playing}
              onLoad={frameIndex === 0 ? onCoverLoad : undefined}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * The cards peeking out behind the front one. Rendered outside the card
 * itself (whose paint containment would clip them) as siblings in the tile.
 */
export function PackDeckLayers({
  frames,
  index,
}: {
  frames: PackDeckFrame[];
  index: number;
}) {
  const count = frames.length;
  return (
    <>
      {BACK_LAYER_DEPTHS.filter((depth) => depth < count).map((depth) => {
        const frame = frames[(index + depth) % count]!;
        const still = isVideoFrame(frame) ? frame.posterSrc : frame.src;
        return (
          <div
            key={depth}
            aria-hidden
            className="pack-deck-layer pointer-events-none absolute inset-0 overflow-hidden"
            data-depth={depth}
          >
            {still ? (
              <img
                key={frame.id}
                src={still}
                alt=""
                draggable={false}
                loading="lazy"
                decoding="async"
                className="pack-deck-layer-image h-full w-full object-cover"
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/** Carousel tabs across the top of the deck — one per frame. */
export function PackDeckTabs({
  count,
  index,
  rotating,
  durationMs,
  onJump,
}: {
  count: number;
  index: number;
  rotating: boolean;
  durationMs: number;
  onJump: (index: number) => void;
}) {
  const fillKey = `${index}:${rotating ? "run" : "hold"}`;
  const fillStyle: React.CSSProperties = rotating
    ? { animationDuration: `${durationMs}ms` }
    : { transform: "scaleX(1)" };

  if (count > MAX_TABS) {
    return (
      <div className="pack-deck-tabs pointer-events-none" data-compact="true">
        <span className="pack-deck-tab" aria-hidden>
          <span
            className="pack-deck-tab-fill"
            style={{ transform: `scaleX(${(index + 1) / count})` }}
          />
        </span>
        <span className="pack-deck-counter">
          {String(index + 1).padStart(2, "0")}/{String(count).padStart(2, "0")}
        </span>
      </div>
    );
  }

  return (
    <div
      className="pack-deck-tabs pointer-events-none"
      role="tablist"
      aria-label={`Pack of ${count}`}
    >
      {Array.from({ length: count }, (_, tabIndex) => (
        <button
          key={tabIndex}
          type="button"
          role="tab"
          aria-selected={tabIndex === index}
          aria-label={`Show ${tabIndex + 1} of ${count}`}
          className="pack-deck-tab-hit pointer-events-auto"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onJump(tabIndex);
          }}
        >
          <span className="pack-deck-tab">
            {tabIndex < index ? (
              <span className="pack-deck-tab-fill" style={{ transform: "scaleX(1)" }} />
            ) : tabIndex === index ? (
              <span
                key={fillKey}
                className="pack-deck-tab-fill"
                data-running={rotating ? "true" : undefined}
                style={fillStyle}
              />
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}
