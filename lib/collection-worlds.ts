import { collectionGroupKey } from "./collection-groups";

// Worlds lead every collection list. A world is a root collection the owner
// marked with the display group "World" (the root's `group`, which nothing
// else reads on a root), or one already showcased as a public world. Everything
// else is a plain collection: shared shelves such as ART, LOVE or TECHNIQUES.

export const WORLD_GROUP = "World";

const WORLD_GROUP_KEYS = new Set(["world", "worlds"]);

type RootLike = {
  name: string;
  parentFolderId?: string | null;
  group?: string | null;
  showcased?: boolean | null;
  sortOrder?: number | null;
  pinnedAt?: number | null;
};

export const isWorldCollection = (folder: RootLike) =>
  !folder.parentFolderId &&
  (Boolean(folder.showcased) ||
    WORLD_GROUP_KEYS.has(collectionGroupKey(folder.group) ?? ""));

/** True when the world flag comes from the owner's mark, not from showcasing. */
export const isMarkedWorld = (folder: RootLike) =>
  !folder.parentFolderId &&
  WORLD_GROUP_KEYS.has(collectionGroupKey(folder.group) ?? "");

const rank = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : Number.POSITIVE_INFINITY;

/**
 * Root order everywhere: worlds first, then pinned, then sortOrder, then name.
 * Names compare without case so "Cars" sits among the capitalised roots.
 */
export const compareRootCollections = (left: RootLike, right: RootLike) => {
  const worldDelta =
    Number(isWorldCollection(right)) - Number(isWorldCollection(left));
  if (worldDelta !== 0) return worldDelta;
  const pinDelta = Number(Boolean(right.pinnedAt)) - Number(Boolean(left.pinnedAt));
  if (pinDelta !== 0) return pinDelta;
  const leftRank = rank(left.sortOrder);
  const rightRank = rank(right.sortOrder);
  if (leftRank !== rightRank) return leftRank < rightRank ? -1 : 1;
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
};

export const orderRootCollections = <T extends RootLike>(roots: T[]) =>
  [...roots].sort(compareRootCollections);

/** Splits roots into worlds and the rest, each in root order. */
export const partitionWorlds = <T extends RootLike>(roots: T[]) => {
  const ordered = orderRootCollections(roots);
  return {
    worlds: ordered.filter((root) => isWorldCollection(root)),
    collections: ordered.filter((root) => !isWorldCollection(root)),
  };
};

/** Case- and accent-insensitive name match for the collection search boxes. */
export const collectionNameMatches = (name: string, query: string) => {
  const needle = foldForSearch(query);
  if (!needle) return true;
  return foldForSearch(name).includes(needle);
};

const foldForSearch = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
