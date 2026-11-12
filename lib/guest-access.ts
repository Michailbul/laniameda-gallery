// Guest reader tokens: read-only, shelf-limited access for a collaborator's
// agent (first one: a collaborator's car-channel agent, 12 Nov 2026).
//
// The rule, deny wins:
// - A guest sees a collection when it is one of the token's allowed roots, or
//   a child of one, and neither it nor its root is a world (worldKey, a
//   universe member or a project). Worlds stay hidden even if someone later
//   puts one on the allowlist. Any root not on the allowlist is hidden, so a
//   new root starts hidden.
// - A guest sees an asset or a Skill only when it sits in at least one
//   collection AND every collection it sits in is visible. One link into a
//   world, LOVE, Pets or any other hidden place hides it everywhere.
// - YouTube video references are a separate research surface and are open in
//   full.
// - Nothing is ever written: every write, delete, edit, generation, upload or
//   private surface is refused. The MCP lists only GUEST_TOOL_NAMES.
//
// Owner reads never pass through this module; it costs the owner nothing.

export type GuestFolderInput = {
  _id: string;
  parentFolderId?: string | null;
  worldKey?: string | null;
  universeRootId?: string | null;
  project?: unknown;
};

const isWorldFolder = (folder: GuestFolderInput) =>
  Boolean(folder.worldKey || folder.universeRootId || folder.project);

/** Every collection id the guest may see. */
export const guestVisibleFolderIds = (
  folders: readonly GuestFolderInput[],
  allowedRootIds: readonly string[],
): Set<string> => {
  const byId = new Map(folders.map((folder) => [String(folder._id), folder]));
  const allowedRoots = new Set<string>();
  for (const id of allowedRootIds) {
    const root = byId.get(String(id));
    if (root && !root.parentFolderId && !isWorldFolder(root)) allowedRoots.add(String(root._id));
  }
  const visible = new Set<string>();
  for (const folder of folders) {
    if (isWorldFolder(folder)) continue;
    const id = String(folder._id);
    if (!folder.parentFolderId) {
      if (allowedRoots.has(id)) visible.add(id);
      continue;
    }
    const parent = byId.get(String(folder.parentFolderId));
    if (!parent || parent.parentFolderId || isWorldFolder(parent)) continue;
    if (allowedRoots.has(String(parent._id))) visible.add(id);
  }
  return visible;
};

/** Deny wins: at least one membership, and every membership visible. */
export const isGuestVisibleMembership = (
  folderIds: readonly (string | null | undefined)[] | undefined,
  visible: ReadonlySet<string>,
) => {
  const ids = (folderIds ?? []).filter((id): id is string => Boolean(id)).map(String);
  return ids.length > 0 && ids.every((id) => visible.has(id));
};

export type GuestAssetLike = { folderId?: string | null; folderIds?: readonly string[] };

export const isGuestVisibleAsset = (asset: GuestAssetLike | null | undefined, visible: ReadonlySet<string>) =>
  Boolean(asset) && isGuestVisibleMembership([...(asset!.folderIds ?? []), asset!.folderId], visible);

export type GuestSkillLike = { folderIds?: readonly string[]; collections?: readonly { _id: string }[] };

export const isGuestVisibleSkill = (skill: GuestSkillLike | null | undefined, visible: ReadonlySet<string>) =>
  Boolean(skill) && isGuestVisibleMembership(
    [...(skill!.folderIds ?? []), ...(skill!.collections ?? []).map((entry) => entry._id)],
    visible,
  );

// The owner's private marks and notes never reach a guest.
const PRIVATE_ASSET_FIELDS = [
  "isLiked", "superLikedAt", "starredAt", "starNote", "isFeatured", "curatedAt", "curatedByUserId",
  "pinnedAt", "orderPriority", "worldPageHidden", "worldPageHiddenReason", "ownerUserId",
] as const;

export const sanitizeGuestAsset = <T extends Record<string, unknown>>(asset: T): T => {
  const row: Record<string, unknown> = { ...asset };
  for (const key of PRIVATE_ASSET_FIELDS) delete row[key];
  // A saved post's own note is the owner's.
  if (row.bookmark && typeof row.bookmark === "object") {
    const { userNote: _note, ...bookmark } = row.bookmark as Record<string, unknown>;
    void _note;
    row.bookmark = bookmark;
  }
  return row as T;
};

const PRIVATE_SKILL_FIELDS = ["ownerUserId", "isFeatured"] as const;

export const sanitizeGuestSkill = <T extends Record<string, unknown>>(skill: T): T => {
  const row: Record<string, unknown> = { ...skill };
  for (const key of PRIVATE_SKILL_FIELDS) delete row[key];
  return row as T;
};

/** Collection rows a guest gets: visible ones, without counts (counts would include hidden members). */
export const guestCollectionRows = <T extends { _id: string; memberCount?: unknown; publicMemberCount?: unknown }>(
  folders: readonly T[],
  visible: ReadonlySet<string>,
): T[] =>
  folders
    .filter((folder) => visible.has(String(folder._id)))
    .map((folder) => {
      const { memberCount: _count, publicMemberCount: _public, ...rest } = folder;
      void _count; void _public;
      return rest as T;
    });

// Filters that would reveal the owner's likes and stars are dropped for guests.
export const GUEST_STRIPPED_FILTERS = ["onlyLiked", "onlySuperLiked", "onlyStarred", "mustShow", "world"] as const;

export const stripGuestFilters = (data: Record<string, unknown>) => {
  for (const key of GUEST_STRIPPED_FILTERS) delete data[key];
  return data;
};

/** MCP tools a guest token is offered. Everything else is not registered. */
export const GUEST_TOOL_NAMES: ReadonlySet<string> = new Set([
  "check_connection",
  "list_collections",
  "search_gallery",
  "list_assets",
  "list_assets_page",
  "find_similar",
  "preview_assets",
  "get_gallery_item",
  "list_skills",
  "search_skills",
  "get_skill",
  "list_video_refs",
  "list_video_refs_page",
  "get_video_ref",
]);

export const isGuestTool = (name: string) => GUEST_TOOL_NAMES.has(name);

/** /api/agent/* path + action pairs a guest may call. Everything else is refused. */
export const GUEST_ROUTE_ACTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  "/api/agent/gallery": new Set([
    "listAssetsPage", "listAssets", "searchAssets", "findSimilar", "getById",
    "listSkills", "searchSkills", "getSkill", "contactSheet", "listFolders",
  ]),
  "/api/agent/customize": new Set(["listFolders"]),
  "/api/agent/video-refs": new Set(["list", "list_page", "get"]),
};

export const guestMayCall = (path: string, action: string | undefined) =>
  Boolean(action && GUEST_ROUTE_ACTIONS[path]?.has(action));

export const GUEST_REFUSAL = "This guest token reads only, and only its shelves. Saving, editing, deleting and private areas are not open to it.";

export const GUEST_MCP_INSTRUCTIONS = [
  "This is a guest, read-only view of laniameda.gallery: a few shelves of references (cars, YouTube cars, art, design, techniques, game views, motion design, inspiration sources) plus the YouTube video references.",
  "Find pieces with search_gallery (by meaning) or list_assets / list_assets_page (newest first, optionally inside one collection from list_collections). Look at them with preview_assets, then read one in full, with its prompt, through get_gallery_item. find_similar finds more like a piece.",
  "Techniques are Skills: search_skills, list_skills and get_skill. YouTube research videos: list_video_refs, list_video_refs_page and get_video_ref.",
  "Media URLs in results are direct links you can download. Nothing can be saved, edited or deleted with this token.",
].join(" ");
