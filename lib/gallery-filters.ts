export type GalleryScopeValue = "mine" | "public";

interface ResolveFolderFilterArgs {
  galleryScope: GalleryScopeValue;
  selectedFolderId: string | null;
  knownFolderIds?: Iterable<string> | null;
}

export function resolveScopeFolderFilter({
  galleryScope,
  selectedFolderId,
  knownFolderIds,
}: ResolveFolderFilterArgs): string | null {
  const normalizedFolderId = selectedFolderId?.trim() || null;
  if (!normalizedFolderId) {
    return null;
  }

  if (galleryScope !== "mine") {
    return null;
  }

  if (!knownFolderIds) {
    return normalizedFolderId;
  }

  const validIds = new Set(knownFolderIds);
  return validIds.has(normalizedFolderId) ? normalizedFolderId : null;
}

export function shouldShowFolderFilters(galleryScope: GalleryScopeValue): boolean {
  return galleryScope === "mine";
}
