// A moodboard is an ordered set of gallery assets that defines one look,
// mirrored to a Midjourney moodboard (a personalization code). It belongs to
// one plain collection: a world root or one of its children. Shared by Convex,
// the agent API, the MCP tools and the owner UI.

export const MOODBOARD_STATUSES = ["draft", "in-midjourney", "archived"] as const;
export type MoodboardStatus = (typeof MOODBOARD_STATUSES)[number];

export const MOODBOARD_STATUS_LABEL: Record<MoodboardStatus, string> = {
  draft: "Draft",
  "in-midjourney": "In Midjourney",
  archived: "Archived",
};

export const MOODBOARD_LIMITS = {
  name: 120,
  description: 2000,
  notes: 4000,
  styleTag: 48,
  mjCode: 64,
  mjMoodboardId: 64,
  mjUrl: 2000,
  itemNote: 500,
  syncNote: 500,
  items: 1000,
  itemsPerCall: 100,
  previews: 6,
  generations: 60,
} as const;

export const MOODBOARD_STYLE_TAG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const moodboardRef = (id: string) => `moodboard:${id}`;

// Unique per (owner, collection): case, spacing and Unicode width fold.
export const normalizeMoodboardName = (name: string) =>
  name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

// "DA Film" and "da_film" both become "da-film". The caller still checks the
// result against MOODBOARD_STYLE_TAG_PATTERN.
export const normalizeMoodboardStyleTag = (value: string) =>
  value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

// A personalization code is kept as given (a string, never a number). A pasted
// flag ("--profile 88ji6bg", "--p 88ji6bg") is reduced to its code.
export const cleanMidjourneyCode = (value: string) =>
  value.trim().replace(/^--(?:profile|p)\s+/i, "").trim();

// The moodboard's own ID, e.g. 7510337594627371941. Prompts address it as
// `--profile m<id>`, so a pasted "m7510…" or flag is reduced to the digits.
export const cleanMidjourneyMoodboardId = (value: string) => {
  const id = value.trim().replace(/^--(?:profile|p)\s+/i, "").trim();
  return /^m\d+$/i.test(id) ? id.slice(1) : id;
};

export const profileFlagForCode = (code: string) => `--profile ${code}`;
export const profileFlagForMoodboardId = (mjMoodboardId: string) =>
  `--profile m${mjMoodboardId}`;

type MidjourneyIdentity = {
  mjCode?: string;
  mjMoodboardId?: string;
  mjCodeHistory?: { code: string }[];
};

// Every token a prompt made with this board can carry: the current code,
// earlier codes and the moodboard ID form. At most six, current first.
export const moodboardSearchTerms = (board: MidjourneyIdentity) => {
  const terms = [
    board.mjCode,
    board.mjMoodboardId ? `m${board.mjMoodboardId}` : undefined,
    ...[...(board.mjCodeHistory ?? [])].reverse().map((entry) => entry.code),
  ]
    .map((term) => term?.trim())
    .filter((term): term is string => Boolean(term));
  return [...new Set(terms)].slice(0, 6);
};

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Whole-token match, so the code 88ji6 never claims a prompt with 88ji6bg.
export const mentionsMidjourneyTerm = (text: string | undefined, term: string) =>
  Boolean(text) &&
  new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}($|[^a-z0-9])`, "i").test(text!);

type SyncInput = MidjourneyIdentity & {
  status: MoodboardStatus;
  mjSyncedAt?: number;
  mjSyncedItemCount?: number;
  itemCount: number;
};

/**
 * Where the board stands against Midjourney. `addedSince` counts items added
 * after the last recorded sync; `removedSince` is what the sync count says is
 * gone. Both are zero when the board never synced.
 */
export function moodboardSyncState(
  board: SyncInput,
  itemAddedAts: number[] = [],
) {
  const synced = board.mjSyncedAt !== undefined;
  const addedSince = synced
    ? itemAddedAts.filter((addedAt) => addedAt > board.mjSyncedAt!).length
    : 0;
  const keptSince = board.itemCount - addedSince;
  const removedSince =
    synced && board.mjSyncedItemCount !== undefined
      ? Math.max(0, board.mjSyncedItemCount - keptSince)
      : 0;
  return {
    inMidjourney: Boolean(board.mjCode || board.mjMoodboardId),
    synced,
    addedSince,
    removedSince,
    upToDate: synced && addedSince === 0 && removedSince === 0,
  };
}

type RequestInput = MidjourneyIdentity & {
  id: string;
  name: string;
  itemCount: number;
};

/**
 * One paragraph an agent with Midjourney access can act on: read the board,
 * create or update the Midjourney moodboard, record the result.
 */
export function moodboardAgentRequest(board: RequestInput) {
  const ref = moodboardRef(board.id);
  const images = `${board.itemCount} ${board.itemCount === 1 ? "image" : "images"}`;
  const target = board.mjMoodboardId
    ? `update the existing Midjourney moodboard ${board.mjMoodboardId} so it holds exactly those images in that order (add what is missing, remove what is no longer on the board)`
    : `create a Midjourney moodboard titled "${board.name}" and add those images in that order`;
  return [
    `Sync the gallery moodboard "${board.name}" (${ref}, ${images}) to Midjourney.`,
    `Call get_moodboard with moodboardId "${ref}" for the full image URLs, widths and heights in position order, then ${target}.`,
    `Midjourney takes images only, so skip video items.`,
    `When it is done, call set_moodboard_midjourney with moodboardId "${ref}", the personalization code${board.mjCode ? ` (it is ${board.mjCode} now; send the new one if it changed)` : ""}, the Midjourney moodboard id, its URL and syncedItemCount.`,
    `Follow references/moodboards.md in the laniameda-gallery skill.`,
  ].join(" ");
}
