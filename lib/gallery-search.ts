type SearchableAsset = {
  name?: string; description?: string; agentDescription?: string; promptText?: string;
  fileName?: string; sourceUrl?: string; tagNames?: string[];
  bookmark?: { text?: string; authorName?: string; authorHandle?: string; userNote?: string; quotedPost?: { text?: string } };
};

/** Plain substring search, shared by scoped agent listing paths. */
export const galleryAssetSearchText = (asset: SearchableAsset) => [
  asset.name, asset.description, asset.agentDescription, asset.promptText,
  asset.fileName, asset.sourceUrl, ...(asset.tagNames ?? []),
  asset.bookmark?.text, asset.bookmark?.authorName, asset.bookmark?.authorHandle,
  asset.bookmark?.userNote, asset.bookmark?.quotedPost?.text,
].filter(Boolean).join("\n").toLowerCase();
