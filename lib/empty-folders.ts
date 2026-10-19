// Folders that just became empty, so the owner can be asked to delete them
// (no empty shelves or worlds left behind). A plain collection's load is its
// asset members plus its child collections; a folder "empties" when its load
// drops from above zero to zero while it still exists. Watching the counts
// rather than each delete path catches every way pieces leave: delete, move,
// remove from collection, or an agent filing them elsewhere. Folders that were
// already empty when the gallery opened are never offered.

export type LoadFolder = {
  _id: string;
  parentFolderId?: string | null;
  kind?: string | null;
};

/** Assets + child collections per plain collection. Storybooks are left out. */
export function folderLoads(
  folders: readonly LoadFolder[],
  assetCountById: ReadonlyMap<string, number>,
): Map<string, number> {
  const children = new Map<string, number>();
  for (const folder of folders) {
    if (folder.parentFolderId) {
      const parent = String(folder.parentFolderId);
      children.set(parent, (children.get(parent) ?? 0) + 1);
    }
  }
  const loads = new Map<string, number>();
  for (const folder of folders) {
    if (folder.kind) continue;
    const id = String(folder._id);
    loads.set(id, (assetCountById.get(id) ?? 0) + (children.get(id) ?? 0));
  }
  return loads;
}

/** Ids whose load went from above zero to zero between two snapshots. */
export function findEmptiedFolders(
  previous: ReadonlyMap<string, number> | null,
  next: ReadonlyMap<string, number>,
): string[] {
  if (!previous) return [];
  const emptied: string[] = [];
  for (const [id, load] of next) {
    if (load === 0 && (previous.get(id) ?? 0) > 0) emptied.push(id);
  }
  return emptied;
}
