export type GalleryAssetRecord = {
  _id: string;
  promptId?: string;
  thumbUrl?: string;
  url?: string;
  sourceUrl?: string;
  promptText?: string;
  fileName?: string;
  thumbWidth?: number;
  width?: number;
  thumbHeight?: number;
  height?: number;
  modelName?: string;
  pillar?: string;
  tagNames?: string[];
  createdAt: number;
  folderId?: string;
  isPublic?: boolean;
  isFeatured?: boolean;
  assetPackId?: string;
  packSlotIndex?: number;
};

export type GalleryEntryPreview = {
  id: string;
  src: string;
  fullSrc: string;
  prompt: string;
  width?: number;
  height?: number;
};

export type GalleryEntry = {
  id: string;
  packId?: string;
  src: string;
  fullSrc: string;
  prompt: string;
  author: string;
  likes: number;
  width?: number;
  height?: number;
  initiallyLoaded?: boolean;
  modelName?: string;
  pillar?: string;
  tagNames?: string[];
  sourceUrl?: string;
  createdAt?: number;
  folderId?: string;
  isPublic?: boolean;
  isFeatured?: boolean;
  packMemberCount?: number;
  previewImages: GalleryEntryPreview[];
};

type BuildGalleryEntriesArgs = {
  assets: GalleryAssetRecord[];
  hiddenAssetIds?: Set<string>;
  loadedAssetIds?: Set<string>;
  sortOrder: "newest" | "featured" | "popular";
};

const FALLBACK_SRC = "/placeholder.svg";

const toPreview = (asset: GalleryAssetRecord): GalleryEntryPreview => ({
  id: asset._id,
  src: asset.thumbUrl ?? asset.url ?? asset.sourceUrl ?? FALLBACK_SRC,
  fullSrc: asset.url ?? asset.sourceUrl ?? FALLBACK_SRC,
  prompt: asset.promptText ?? asset.fileName ?? "Untitled prompt",
  width: asset.thumbWidth ?? asset.width ?? undefined,
  height: asset.thumbHeight ?? asset.height ?? undefined,
});

const sortPackMembers = (
  left: GalleryAssetRecord,
  right: GalleryAssetRecord,
) => {
  if ((left.packSlotIndex ?? -1) !== (right.packSlotIndex ?? -1)) {
    return (left.packSlotIndex ?? Number.MAX_SAFE_INTEGER) -
      (right.packSlotIndex ?? Number.MAX_SAFE_INTEGER);
  }
  return right.createdAt - left.createdAt;
};

const buildEntry = (
  cover: GalleryAssetRecord,
  members: GalleryAssetRecord[],
  loadedAssetIds?: Set<string>,
): GalleryEntry => {
  const tagNames = Array.from(
    new Set(members.flatMap((member) => member.tagNames ?? [])),
  );

  return {
    id: cover._id,
    packId: cover.assetPackId ?? undefined,
    src: cover.thumbUrl ?? cover.url ?? cover.sourceUrl ?? FALLBACK_SRC,
    fullSrc: cover.url ?? cover.sourceUrl ?? FALLBACK_SRC,
    prompt: cover.promptText ?? cover.fileName ?? "Untitled prompt",
    author: "Agent",
    likes: 0,
    width: cover.thumbWidth ?? cover.width ?? undefined,
    height: cover.thumbHeight ?? cover.height ?? undefined,
    initiallyLoaded: loadedAssetIds?.has(cover._id) ?? false,
    modelName: cover.modelName ?? undefined,
    pillar: cover.pillar ?? undefined,
    tagNames,
    sourceUrl: cover.sourceUrl ?? undefined,
    createdAt: Math.max(...members.map((member) => member.createdAt)),
    folderId: cover.folderId ?? undefined,
    isPublic: cover.isPublic ?? false,
    isFeatured: cover.isFeatured ?? false,
    packMemberCount: members.length > 1 ? members.length : undefined,
    previewImages: members.map(toPreview),
  };
};

export const buildGalleryEntries = ({
  assets,
  hiddenAssetIds,
  loadedAssetIds,
  sortOrder,
}: BuildGalleryEntriesArgs): GalleryEntry[] => {
  const visibleAssets = assets.filter(
    (asset) => !hiddenAssetIds?.has(asset._id),
  );
  const packMembers = new Map<string, GalleryAssetRecord[]>();
  const standaloneEntries: GalleryEntry[] = [];

  for (const asset of visibleAssets) {
    const groupingKey = asset.assetPackId
      ? `pack:${asset.assetPackId}`
      : asset.promptId
        ? `prompt:${asset.promptId}`
        : null;

    if (!groupingKey) {
      standaloneEntries.push(buildEntry(asset, [asset], loadedAssetIds));
      continue;
    }

    const members = packMembers.get(groupingKey) ?? [];
    members.push(asset);
    packMembers.set(groupingKey, members);
  }

  const entries = [
    ...standaloneEntries,
    ...Array.from(packMembers.values()).map((members) => {
      const orderedMembers = [...members].sort(sortPackMembers);
      return buildEntry(orderedMembers[0]!, orderedMembers, loadedAssetIds);
    }),
  ];

  if (sortOrder === "featured") {
    entries.sort((left, right) => {
      const featuredDiff =
        Number(Boolean(right.isFeatured)) -
        Number(Boolean(left.isFeatured));
      if (featuredDiff !== 0) {
        return featuredDiff;
      }
      return (right.createdAt ?? 0) - (left.createdAt ?? 0);
    });
    return entries;
  }

  if (sortOrder === "popular") {
    entries.sort(
      (left, right) =>
        (right.tagNames?.length ?? 0) - (left.tagNames?.length ?? 0),
    );
    return entries;
  }

  entries.sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0));
  return entries;
};
