"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

// The desktop stack is a decision desk: evidence large on the left, the
// answers in a column on the right. Everything here sizes that evidence so
// each picture shows at its own aspect, as large as the desk allows, with no
// letterboxed box and no orphan row.

const DESKTOP = "(min-width: 768px)";
const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(DESKTOP);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
export const useDesktop = () =>
  useSyncExternalStore(subscribe, () => window.matchMedia(DESKTOP).matches, () => false);

export type Area = { w: number; h: number };

// The size of the element the callback ref is on, kept current by a
// ResizeObserver; the element may be remounted (cards are keyed).
export function useArea<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const [area, setArea] = useState<Area>({ w: 0, h: 0 });
  useEffect(() => {
    if (!node) return;
    const measure = (rect: { width: number; height: number }) =>
      setArea((current) => (current.w === rect.width && current.h === rect.height ? current : { w: rect.width, h: rect.height }));
    // Once on mount: a tab that has not painted yet (opened in the
    // background, or captured headless) gets no ResizeObserver callback.
    measure(node.getBoundingClientRect());
    const observer = new ResizeObserver((entries) => { if (entries[0]) measure(entries[0].contentRect); });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, area] as const;
}

type Sized = { width?: number; height?: number };
export const aspectOf = (asset: Sized, fallback = 1) => (asset.width && asset.height ? asset.width / asset.height : fallback);

const GRID_GAP = 12;
const MIN_TILE = 140;

/**
 * Columns and a tile width for a set of images on the desk: 1 image fills
 * the area, 2 sit side by side, more take 3 or 4 columns by count and shape.
 * The tile width is capped so the tallest image in the set fits the area's
 * height, which keeps a pair of portraits or one wide still from scrolling.
 */
export const fitGrid = (assets: Sized[], area: Area, gap = GRID_GAP) => {
  const count = assets.length;
  const ratios = assets.map((asset) => aspectOf(asset));
  const average = ratios.length ? ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length : 1;
  const narrowest = ratios.length ? Math.min(...ratios) : 1;
  let cols = count <= 1 ? 1 : count === 2 ? 2 : count === 3 ? 3 : count === 4 ? (average > 1.2 ? 2 : 4) : count <= 6 ? 3 : 4;
  if (count >= 9 && average < 0.8) cols = 5;
  const byWidth = (area.w - gap * (cols - 1)) / cols;
  const byHeight = Math.max(0, area.h) * narrowest;
  const tile = Math.max(MIN_TILE, Math.min(byWidth, byHeight));
  return { cols, tile, gap };
};

export const measured = (area: Area) => area.w > 0 && area.h > 0;
