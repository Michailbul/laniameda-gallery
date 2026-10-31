"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

// The markdown chain (react-markdown, remark-gfm, micromark: ~150 KB) loads
// as its own chunk. Pages that show prose only behind a tap (the Review
// wall's Details, a task's timeline) use this and preload it when idle, so
// the first load stays light and the prose is ready before the tap.

const loadProse = () => import("./world-doc-prose").then((m) => m.WorldDocProse);

export const LazyWorldDocProse = dynamic(() => import("./world-doc-prose").then((m) => m.WorldDocProse), { ssr: false });

/** Fetches the markdown chunk once the page is idle. */
export function usePreloadWorldDocProse() {
  useEffect(() => {
    const run = () => void loadProse().catch(() => {});
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(run, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(run, 1500);
    return () => clearTimeout(id);
  }, []);
}
