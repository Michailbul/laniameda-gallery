type DatedEntry = { createdAt?: number };
type StreamEntry = { id: string; packId?: string };

/** Skills must not expose dates that a later asset page can still fill. */
export function reachedGalleryInserts<T extends DatedEntry>(
  inserts: T[],
  assets: DatedEntry[],
  exhausted: boolean,
  chronological = true,
): T[] {
  if (exhausted) return inserts;
  // Collection cursors walk membership dates, not the assets' creation dates.
  if (!chronological || assets.length === 0) return [];
  const frontier = Math.min(...assets.map((asset) => asset.createdAt ?? 0));
  // Equal timestamps may straddle pages: hold those skills until we pass them.
  return inserts.filter((insert) => (insert.createdAt ?? 0) > frontier);
}

/** Keep published tiles in place; update their data and append newly reached tiles. */
export function appendGalleryEntries<T extends StreamEntry>(previous: T[], incoming: T[]): T[] {
  const key = (entry: T) => entry.packId ? `pack:${entry.packId}` : entry.id;
  const pending = new Map(incoming.map((entry) => [key(entry), entry]));
  const ordered: T[] = [];
  for (const entry of previous) {
    const id = key(entry);
    const current = pending.get(id);
    if (current) ordered.push(current);
    pending.delete(id);
  }
  return [...ordered, ...pending.values()];
}
