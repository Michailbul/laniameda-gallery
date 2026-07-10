"use client";

/* eslint-disable @next/next/no-img-element -- tiny preview thumbs over an
   existing card; next/image adds no value for R2 URLs. */

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Hover-to-preview for direction stack cards: after `delayMs` of hovering,
 * cycle through the direction's option thumbs every `intervalMs` so the stack
 * can be skimmed without opening it. Leaving the card resets to the master.
 */
export function useStackHoverPreview(
  previewCount: number,
  { delayMs = 1000, intervalMs = 900 }: { delayMs?: number; intervalMs?: number } = {},
) {
  const [engaged, setEngaged] = useState(false);
  const [index, setIndex] = useState(0);
  const delayRef = useRef<number | null>(null);
  const cycleRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (delayRef.current !== null) {
      window.clearTimeout(delayRef.current);
      delayRef.current = null;
    }
    if (cycleRef.current !== null) {
      window.clearInterval(cycleRef.current);
      cycleRef.current = null;
    }
    setEngaged(false);
    setIndex(0);
  }, []);

  const start = useCallback(() => {
    if (previewCount < 2) return;
    if (delayRef.current !== null || cycleRef.current !== null) return;
    delayRef.current = window.setTimeout(() => {
      delayRef.current = null;
      setEngaged(true);
      cycleRef.current = window.setInterval(() => {
        setIndex((current) => (current + 1) % previewCount);
      }, intervalMs);
    }, delayMs);
  }, [previewCount, delayMs, intervalMs]);

  // Clear timers on unmount.
  useEffect(() => stop, [stop]);

  return { engaged, index, start, stop };
}

/**
 * The rotating thumbs, layered over the card's master media. Mounted only
 * once the hover engages, so idle cards cost nothing extra.
 */
export function StackHoverPreviewOverlay({
  previews,
  index,
  engaged,
}: {
  previews: string[];
  index: number;
  engaged: boolean;
}) {
  if (!engaged || previews.length < 2) return null;
  const active = index % previews.length;
  return (
    <>
      {previews.map((src, i) => (
        <img
          key={`${i}-${src}`}
          src={src}
          alt=""
          aria-hidden
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
          style={{ opacity: i === active ? 1 : 0 }}
        />
      ))}
    </>
  );
}
