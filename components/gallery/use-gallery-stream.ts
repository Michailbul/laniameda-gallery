"use client";

import { useState } from "react";
import { appendGalleryEntries } from "@/lib/gallery-stream";
import type { GalleryEntry } from "@/lib/gallery-entries";

/** Pagination may extend a view, but must never reorder tiles already exposed. */
export function useGalleryStream(entries: GalleryEntry[], viewKey: string | null) {
  const [snapshot, setSnapshot] = useState({ viewKey, source: entries, ordered: entries });
  if (snapshot.viewKey !== viewKey || snapshot.source !== entries) {
    const ordered = viewKey !== null && snapshot.viewKey === viewKey
      ? appendGalleryEntries(snapshot.ordered, entries)
      : entries;
    setSnapshot({ viewKey, source: entries, ordered });
    return ordered;
  }
  return snapshot.ordered;
}
