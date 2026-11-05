"use client";

import { useSyncExternalStore } from "react";

/**
 * Which layout the viewport is in: "desktop" from 768 px (Tailwind `md`),
 * "phone" below it. Lets a surface mount only the variant on screen instead of
 * rendering both and hiding one with `hidden md:block` / `md:hidden`, which
 * still costs the hidden copy's whole React render on every update.
 *
 * Returns null on the server and during hydration, where the viewport is
 * unknown: callers then mount both variants (their CSS classes still pick the
 * visible one), so the server HTML and the first client render match.
 */
export type Breakpoint = "desktop" | "phone";

const DESKTOP_QUERY = "(min-width: 768px)";

let desktopQuery: MediaQueryList | null = null;
const query = () => (desktopQuery ??= window.matchMedia(DESKTOP_QUERY));

const subscribe = (onChange: () => void) => {
  const media = query();
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
const getSnapshot = (): Breakpoint => (query().matches ? "desktop" : "phone");
const getServerSnapshot = (): Breakpoint | null => null;

export function useBreakpoint(): Breakpoint | null {
  return useSyncExternalStore<Breakpoint | null>(subscribe, getSnapshot, getServerSnapshot);
}
