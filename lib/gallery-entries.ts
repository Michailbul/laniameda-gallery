import { isCardThumbSharp } from "./card-thumbnail";
import { clusterPromptFamilies } from "./prompt-family";
import type { BookmarkPost } from "./bookmarks";

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
  /** Saved social post behind this asset — rendered as a post card. */
  bookmark?: BookmarkPost | null;
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
  folderIds?: string[];
  isPublic?: boolean;
  isFeatured?: boolean;
  isLiked?: boolean;
  starredAt?: number;
  starNote?: string;
  assetPackId?: string;
  packSlotIndex?: number;
  size?: number;
  cinemaMetadata?: CinemaMetadata | null;
};

export type GalleryEntryPreview = {
  id: string;
  galleryItemId?: string;
  galleryItemType?: "asset" | "pack" | "design" | "workflow" | "storybook" | "collection";
  /** The prompt row this file was generated from — the detail panel reads
   *  its sections and workflow context through `prompts.getPromptContext`. */
  promptId?: string;
  src: string;
  fullSrc: string;
  /** A still for a video member, when one exists. `src` can be the video
   *  file itself, which an <img> can't paint. */
  posterSrc?: string;
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
  galleryItemType?: "asset" | "pack" | "design" | "workflow" | "storybook" | "collection";
  promptId?: string;
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
  /** The post this piece came from (author, text, counts), when one is saved. */
  bookmark?: BookmarkPost;
  /** Render the tile as a post card instead of bare media. */
  postCard?: boolean;
  createdAt?: number;
  folderId?: string;
  folderIds?: string[];
  /** Collections this piece is filed in, resolved to display labels by the
   *  caller (the folder table lives in the dashboard, not here). Rendered as
   *  card badges so a tile says where it belongs without opening it. */
  collectionLabels?: string[];
  /** What the piece IS — Character / Location / Scene / Inspiration. */
  typeLabel?: string;
  isPublic?: boolean;
  isFeatured?: boolean;
  isLiked?: boolean;
  /** Set when the owner starred this piece — the entry then leads the grid
   *  and the card renders highlighted. */
  starredAt?: number;
  /** Optional owner note on a starred piece, shown on the card. */
  starNote?: string;
  packMemberCount?: number;
  /** Distinct prompts behind a pack — above 1, the pack holds variations. */
  packPromptCount?: number;
  /** Member count for stack entries (galleryItemType "storybook"). */
  storybookCount?: number;
  /** Step count for workflow entries (galleryItemType "workflow"). */
  stepCount?: number;
  /** Skill cards: one or two plain sentences under the title. */
  excerpt?: string;
  size?: number;
  totalSize?: number;
  cinemaMetadata?: CinemaMetadata | null;
  previewImages: GalleryEntryPreview[];
};

type BuildGalleryEntriesArgs = {
  assets: GalleryAssetRecord[];
  hiddenAssetIds?: Set<string>;
  loadedAssetIds?: Set<string>;
  /** "relevance" keeps the order the assets arrived in (semantic search
   * ranks them); packs sit where their best-ranked member did. */
  sortOrder: "newest" | "featured" | "shuffle" | "relevance";
  /** Deals the "shuffle" arrangement; same seed = same order, so the grid
   * stays put across re-renders until the user asks for a new deal. */
  shuffleSeed?: number;
  /** Float starred entries to the top (default). Turned off for semantic
   * search, where the score IS the order the user asked for — a star is a
   * curation signal, not a relevance one. */
  promoteStarred?: boolean;
  /** Every asset gets its own tile: pack and prompt stacks spread out into
   * their members instead of collapsing behind a cover. */
  flattenStacks?: boolean;
};

// Small deterministic PRNG (mulberry32) for the seeded shuffle.
const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const seededShuffle = <T,>(items: T[], seed: number): T[] => {
  const random = mulberry32(seed);
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
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

// A soft thumb gives way to the original: images render the full file;
// videos drop the tiny poster so the card mounts the real <video> and paints
// a native-resolution first frame. Portrait thumbs count by their height, so
// a 576×1024 thumb no longer pulls a multi-megabyte original into the grid.
const displaySrc = (asset: GalleryAssetRecord): string => {
  const sharp = isCardThumbSharp(asset) ? asset.thumbUrl : undefined;
  return (
    sharp ?? asset.url ?? asset.thumbUrl ?? asset.sourceUrl ?? FALLBACK_SRC
  );
};

const toPreview = (asset: GalleryAssetRecord): GalleryEntryPreview => ({
  id: asset._id,
  galleryItemId: asset._id,
  galleryItemType: "asset",
  promptId: asset.promptId ?? undefined,
  src: displaySrc(asset),
  fullSrc: asset.url ?? asset.sourceUrl ?? FALLBACK_SRC,
  posterSrc: asset.kind === "video" ? asset.thumbUrl : undefined,
  prompt: asset.promptText ?? asset.fileName ?? "Untitled prompt",
  ...resolvePreviewDimensions(asset),
  kind: asset.kind,
  contentType: asset.contentType,
});

// A post's own preview asset, as opposed to a media piece that is linked to
// the post it came from.
const isPostPreview = (asset: Pick<GalleryAssetRecord, "bookmark" | "assetRole">) =>
  Boolean(asset.bookmark) && asset.assetRole === "bookmark";

// Web bookmarks carry a page title as their "prompt", saved posts carry the
// post, and cinema frames open one by one in the cinema popout — none is a
// generation prompt.
const canJoinPromptFamily = (asset: GalleryAssetRecord) =>
  !asset.designInspirationId &&
  !isPostPreview(asset) &&
  asset.pillar !== "cinema-inspiration";

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
  standalone = false,
): GalleryEntry => {
  // A flattened member is a plain asset tile, not a one-frame pack.
  const packId = standalone ? undefined : cover.assetPackId;
  const tagNames = Array.from(
    new Set(members.flatMap((member) => member.tagNames ?? [])),
  );

  const totalSize = members.reduce(
    (acc, member) => acc + (member.size ?? 0),
    0,
  );

  return {
    id: cover._id,
    packId: packId ?? undefined,
    galleryItemId: packId ?? cover._id,
    galleryItemType: packId ? "pack" : "asset",
    promptId: cover.promptId ?? undefined,
    src: displaySrc(cover),
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
    bookmark: cover.bookmark ?? undefined,
    // A post's own preview renders as a post card everywhere. A media piece
    // linked to its post stays a media tile; views that are about the posts
    // (the Bookmarks tab and filter) turn the card on for those too.
    postCard: isPostPreview(cover),
    createdAt: Math.max(...members.map((member) => member.createdAt)),
    folderId: cover.folderId ?? undefined,
    folderIds: cover.folderIds ?? (cover.folderId ? [cover.folderId] : []),
    isPublic: cover.isPublic ?? false,
    isFeatured: cover.isFeatured ?? false,
    isLiked: cover.isLiked ?? false,
    // A pack's star is whichever member is starred (the cover leads), so
    // starring one frame of a prompt pack promotes the tile it renders as.
    starredAt: members.reduce<number | undefined>(
      (best, member) =>
        member.starredAt && (!best || member.starredAt > best)
          ? member.starredAt
          : best,
      undefined,
    ),
    starNote:
      members.find((member) => member.starredAt && member.starNote)?.starNote ??
      undefined,
    packMemberCount: members.length > 1 ? members.length : undefined,
    packPromptCount:
      members.length > 1
        ? new Set(members.map((member) => member.promptId ?? member._id)).size
        : undefined,
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
  shuffleSeed,
  promoteStarred = true,
  flattenStacks = false,
}: BuildGalleryEntriesArgs): GalleryEntry[] => {
  const visibleAssets = assets.filter(
    (asset) => !hiddenAssetIds?.has(asset._id),
  );

  // Orders the finished entries: starred band first (when promoted), then the
  // chosen sort. entryRank is each entry's arrival position, for "relevance".
  const orderEntries = (
    entries: GalleryEntry[],
    entryRank: Map<GalleryEntry, number>,
  ): GalleryEntry[] => {
    // With promoteStarred, starred (featured) pieces lead as their own band and
    // the chosen sort governs the rest. The vault turns it on only for the
    // FEATURED sort; NEWEST and SHUFFLE keep starred pieces in place.
    const starred = promoteStarred
      ? entries.filter((entry) => Boolean(entry.starredAt))
      : [];
    const rest = promoteStarred
      ? entries.filter((entry) => !entry.starredAt)
      : entries;
    starred.sort((left, right) => (right.starredAt ?? 0) - (left.starredAt ?? 0));

    if (sortOrder === "featured") {
      rest.sort((left, right) => {
        const featuredDiff =
          Number(Boolean(right.isFeatured)) -
          Number(Boolean(left.isFeatured));
        if (featuredDiff !== 0) {
          return featuredDiff;
        }
        return (right.createdAt ?? 0) - (left.createdAt ?? 0);
      });
      return [...starred, ...rest];
    }

    if (sortOrder === "shuffle") {
      return [...starred, ...seededShuffle(rest, shuffleSeed ?? 1)];
    }

    if (sortOrder === "relevance") {
      rest.sort((left, right) => (entryRank.get(left) ?? 0) - (entryRank.get(right) ?? 0));
      return [...starred, ...rest];
    }

    rest.sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0));
    return [...starred, ...rest];
  };

  // Flatten mode: every asset is its own tile, no packs and no families.
  if (flattenStacks) {
    const entryRank = new Map<GalleryEntry, number>();
    const entries = visibleAssets.map((asset, index) => {
      const entry = buildEntry(asset, [asset], loadedAssetIds, true);
      entryRank.set(entry, index);
      return entry;
    });
    return orderEntries(entries, entryRank);
  }

  // First the explicit groups: a stored pack, else the prompt row. Each group
  // remembers where its first member arrived, for the "relevance" order.
  const groups: GalleryAssetRecord[][] = [];
  const groupRank: number[] = [];
  const groupIndexByKey = new Map<string, number>();
  for (const [index, asset] of visibleAssets.entries()) {
    const groupingKey = asset.assetPackId
      ? `pack:${asset.assetPackId}`
      : asset.promptId
        ? `prompt:${asset.promptId}`
        : null;
    const existing = groupingKey ? groupIndexByKey.get(groupingKey) : undefined;
    if (existing !== undefined) {
      groups[existing]!.push(asset);
      continue;
    }
    if (groupingKey) groupIndexByKey.set(groupingKey, groups.length);
    groups.push([asset]);
    groupRank.push(index);
  }
  const orderedGroups = groups.map((members) =>
    [...members].sort(sortPackMembers),
  );

  // Then the same prompt saved as separate rows, and its variations, fold
  // into one pack: a family's newest group leads and supplies the cover.
  const families = clusterPromptFamilies(
    orderedGroups.map((members) => ({
      createdAt: Math.max(...members.map((member) => member.createdAt)),
      promptTexts: members
        .filter(canJoinPromptFamily)
        .map((member) => member.promptText),
    })),
  );

  // Arrival position of each entry, for the "relevance" order: a pack sits
  // where its best-ranked member did.
  const entryRank = new Map<GalleryEntry, number>();
  const entries = families.map((groupIndices) => {
    const members = groupIndices.flatMap((index) => orderedGroups[index]!);
    const entry = buildEntry(members[0]!, members, loadedAssetIds);
    entryRank.set(
      entry,
      Math.min(...groupIndices.map((index) => groupRank[index]!)),
    );
    return entry;
  });

  return orderEntries(entries, entryRank);
};
