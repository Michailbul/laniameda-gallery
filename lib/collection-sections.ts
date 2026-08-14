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

// Singular form for a card badge — the badge describes ONE piece, so it reads
// "Character", not "Characters".
const SECTION_BADGE_LABELS: Record<CollectionSectionKey, string> = {
  characters: "Character",
  locations: "Location",
  scenes: "Scene",
  inspirations: "Inspiration",
};

export const collectionSectionBadgeLabel = (key: CollectionSectionKey) =>
  SECTION_BADGE_LABELS[key];

// Statics tags are the ground truth for what a piece IS — Characters and
// Locations are TAGS, not root collections (the root duplicates were retired
// 2026-07-29). The section enum still says "stills" where the tag says
// "scene", so both spellings land on `scenes`.
const SECTION_KEY_BY_TAG: Record<string, CollectionSectionKey> = {
  character: "characters",
  characters: "characters",
  location: "locations",
  locations: "locations",
  scene: "scenes",
  scenes: "scenes",
  still: "scenes",
  stills: "scenes",
  inspiration: "inspirations",
  inspirations: "inspirations",
};

export const sectionKeyForTagName = (
  tagName: string | null | undefined,
): CollectionSectionKey | null => {
  const normalized = tagName?.trim().toLowerCase().replace(/^#+/, "");
  if (!normalized) return null;
  return SECTION_KEY_BY_TAG[normalized] ?? null;
};

export type CollectionAssetTypeTag =
  | "character"
  | "location"
  | "scene";

const ASSET_TYPE_TAG_BY_SECTION: Partial<Record<
  CollectionSectionKey,
  CollectionAssetTypeTag
>> = {
  characters: "character",
  locations: "location",
  scenes: "scene",
};

/**
 * A destination named Characters/Locations/Scenes already says what its
 * members are. This is the single inference rule used by upload and filing
 * surfaces so they never ask for the same classification twice.
 * `sectionKeyForTagName` keeps the older Stills project-section alias working.
 */
export const assetTypeTagForCollectionName = (
  collectionName: string | null | undefined,
): CollectionAssetTypeTag | null => {
  const section =
    normalizeCollectionSection(collectionName) ??
    sectionKeyForTagName(collectionName);
  return section ? ASSET_TYPE_TAG_BY_SECTION[section] ?? null : null;
};

export const resolveImpliedAssetTypeTag = (
  collectionNames: Iterable<string | null | undefined>,
): CollectionAssetTypeTag | null => {
  const implied = new Set<CollectionAssetTypeTag>();
  for (const name of collectionNames) {
    const tag = assetTypeTagForCollectionName(name);
    if (tag) implied.add(tag);
  }
  return implied.size === 1 ? Array.from(implied)[0] : null;
};

/**
 * Typed destinations replace any manually-entered type alias with their own
 * canonical singular tag. Other descriptive/style tags stay untouched.
 */
export const applyImpliedAssetTypeTag = (
  tagNames: Iterable<string>,
  impliedTag: CollectionAssetTypeTag | null,
) => {
  const tags = Array.from(tagNames);
  if (!impliedTag) return tags;
  return [
    ...tags.filter((tagName) => sectionKeyForTagName(tagName) === null),
    impliedTag,
  ];
};
