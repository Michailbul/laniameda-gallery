import { collectionNameMatches, partitionWorlds } from "./collection-worlds";
import { orderChildCollections } from "./collection-groups";

// The phone's browse sheet: the same Worlds › Shelves tree the desktop sidebar
// shows, plus the sections (Storybooks, Stories, …) the sidebar lists as
// items, both narrowed by one search box. Pure, so the shape is testable.

export type BrowseFolder = {
  _id: string;
  name: string;
  count?: number;
  parentFolderId?: string;
  group?: string | null;
  sortOrder?: number | null;
  showcased?: boolean;
  pinnedAt?: number;
  kind?: "storybook";
};

export type BrowseRoot<T extends BrowseFolder> = {
  folder: T;
  /** Grouped and ordered as the sidebar shows them. */
  children: T[];
  /** A search hit inside: the root opens on its matching shelves. */
  forcedOpen: boolean;
};

export type BrowseTree<T extends BrowseFolder> = {
  worlds: BrowseRoot<T>[];
  collections: BrowseRoot<T>[];
};

/**
 * Roots with their children, worlds first. With a query, a root stays when its
 * own name matches (all its shelves shown) or when a shelf matches (only the
 * matching shelves shown, opened).
 */
export function buildBrowseTree<T extends BrowseFolder>(folders: readonly T[], query = ""): BrowseTree<T> {
  const ids = new Set(folders.map((folder) => folder._id));
  const roots: T[] = [];
  const childrenByParent = new Map<string, T[]>();
  for (const folder of folders) {
    if (folder.parentFolderId && ids.has(folder.parentFolderId)) {
      const list = childrenByParent.get(folder.parentFolderId) ?? [];
      list.push(folder);
      childrenByParent.set(folder.parentFolderId, list);
    } else {
      roots.push(folder);
    }
  }
  const searching = query.trim().length > 0;
  const build = (list: T[]): BrowseRoot<T>[] =>
    list.flatMap((folder) => {
      const children = orderChildCollections(childrenByParent.get(folder._id) ?? []);
      if (!searching) return [{ folder, children, forcedOpen: false }];
      const rootMatch = collectionNameMatches(folder.name, query);
      const hits = children.filter((child) => collectionNameMatches(child.name, query));
      if (!rootMatch && hits.length === 0) return [];
      return [{ folder, children: hits.length > 0 ? hits : children, forcedOpen: hits.length > 0 }];
    });
  const { worlds, collections } = partitionWorlds(roots);
  return { worlds: build(worlds), collections: build(collections) };
}

export type BrowseSection = {
  key: string;
  label: string;
  /** One line under the label: what lives there. */
  hint: string;
  /** A real page (Decisions, Tasks, YouTube); otherwise the sheet calls onOpen. */
  href?: string;
  badge?: number;
  active?: boolean;
};

/** Sections whose label or hint carries the query; all of them without one. */
export const filterBrowseSections = <T extends BrowseSection>(sections: readonly T[], query: string) => {
  if (!query.trim()) return [...sections];
  return sections.filter((section) => collectionNameMatches(section.label, query) || collectionNameMatches(section.hint, query));
};

/** The count of places a query reaches, for the sheet's empty state. */
export const browseHitCount = <T extends BrowseFolder>(tree: BrowseTree<T>, sections: readonly BrowseSection[]) =>
  tree.worlds.length + tree.collections.length + sections.length;
