export type CinemaMetadata = {
  movieTitle: string;
  director?: string;
  year?: number;
  scene?: string;
  timecode?: string;
  cinematographer?: string;
  lens?: string;
  aperture?: string;
  composition?: string;
  lighting?: string;
  cameraMovement?: string;
  colorPalette?: string;
  mood?: string;
  agentDescription?: string;
};

export type GalleryAssetRecord = {
  _id: string;
  kind?: "image" | "video";
  contentType?: string;
  promptId?: string;
  designInspirationId?: string;
  thumbUrl?: string;
  url?: string;
  sourceUrl?: string;
  description?: string;
  promptText?: string;
  fileName?: string;
  thumbWidth?: number;
  width?: number;
  thumbHeight?: number;
  height?: number;
  modelName?: string;
  pillar?: string;
  generationType?: string;
  assetRole?: string;
  ingestSource?: string;
  tagNames?: string[];
  createdAt: number;
  folderId?: string;
  isPublic?: boolean;
  isFeatured?: boolean;
  assetPackId?: string;
  packSlotIndex?: number;
  size?: number;
  cinemaMetadata?: CinemaMetadata | null;
};

export type GalleryEntryPreview = {
  id: string;
  galleryItemId?: string;
  galleryItemType?: "asset" | "pack" | "design" | "workflow";
  src: string;
  fullSrc: string;
  prompt: string;
  width?: number;
  height?: number;
  kind?: "image" | "video";
  contentType?: string;
};

export type GalleryEntry = {
  id: string;
  packId?: string;
  galleryItemId?: string;
  galleryItemType?: "asset" | "pack" | "design" | "workflow";
  src: string;
  fullSrc: string;
  prompt: string;
  author: string;
  likes: number;
  width?: number;
  height?: number;
  initiallyLoaded?: boolean;
  kind?: "image" | "video";
  contentType?: string;
  modelName?: string;
  pillar?: string;
  generationType?: string;
  assetRole?: string;
  ingestSource?: string;
  tagNames?: string[];
  sourceUrl?: string;
  description?: string;
  fileName?: string;
  designInspirationId?: string;
  createdAt?: number;
  folderId?: string;
  isPublic?: boolean;
  isFeatured?: boolean;
  packMemberCount?: number;
  size?: number;
  totalSize?: number;
  cinemaMetadata?: CinemaMetadata | null;
  previewImages: GalleryEntryPreview[];
};

type BuildGalleryEntriesArgs = {
  assets: GalleryAssetRecord[];
  hiddenAssetIds?: Set<string>;
  loadedAssetIds?: Set<string>;
  sortOrder: "newest" | "featured" | "popular" | "largest";
};

const FALLBACK_SRC = "/placeholder.svg";
const VIDEO_FALLBACK_DIMENSIONS = { width: 16, height: 9 } as const;

const hasUsableDimensions = (
  width: number | undefined,
  height: number | undefined,
) =>
  typeof width === "number" &&
  Number.isFinite(width) &&
  width > 0 &&
  typeof height === "number" &&
  Number.isFinite(height) &&
  height > 0;

const toUsableDimensions = (
  width: number | undefined,
  height: number | undefined,
): { width: number; height: number } | undefined =>
  hasUsableDimensions(width, height)
    ? { width: width!, height: height! }
    : undefined;

const resolvePreviewDimensions = (asset: GalleryAssetRecord) => {
  const originalDimensions = toUsableDimensions(asset.width, asset.height);
  const thumbnailDimensions = toUsableDimensions(
    asset.thumbWidth,
    asset.thumbHeight,
  );

  if (asset.kind === "video") {
    if (
      originalDimensions &&
      Math.abs(originalDimensions.width / originalDimensions.height - 1) >= 0.04
    ) {
      return originalDimensions;
    }
    if (
      thumbnailDimensions &&
      Math.abs(thumbnailDimensions.width / thumbnailDimensions.height - 1) >= 0.04
    ) {
      return thumbnailDimensions;
    }
    return VIDEO_FALLBACK_DIMENSIONS;
  }

  return thumbnailDimensions ?? originalDimensions ?? {};
};

const toPreview = (asset: GalleryAssetRecord): GalleryEntryPreview => ({
  id: asset._id,
  galleryItemId: asset._id,
  galleryItemType: "asset",
  src: asset.thumbUrl ?? asset.url ?? asset.sourceUrl ?? FALLBACK_SRC,
  fullSrc: asset.url ?? asset.sourceUrl ?? FALLBACK_SRC,
  prompt: asset.promptText ?? asset.fileName ?? "Untitled prompt",
  ...resolvePreviewDimensions(asset),
  kind: asset.kind,
  contentType: asset.contentType,
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

  const totalSize = members.reduce(
    (acc, member) => acc + (member.size ?? 0),
    0,
  );

  return {
    id: cover._id,
    packId: cover.assetPackId ?? undefined,
    galleryItemId: cover.assetPackId ?? cover._id,
    galleryItemType: cover.assetPackId ? "pack" : "asset",
    src: cover.thumbUrl ?? cover.url ?? cover.sourceUrl ?? FALLBACK_SRC,
    fullSrc: cover.url ?? cover.sourceUrl ?? FALLBACK_SRC,
    prompt: cover.promptText ?? cover.fileName ?? "Untitled prompt",
    author: "Agent",
    likes: 0,
    ...resolvePreviewDimensions(cover),
    initiallyLoaded: loadedAssetIds?.has(cover._id) ?? false,
    kind: cover.kind,
    contentType: cover.contentType,
    modelName: cover.modelName ?? undefined,
    pillar: cover.pillar ?? undefined,
    generationType: cover.generationType ?? undefined,
    assetRole: cover.assetRole ?? undefined,
    ingestSource: cover.ingestSource ?? undefined,
    tagNames,
    sourceUrl: cover.sourceUrl ?? undefined,
    description: cover.description ?? undefined,
    fileName: cover.fileName ?? undefined,
    designInspirationId: cover.designInspirationId ?? undefined,
    createdAt: Math.max(...members.map((member) => member.createdAt)),
    folderId: cover.folderId ?? undefined,
    isPublic: cover.isPublic ?? false,
    isFeatured: cover.isFeatured ?? false,
    packMemberCount: members.length > 1 ? members.length : undefined,
    size: cover.size,
    totalSize: totalSize > 0 ? totalSize : undefined,
    cinemaMetadata: cover.cinemaMetadata ?? undefined,
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

  if (sortOrder === "largest") {
    entries.sort(
      (left, right) =>
        (right.totalSize ?? right.size ?? 0) -
        (left.totalSize ?? left.size ?? 0),
    );
    return entries;
  }

  entries.sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0));
  return entries;
};
