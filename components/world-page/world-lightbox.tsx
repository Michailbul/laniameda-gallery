"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { WorldTile } from "./types";
import "./world-lightbox.css";

// Full-resolution view of one frame. The grid thumbnail shows at once and the
// original swaps in over it when it has loaded. Arrows, swipe, Escape. Loaded
// on first intent, so the grid ships without it.
export default function WorldLightbox({
  tiles,
  index,
  onIndex,
  onClose,
}: {
  tiles: WorldTile[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const tile = tiles[index];
  // Phones get the 1440 px rendition: an original can be a 5 MB PNG.
  const [wide] = useState(() => window.matchMedia("(min-width: 1000px)").matches);
  const [fullReady, setFullReady] = useState<string | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus({ preventScroll: true });
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = overflow;
      previous?.focus?.({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight") onIndex(Math.min(tiles.length - 1, index + 1));
      else if (event.key === "ArrowLeft") onIndex(Math.max(0, index - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, tiles.length, onClose, onIndex]);

  // Warm the neighbours' originals so the next arrow lands sharp.
  useEffect(() => {
    if (!wide) return;
    for (const neighbour of [tiles[index + 1], tiles[index - 1]]) {
      if (neighbour?.kind === "image") new Image().src = neighbour.full;
    }
  }, [index, tiles, wide]);

  if (!tile) return null;
  const sharp = fullReady === tile.full;

  return createPortal(
    <div
      className="wpl"
      role="dialog"
      aria-modal="true"
      aria-label="Frame"
      data-wp-lightbox={tile.id}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onTouchStart={(event) => {
        const t = event.touches[0];
        touch.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(event) => {
        const start = touch.current;
        touch.current = null;
        if (!start) return;
        const t = event.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (Math.abs(dy) > 90 && Math.abs(dy) > Math.abs(dx)) onClose();
        else if (dx < -50) onIndex(Math.min(tiles.length - 1, index + 1));
        else if (dx > 50) onIndex(Math.max(0, index - 1));
      }}
    >
      <div className="wpl-stage" key={tile.id}>
        {tile.kind === "video" ? (
          <video
            className="wpl-media"
            src={tile.full}
            poster={tile.src}
            controls
            autoPlay
            playsInline
            loop
            style={{ aspectRatio: `${tile.w} / ${tile.h}` }}
          />
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- grid thumb as the instant placeholder */}
            <img
              className="wpl-media"
              src={tile.src}
              alt=""
              // Hidden once the original is in: the two can differ by a pixel
              // and the placeholder would show as a faint edge.
              style={{ aspectRatio: `${tile.w} / ${tile.h}`, visibility: sharp ? "hidden" : undefined }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element -- the original file, full resolution */}
            {wide && <img
              className="wpl-media wpl-full"
              src={tile.full}
              alt=""
              data-ready={sharp || undefined}
              onLoad={() => setFullReady(tile.full)}
              style={{ aspectRatio: `${tile.w} / ${tile.h}` }}
            />}
          </>
        )}
      </div>
      <div className="wpl-chrome">
        <button ref={closeRef} type="button" className="wpl-close" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="wpl-credit" aria-live="polite">
        <span className="wpl-lozenge" aria-hidden />
        {String(index + 1).padStart(3, "0")} / {String(tiles.length).padStart(3, "0")}
      </p>
      {index > 0 && (
        <button
          type="button"
          className="wpl-nav wpl-prev"
          aria-label="Previous frame"
          onClick={() => onIndex(index - 1)}
        />
      )}
      {index < tiles.length - 1 && (
        <button
          type="button"
          className="wpl-nav wpl-next"
          aria-label="Next frame"
          onClick={() => onIndex(index + 1)}
        />
      )}
    </div>,
    document.body,
  );
}
