// Perceptual hashes for "Group similar" and the duplicates routine.
//
// A difference hash (dHash): the image shrunk to 9×8 grey pixels, one bit
// per pair of horizontal neighbours (left brighter than right). 64 bits, kept
// as 16 hex characters. Near-identical images (the takes of one job, a
// re-save, a light repair) differ by a few bits; the same place or subject
// framed differently by more. Hamming distance is the measure.

export const DHASH_WIDTH = 9;
export const DHASH_HEIGHT = 8;

/** 72 grey values (row by row, 9 per row) → 16 hex characters. */
export const dHashFromGray = (gray: ArrayLike<number>) => {
  if (gray.length !== DHASH_WIDTH * DHASH_HEIGHT) throw new Error(`dHash needs ${DHASH_WIDTH * DHASH_HEIGHT} grey values.`);
  let hex = "";
  for (let row = 0; row < DHASH_HEIGHT; row += 1) {
    let byte = 0;
    for (let col = 0; col < 8; col += 1) {
      const left = gray[row * DHASH_WIDTH + col]!;
      const right = gray[row * DHASH_WIDTH + col + 1]!;
      byte = (byte << 1) | (left > right ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
};

export const isDHash = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{16}$/.test(value);

const popcount32 = (value: number) => {
  let v = value - ((value >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};

type Split = readonly [number, number];
const split = (hash: string): Split => [parseInt(hash.slice(0, 8), 16) >>> 0, parseInt(hash.slice(8, 16), 16) >>> 0];
const distanceOf = (a: Split, b: Split) => popcount32((a[0] ^ b[0]) >>> 0) + popcount32((a[1] ^ b[1]) >>> 0);

export const hammingDistance = (a: string, b: string) => distanceOf(split(a), split(b));

// The view's slider runs from tight (near-duplicates) to loose (same subject).
export const SIMILARITY_MIN_DISTANCE = 3;
export const SIMILARITY_MAX_DISTANCE = 20;
export const DEFAULT_SIMILARITY = 0.25;
export const similarityToDistance = (value: number) =>
  Math.round(SIMILARITY_MIN_DISTANCE + Math.min(1, Math.max(0, value)) * (SIMILARITY_MAX_DISTANCE - SIMILARITY_MIN_DISTANCE));

export type HashedItem = { id: string; hash: string };
export type SimilarCluster = { ids: string[]; maxDistance: number };

/**
 * Groups items whose hashes lie within `maxDistance` bits of each other
 * (single link: a chain of close pairs is one group). Groups of two or more
 * come back largest first; members keep the input order, so the view's own
 * sort holds inside a cluster. Items without a hash never group.
 */
export const clusterByHash = (items: readonly HashedItem[], maxDistance: number): SimilarCluster[] => {
  const hashed = items.filter((item) => isDHash(item.hash));
  const parts = hashed.map((item) => split(item.hash));
  const parent = hashed.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]!]!;
      index = parent[index]!;
    }
    return index;
  };
  const widest = new Map<number, number>();
  for (let i = 0; i < hashed.length; i += 1) {
    for (let j = i + 1; j < hashed.length; j += 1) {
      const distance = distanceOf(parts[i]!, parts[j]!);
      if (distance > maxDistance) continue;
      const a = find(i);
      const b = find(j);
      const root = Math.min(a, b);
      const merged = Math.max(distance, widest.get(a) ?? 0, widest.get(b) ?? 0);
      if (a !== b) parent[Math.max(a, b)] = root;
      widest.set(root, merged);
    }
  }
  const groups = new Map<number, string[]>();
  for (let index = 0; index < hashed.length; index += 1) {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), hashed[index]!.id]);
  }
  return [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([root, ids]) => ({ ids, maxDistance: widest.get(root) ?? 0 }))
    .sort((a, b) => b.ids.length - a.ids.length);
};
