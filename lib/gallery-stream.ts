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

/** Fields that only matter when a card mounts. A card that loaded since the
 *  last build flips `initiallyLoaded`, and that alone must not hand every
 *  mounted card a new object on the next page append. */
const MOUNT_ONLY_FIELDS = new Set(["initiallyLoaded"]);

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!sameValue(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    if (!sameValue(left[key], right[key])) return false;
  }
  return true;
}

function sameEntry(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (MOUNT_ONLY_FIELDS.has(key)) continue;
    if (!sameValue(a[key], b[key])) return false;
  }
  return true;
}

/**
 * Hand back the previous object for every entry whose content did not change,
 * and the previous array when nothing did. Entries are rebuilt from scratch on
 * every page append and every Convex re-emit; without this, each tile's
 * `image` prop gets a new identity and every memoised card re-renders. A
 * changed entry (like, star, tags, folders, thumbs, badges) still gets its new
 * object, so realtime updates reach the card.
 */
export function reuseUnchangedEntries<T extends { id: string }>(previous: T[], next: T[]): T[] {
  if (previous === next || previous.length === 0) return next;
  const byId = new Map(previous.map((entry) => [entry.id, entry]));
  let unchanged = previous.length === next.length;
  const kept = next.map((entry, index) => {
    const prior = byId.get(entry.id);
    const result =
      prior && prior !== entry &&
      sameEntry(prior as unknown as Record<string, unknown>, entry as unknown as Record<string, unknown>)
        ? prior
        : entry;
    if (result !== previous[index]) unchanged = false;
    return result;
  });
  return unchanged ? previous : kept;
}
