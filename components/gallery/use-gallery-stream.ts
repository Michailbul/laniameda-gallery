"use client";

import { useState } from "react";
import { appendGalleryEntries, reuseUnchangedEntries } from "@/lib/gallery-stream";
import type { GalleryEntry } from "@/lib/gallery-entries";

/** Pagination may extend a view, but must never reorder tiles already exposed.
 *  Entries whose content did not change keep their object identity, so a page
 *  append or a Convex re-emit re-renders only the cards that are new or changed. */
export function useGalleryStream(entries: GalleryEntry[], viewKey: string | null) {
  const [snapshot, setSnapshot] = useState({ viewKey, source: entries, ordered: entries });
  if (snapshot.viewKey !== viewKey || snapshot.source !== entries) {
    const merged = viewKey !== null && snapshot.viewKey === viewKey
      ? appendGalleryEntries(snapshot.ordered, entries)
      : entries;
    const ordered = reuseUnchangedEntries(snapshot.ordered, merged);
    setSnapshot({ viewKey, source: entries, ordered });
    return ordered;
  }
  return snapshot.ordered;
}
