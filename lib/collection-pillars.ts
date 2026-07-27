export const COLLECTION_PILLARS = [
  { key: "characters", label: "Characters" },
  { key: "locations", label: "Locations" },
  { key: "scenes", label: "Scenes" },
  { key: "inspirations", label: "Inspirations" },
] as const;

export type CollectionPillarKey = (typeof COLLECTION_PILLARS)[number]["key"];

const COLLECTION_PILLAR_ORDER = new Map<string, number>(
  COLLECTION_PILLARS.map((pillar, index) => [pillar.key, index]),
);

export const normalizeCollectionPillar = (
  value: string | null | undefined,
): CollectionPillarKey | null => {
  const normalized = value?.trim().toLowerCase();
  return COLLECTION_PILLARS.find((pillar) => pillar.key === normalized)?.key ?? null;
};

export const collectionPillarLabel = (key: CollectionPillarKey) =>
  COLLECTION_PILLARS.find((pillar) => pillar.key === key)?.label ?? key;

export const collectionPillarRank = (name: string) =>
  COLLECTION_PILLAR_ORDER.get(name.trim().toLowerCase()) ??
  COLLECTION_PILLARS.length;

export const compareCollectionPillarNames = (left: string, right: string) => {
  const rankDifference =
    collectionPillarRank(left) - collectionPillarRank(right);
  return rankDifference || left.localeCompare(right);
};
