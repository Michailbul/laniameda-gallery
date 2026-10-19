import { compareCollectionSectionNames } from "./collection-sections";

// Display groups for child collections. A world's children read as Styles /
// Places / Cast / Design / Moods / Footage instead of one alphabetical run.
// The group is display text on the child (`folders.group`); `sortOrder`
// orders children inside their group and the groups themselves. Both are
// accepted on roots and ignored there.

export const COLLECTION_GROUP_MAX_LENGTH = 40;

export const normalizeCollectionGroup = (value: string | null | undefined) => {
  const group = value?.normalize("NFKC").trim().replace(/\s+/g, " ");
  return group ? group : undefined;
};

// Groups match case-insensitively: "Styles" and "styles" are one group.
export const collectionGroupKey = (value: string | null | undefined) =>
  normalizeCollectionGroup(value)?.toLowerCase();

type GroupedChild = {
  name: string;
  group?: string | null;
  sortOrder?: number | null;
};

const rank = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : Number.POSITIVE_INFINITY;

const compareRank = (left: number, right: number) =>
  left < right ? -1 : left > right ? 1 : 0;

export type CollectionGroupSection<T> = {
  key: string;
  label: string;
  members: T[];
};

/**
 * Splits children into display groups and the ungrouped rest. Groups come in
 * order of their smallest member sortOrder, then by group name; members by
 * sortOrder, then name. Ungrouped children keep today's order: sections first
 * (Characters, Locations, Scenes, Inspirations), then by name.
 */
export function groupChildCollections<T extends GroupedChild>(children: T[]) {
  const byName = (left: T, right: T) =>
    compareCollectionSectionNames(left.name, right.name);
  const bySortOrder = (left: T, right: T) =>
    compareRank(rank(left.sortOrder), rank(right.sortOrder)) || byName(left, right);

  const groups = new Map<string, T[]>();
  const ungrouped: T[] = [];
  for (const child of children) {
    const key = collectionGroupKey(child.group);
    if (!key) {
      ungrouped.push(child);
      continue;
    }
    const members = groups.get(key) ?? [];
    members.push(child);
    groups.set(key, members);
  }

  const sections: CollectionGroupSection<T>[] = [...groups.entries()]
    .map(([key, members]) => {
      const sorted = [...members].sort(bySortOrder);
      return {
        key,
        label: normalizeCollectionGroup(sorted[0]?.group) ?? key,
        members: sorted,
        first: Math.min(...sorted.map((member) => rank(member.sortOrder))),
      };
    })
    .sort(
      (left, right) =>
        compareRank(left.first, right.first) ||
        left.label.localeCompare(right.label),
    )
    .map(({ key, label, members }) => ({ key, label, members }));

  return { groups: sections, ungrouped: [...ungrouped].sort(byName) };
}

/**
 * Children in display order. With no group set this is exactly today's order;
 * otherwise grouped children lead, group by group, and ungrouped follow.
 */
export function orderChildCollections<T extends GroupedChild>(children: T[]): T[] {
  const { groups, ungrouped } = groupChildCollections(children);
  return [...groups.flatMap((group) => group.members), ...ungrouped];
}
