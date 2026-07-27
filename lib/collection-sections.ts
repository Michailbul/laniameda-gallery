// Sub-collection SECTIONS (Characters / Locations / Scenes / Inspirations)
// — the sort/labeling system for a collection's sub-collections. Renamed
// from "collection pillars" 2026-07-27 to stop colliding with the retired
// pillar taxonomy. NOTE: the extension wire payload still sends the field
// `collectionPillar` (see app/api/extension/save) — renaming that requires
// a coordinated extension update, so the wire name is grandfathered.
export const COLLECTION_SECTIONS = [
  { key: "characters", label: "Characters" },
  { key: "locations", label: "Locations" },
  { key: "scenes", label: "Scenes" },
  { key: "inspirations", label: "Inspirations" },
] as const;

export type CollectionSectionKey = (typeof COLLECTION_SECTIONS)[number]["key"];

const COLLECTION_PILLAR_ORDER = new Map<string, number>(
  COLLECTION_SECTIONS.map((pillar, index) => [pillar.key, index]),
);

export const normalizeCollectionSection = (
  value: string | null | undefined,
): CollectionSectionKey | null => {
  const normalized = value?.trim().toLowerCase();
  return COLLECTION_SECTIONS.find((pillar) => pillar.key === normalized)?.key ?? null;
};

export const collectionSectionLabel = (key: CollectionSectionKey) =>
  COLLECTION_SECTIONS.find((pillar) => pillar.key === key)?.label ?? key;

export const collectionSectionRank = (name: string) =>
  COLLECTION_PILLAR_ORDER.get(name.trim().toLowerCase()) ??
  COLLECTION_SECTIONS.length;

export const compareCollectionSectionNames = (left: string, right: string) => {
  const rankDifference =
    collectionSectionRank(left) - collectionSectionRank(right);
  return rankDifference || left.localeCompare(right);
};
