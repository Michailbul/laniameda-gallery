"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { WorldTile } from "./types";
import type { WallOwnerState } from "./world-masonry";
import { claimPlayback, lowData } from "./playback";

// The frames of one hero insert: one full bleed, two side by side, three tall
// panels. Used by the opening hero and by every cut in the wall. A film plays
// muted while the insert is on screen; a still gets its full-resolution file
// on large screens once it is near.

const sizesFor = (count: number) => (count >= 3 ? "34vw" : count === 2 ? "50vw" : "100vw");

/** Widest candidate in a srcset ("url 480w, url 5120w" → 5120). */
export const widestCandidate = (srcSet: string | undefined) =>
  Math.max(0, ...(srcSet ?? "").split(",").map((entry) => Number.parseInt(entry.trim().split(/\s+/)[1] ?? "", 10) || 0));

// A hero still with its 4K rendition picks it through the srcset (large and
// retina screens only). Without one, large screens swap the original in.
const HAS_HI_RES = 2560;

const wantsFullStill = () =>
  typeof window !== "undefined" &&
  window.innerWidth * Math.min(window.devicePixelRatio || 1, 2) > 1600 &&
  !lowData();

export const InsertFrames = memo(function InsertFrames({
  tiles,
  near,
  visible,
  priority = false,
  sound = false,
  owner,
}: {
  tiles: WorldTile[];
  /** Close to the screen: attach films and full-res stills. */
  near: boolean;
  /** On screen: films play. */
  visible: boolean;
  /** The opening hero: its poster is the first paint. */
  priority?: boolean;
  sound?: boolean;
  owner?: WallOwnerState;
}) {
  return (
    <div className="wp-frames" data-count={tiles.length}>
      {tiles.map((tile) => (
        <InsertFrame
          key={tile.id}
          tile={tile}
          sizes={sizesFor(tiles.length)}
          near={near}
          visible={visible}
          priority={priority}
          sound={sound && tiles.length === 1}
          owner={owner}
        />
      ))}
    </div>
  );
});

function InsertFrame({
  tile,
  sizes,
  near,
  visible,
  priority,
  sound,
  owner,
}: {
  tile: WorldTile;
  sizes: string;
  near: boolean;
  visible: boolean;
  priority: boolean;
  sound: boolean;
  owner?: WallOwnerState;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [fullReady, setFullReady] = useState(false);
  const isVideo = tile.kind === "video";
  // Attach the film (or the full still) once near; never on Save-Data.
  // `near` is false on the server and on first paint, so window reads are safe.
  const src = isVideo && near && !lowData() ? tile.full : undefined;
  const wantFull =
    !isVideo &&
    near &&
    tile.full !== tile.src &&
    widestCandidate(tile.srcSet) < HAS_HI_RES &&
    wantsFullStill();

  useEffect(() => {
    const node = video.current;
    if (!node || !src) return;
    node.muted = !sound;
    if (!visible) {
      node.pause();
      return;
    }
    const release = claimPlayback(() => node.pause(), true);
    void node.play().catch(() => {});
    return release;
  }, [src, visible, sound]);

  const hero = owner?.hero(tile.id) ?? false;
  const off = owner?.off(tile.id);
  return (
    <div className="wp-frame" data-wp-id={tile.id} data-off={off || undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element -- R2 thumbs with their own srcset; next/image would re-encode them. */}
      <img
        src={tile.src}
        srcSet={tile.srcSet}
        sizes={sizes}
        alt=""
        draggable={false}
        decoding="async"
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
      />
      {wantFull && (
        // eslint-disable-next-line @next/next/no-img-element -- the original, only on large screens once near
        <img
          className="wp-frame-full"
          src={tile.full}
          alt=""
          draggable={false}
          decoding="async"
          data-ready={fullReady || undefined}
          onLoad={() => setFullReady(true)}
        />
      )}
      {isVideo && src && (
        <video
          ref={video}
          src={src}
          muted
          loop
          playsInline
          preload="metadata"
          data-playing={playing || undefined}
          onPlaying={() => setPlaying(true)}
        />
      )}
      {owner && (hero || off) && (
        <span className="wp-chips">
          {hero && <span className="wp-chip wp-chip-hero">Hero</span>}
          {off && <span className="wp-chip">{OFF_LABEL[off]}</span>}
        </span>
      )}
      {owner?.flashId === tile.id && <span className="wp-flash" aria-hidden />}
    </div>
  );
}

export const OFF_LABEL: Record<NonNullable<WorldTile["off"]>, string> = {
  hidden: "Dropped",
  private: "Private",
  letterboxed: "Letterboxed",
};

/** Near (1.5 screens) and on-screen flags for one element. */
export function useNearVisible<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const nearObserver = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setNear(true),
      { rootMargin: "150% 0px" },
    );
    const visibleObserver = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting),
    );
    nearObserver.observe(node);
    visibleObserver.observe(node);
    return () => {
      nearObserver.disconnect();
      visibleObserver.disconnect();
    };
  }, []);
  return { ref, near, visible };
}
