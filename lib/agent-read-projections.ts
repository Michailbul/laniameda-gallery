// What the agent read tools return. Convex rows carry storage keys, owner ids
// and join columns an agent never needs; the MCP result is read by a language
// model, so every byte is context. These helpers shape list rows for
// /api/agent/* (collections, assets, stories): drop the plumbing, keep the
// ids and the fields the tool descriptions promise, and cut long prompt text
// to an excerpt (get_gallery_item and get_story return the full text).

export const PROMPT_EXCERPT_CHARS = 300;
export const STORY_EXCERPT_CHARS = 300;
export const COLLECTION_DESCRIPTION_CHARS = 300;

const excerpt = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
};

/* ── Collections ───────────────────────────────────────────────────────── */

export type CollectionRowInput = {
  _id: string;
  name: string;
  parentFolderId?: string | null;
  group?: string | null;
  sortOrder?: number | null;
  kind?: string | null;
  worldKey?: string | null;
  memberCount?: number | null;
  publicMemberCount?: number | null;
  description?: string | null;
  slug?: string | null;
  hiddenFromGallery?: boolean | null;
  pinnedAt?: number | null;
  url?: string;
  [key: string]: unknown;
};

export type CollectionRow = {
  _id: string;
  name: string;
  parentFolderId?: string;
  group?: string;
  sortOrder?: number;
  kind?: string;
  worldKey?: string;
  isWorld: boolean;
  memberCount: number;
  description?: string;
  slug?: string;
  hidden?: true;
  url?: string;
};

/** The agent-facing shape of one collection: ids, place in the tree, counts. */
export const projectCollectionRow = (folder: CollectionRowInput): CollectionRow => {
  const row: CollectionRow = {
    _id: folder._id,
    name: folder.name,
    isWorld: Boolean(folder.worldKey),
    memberCount: folder.memberCount ?? 0,
  };
  if (folder.parentFolderId) row.parentFolderId = folder.parentFolderId;
  if (folder.group) row.group = folder.group;
  if (typeof folder.sortOrder === "number") row.sortOrder = folder.sortOrder;
  if (folder.kind) row.kind = folder.kind;
  if (folder.worldKey) row.worldKey = folder.worldKey;
  if (folder.description?.trim()) row.description = excerpt(folder.description, COLLECTION_DESCRIPTION_CHARS);
  if (folder.slug) row.slug = folder.slug;
  if (folder.hiddenFromGallery) row.hidden = true;
  if (folder.url) row.url = folder.url;
  return row;
};

export type CollectionFilters = {
  /** Keep only these collection ids (a world's root and shelves). */
  ids?: Iterable<string>;
  parentFolderId?: string;
  rootsOnly?: boolean;
  search?: string;
  kind?: "storybook" | "plain";
};

/** Apply list_collections filters to the owner's full collection list. */
export const filterCollections = <T extends CollectionRowInput>(folders: T[], filters: CollectionFilters): T[] => {
  const ids = filters.ids ? new Set(filters.ids) : undefined;
  const terms = filters.search?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
  return folders.filter((folder) => {
    if (ids && !ids.has(folder._id)) return false;
    if (filters.parentFolderId && folder.parentFolderId !== filters.parentFolderId) return false;
    if (filters.rootsOnly && folder.parentFolderId) return false;
    if (filters.kind === "storybook" && folder.kind !== "storybook") return false;
    if (filters.kind === "plain" && folder.kind) return false;
    if (terms.length > 0) {
      const haystack = `${folder.name} ${folder.description ?? ""} ${folder.worldKey ?? ""} ${folder.slug ?? ""}`.toLowerCase();
      if (!terms.every((term) => haystack.includes(term))) return false;
    }
    return true;
  });
};

/* ── Assets ────────────────────────────────────────────────────────────── */

// Storage plumbing and join columns. R2 keys are not a leak (the MCP is
// owner-only); they are noise that doubles a search result's size.
const ASSET_PLUMBING = new Set([
  "ownerUserId", "storageId", "thumbStorageId", "r2Key", "r2Bucket", "thumbR2Key", "thumbR2Bucket",
  "tagIds", "ingestSource", "packSlotIndex", "curatedByUserId", "designInspirationId", "_creationTime", "thumbVariants",
]);

/** One asset row as search_gallery, find_similar, list_assets and preview_assets return it. */
export const projectAgentAsset = <T extends Record<string, unknown>>(asset: T): Record<string, unknown> => {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(asset)) {
    if (ASSET_PLUMBING.has(key) || value === undefined) continue;
    row[key] = value;
  }
  const promptText = asset.promptText;
  if (typeof promptText === "string" && promptText.length > PROMPT_EXCERPT_CHARS) {
    row.promptText = excerpt(promptText, PROMPT_EXCERPT_CHARS);
    row.promptTruncated = true;
    row.promptChars = promptText.length;
  }
  return row;
};

export const projectAgentAssets = <T extends Record<string, unknown>>(assets: readonly T[]) => assets.map(projectAgentAsset);

/* ── Stories ───────────────────────────────────────────────────────────── */

export type StoryRowInput = {
  _id: string;
  _creationTime?: number;
  ownerUserId?: string;
  searchText?: string;
  body: string;
  updatedAt: number;
  [key: string]: unknown;
};

/** A list_stories row: no searchText, owner or creation time; the body as an
 *  excerpt unless includeBody asked for the whole text. */
export const projectStoryRow = <T extends StoryRowInput>(story: T, includeBody: boolean) => {
  const { _creationTime: _created, ownerUserId: _owner, searchText: _search, body, ...rest } = story;
  void _created; void _owner; void _search;
  return includeBody
    ? { ...rest, body, bodyChars: body.length }
    : { ...rest, excerpt: excerpt(body, STORY_EXCERPT_CHARS), bodyChars: body.length };
};

/** The page summary a bounded list carries: count, the limit that bounded it,
 *  whether more may exist and how to continue (updatedBefore = oldest row). */
export const storyListPage = <T extends { updatedAt: number }>(rows: readonly T[], limit: number) => {
  const truncated = rows.length >= limit;
  const oldest = rows.reduce<number | undefined>((min, row) => (min === undefined || row.updatedAt < min ? row.updatedAt : min), undefined);
  return {
    count: rows.length,
    limit,
    truncated,
    ...(truncated && oldest !== undefined ? { next: { updatedBefore: oldest } } : {}),
  };
};

/* ── Tags ──────────────────────────────────────────────────────────────── */

export type TagRowInput = {
  name: string;
  label: string;
  normalizedLabel?: string;
  description?: string;
  category?: string | null;
  usageCount: number;
  isCustomized: boolean;
  archivedAt?: number;
  [key: string]: unknown;
};

export type TagFilters = {
  search?: string;
  category?: string;
  minUsage?: number;
};

/** list_tags filters: substring on name/label, exact category, usage floor. */
export const filterTags = <T extends TagRowInput>(rows: T[], filters: TagFilters): T[] => {
  const needle = filters.search?.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.category && row.category !== filters.category) return false;
    if (typeof filters.minUsage === "number" && row.usageCount < filters.minUsage) return false;
    if (needle) {
      const haystack = `${row.name} ${row.label} ${row.normalizedLabel ?? ""} ${row.description ?? ""}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
};

/** Most used first, then by label: the order an agent wants when reusing a vocabulary. */
export const sortTagsByUsage = <T extends TagRowInput>(rows: T[]) =>
  [...rows].sort((left, right) => right.usageCount - left.usageCount || left.label.localeCompare(right.label));

export type SlimTag = {
  name: string;
  label?: string;
  category?: string;
  description?: string;
  usageCount: number;
  customized?: true;
  archived?: true;
};

/** The slim projection: what distinguishes a tag when choosing one to reuse. */
export const projectSlimTag = (row: TagRowInput): SlimTag => {
  const slim: SlimTag = { name: row.name, usageCount: row.usageCount };
  if (row.label && row.label !== row.name) slim.label = row.label;
  if (row.category) slim.category = row.category;
  if (row.description) slim.description = row.description;
  if (row.isCustomized) slim.customized = true;
  if (row.archivedAt) slim.archived = true;
  return slim;
};

export const TAG_PAGE_DEFAULT = 100;
export const TAG_PAGE_MAX = 500;

/** Offset paging over an in-memory list: the cursor is the next offset. */
export const pageRows = <T>(rows: readonly T[], cursor: string | null | undefined, limit: number | undefined) => {
  const size = Math.min(TAG_PAGE_MAX, Math.max(1, Math.floor(limit ?? TAG_PAGE_DEFAULT)));
  const offset = cursor ? Math.max(0, Math.floor(Number(cursor)) || 0) : 0;
  const page = rows.slice(offset, offset + size);
  const nextOffset = offset + page.length;
  const isDone = nextOffset >= rows.length;
  return { page, count: page.length, total: rows.length, limit: size, cursor: isDone ? null : String(nextOffset), isDone };
};
