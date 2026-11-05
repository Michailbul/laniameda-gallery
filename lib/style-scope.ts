import { collectionGroupKey, groupChildCollections } from "./collection-groups";

// Styles as the parent of a world's shelves. A world (a root collection with
// children) may hold style branches: children in the "Styles" display group,
// e.g. DEAR ANNETE › Film · Live Action and 3D Animation. Its other children
// (Places, Cast, Moods…) are shelves that cut across every style. Choosing a
// style scopes the shelves to it, so a shelf never shows two styles at once.
// Everything here is membership only: a piece is in a style when it is a
// member of that style's branch collection.

export const STYLE_GROUP_KEY = "styles";

export const isStyleGroup = (group: string | null | undefined) =>
  collectionGroupKey(group) === STYLE_GROUP_KEY;

export type ScopeFolder = {
  _id: string;
  name: string;
  parentFolderId?: string | null;
  group?: string | null;
  sortOrder?: number | null;
  count?: number;
};

export type WorldStyleScope<T extends ScopeFolder> = {
  /** The root collection the active folder belongs to. */
  worldId: string;
  /** Style branches with pieces in them, in display order. */
  styles: T[];
  /** The world's other children: the shelves a style scopes. */
  shelves: T[];
  /** The active folder is the world root. */
  atWorldRoot: boolean;
  /** The active folder is one of the style branches. */
  atStyleBranch: boolean;
  /** The style in force: the open branch, or the remembered scope on a shelf. */
  activeStyleId: string | null;
};

/**
 * Resolves the style scope for the open collection. `rememberedStyle` is the
 * style the viewer last chose inside a world; it applies only on that world's
 * shelves (the world root itself always shows every style, and a style branch
 * is its own scope). Returns null outside a world or when the world has no
 * style branch with pieces in it.
 */
export function resolveWorldStyleScope<T extends ScopeFolder>({
  folders,
  activeFolderId,
  rememberedStyle,
}: {
  folders: readonly T[];
  activeFolderId: string | null | undefined;
  rememberedStyle?: { worldId: string; styleId: string } | null;
}): WorldStyleScope<T> | null {
  if (!activeFolderId) return null;
  const active = folders.find((folder) => folder._id === activeFolderId);
  if (!active) return null;
  const worldId = active.parentFolderId ?? active._id;
  const children = folders.filter((folder) => folder.parentFolderId === worldId);
  if (children.length === 0) return null;
  const { groups, ungrouped } = groupChildCollections(children);
  const styleGroup = groups.find((group) => group.key === STYLE_GROUP_KEY);
  // An empty branch (a merged style waiting to be deleted) is not a choice.
  const styles = (styleGroup?.members ?? []).filter(
    (folder) => folder.count === undefined || folder.count > 0,
  );
  if (styles.length === 0) return null;
  const shelves = [
    ...groups
      .filter((group) => group.key !== STYLE_GROUP_KEY)
      .flatMap((group) => group.members),
    ...ungrouped,
  ];
  const atWorldRoot = active._id === worldId;
  const atStyleBranch =
    !atWorldRoot && styles.some((style) => style._id === active._id);
  let activeStyleId: string | null = null;
  if (atStyleBranch) {
    activeStyleId = active._id;
  } else if (
    !atWorldRoot &&
    rememberedStyle?.worldId === worldId &&
    styles.some((style) => style._id === rememberedStyle.styleId)
  ) {
    activeStyleId = rememberedStyle.styleId;
  }
  return { worldId, styles, shelves, atWorldRoot, atStyleBranch, activeStyleId };
}

type MemberAsset = { folderId?: string | null; folderIds?: readonly string[] };

export const assetFolderIds = (asset: MemberAsset): readonly string[] =>
  asset.folderIds ?? (asset.folderId ? [asset.folderId] : []);

/** Keeps the pieces that are members of the style branch. */
export function filterAssetsToStyle<A extends MemberAsset>(
  assets: readonly A[],
  styleId: string | null | undefined,
): A[] {
  if (!styleId) return [...assets];
  return assets.filter((asset) => assetFolderIds(asset).includes(styleId));
}

export type StyleShelfStack<T, A> = {
  shelf: T;
  count: number;
  /** The shelf's first pieces in this style, newest first as loaded. */
  previews: A[];
};

/**
 * A style branch's view of the world's shelves: for every shelf, the branch
 * pieces filed on it. `assets` are the branch's members; shelves without any
 * are left out. Order follows `shelves`.
 */
export function buildStyleShelfStacks<T extends ScopeFolder, A extends MemberAsset>(
  shelves: readonly T[],
  assets: readonly A[],
  previewCount = 4,
): StyleShelfStack<T, A>[] {
  const byShelf = new Map<string, A[]>();
  const shelfIds = new Set(shelves.map((shelf) => shelf._id));
  for (const asset of assets) {
    for (const folderId of assetFolderIds(asset)) {
      if (!shelfIds.has(folderId)) continue;
      const members = byShelf.get(folderId) ?? [];
      members.push(asset);
      byShelf.set(folderId, members);
    }
  }
  return shelves.flatMap((shelf) => {
    const members = byShelf.get(shelf._id);
    if (!members || members.length === 0) return [];
    return [{ shelf, count: members.length, previews: members.slice(0, previewCount) }];
  });
}

/**
 * The folders view inside a world shows that world's children, not every
 * collection in the vault. Returns the world id to scope to, or null for the
 * full collections view (no open collection, or one with no children).
 */
export function resolveFoldersViewWorld<T extends ScopeFolder>(
  folders: readonly T[],
  activeFolderId: string | null | undefined,
): string | null {
  if (!activeFolderId) return null;
  const active = folders.find((folder) => folder._id === activeFolderId);
  if (!active) return null;
  const worldId = active.parentFolderId ?? active._id;
  return folders.some((folder) => folder.parentFolderId === worldId)
    ? worldId
    : null;
}
