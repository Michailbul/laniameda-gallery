export type GalleryScopeValue = "mine" | "public";

interface ResolveGalleryScopeArgs {
  galleryScope: GalleryScopeValue;
  canAccessMyGallery: boolean;
}

interface ResolveFolderFilterArgs {
  galleryScope: GalleryScopeValue;
  selectedFolderId: string | null;
  knownFolderIds?: Iterable<string> | null;
}

export function resolveAccessibleGalleryScope({
  galleryScope,
  canAccessMyGallery,
}: ResolveGalleryScopeArgs): GalleryScopeValue {
  if (!canAccessMyGallery && galleryScope === "mine") {
    return "public";
  }

  return galleryScope;
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

  if (!knownFolderIds) {
    // Without an explicit allowlist, only "mine" may pass an arbitrary
    // folder id through. "public" must always be restricted to a curated,
    // known set of folder ids (see PUBLIC_COLLECTIONS on the backend) — it
    // never gets an unrestricted pass-through.
    return galleryScope === "mine" ? normalizedFolderId : null;
  }

  const validIds = new Set(knownFolderIds);
  return validIds.has(normalizedFolderId) ? normalizedFolderId : null;
}

export function shouldShowFolderFilters(galleryScope: GalleryScopeValue): boolean {
  return galleryScope === "mine";
}
