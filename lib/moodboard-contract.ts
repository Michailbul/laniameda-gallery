import { z } from "zod";
import { MOODBOARD_LIMITS, MOODBOARD_STATUSES } from "./moodboards";

// Agent-facing moodboard payloads, shared by /api/agent/moodboards and the
// MCP tool schemas. A board is addressed as moodboard:<id> or its bare ID;
// IDs copied from other tools may keep their asset:/collection: prefix.

const boardRef = z.string().trim().min(1).describe("moodboard:<id> or the bare ID from list_moodboards.");
const assetRef = z.string().trim().min(1).describe("asset:<id> or bare asset ID.");
const collectionRef = z.string().trim().min(1).describe("Collection ID from list_collections.");
const clearableText = (max: number) => z.string().max(max).nullable().optional();

export const moodboardStatusSchema = z.enum(MOODBOARD_STATUSES);

export const moodboardListSchema = z.object({
  folderId: collectionRef.optional().describe("Plain collection (a world root or one of its children). Omit to list every board."),
  includeChildren: z.boolean().optional().describe("With a world root folderId: also the boards of its child collections, child by child."),
  status: moodboardStatusSchema.optional().describe("draft, in-midjourney or archived. Only that status."),
  includeArchived: z.boolean().optional().describe("Archived boards are left out unless asked for."),
});

export const moodboardRefSchema = z.object({ moodboardId: boardRef });

// One save: create without moodboardId, patch with it. No defaults, so a
// patch keeps every omitted field; null clears a text field.
export const moodboardSaveSchema = z.object({
  moodboardId: boardRef.optional().describe("Omit to create. Pass it to patch that board."),
  folderId: collectionRef.optional().describe("Owning plain collection. Required to create; on a patch it moves the board."),
  name: z.string().trim().min(1).max(MOODBOARD_LIMITS.name).optional().describe("e.g. DA FILM · Golden. Required to create; unique inside its collection."),
  description: clearableText(MOODBOARD_LIMITS.description).describe("What the board carries and when to use it."),
  styleTag: clearableText(MOODBOARD_LIMITS.styleTag).describe("Lowercase hyphenated style key, e.g. da-film."),
  notes: clearableText(MOODBOARD_LIMITS.notes).describe("Like rates, recipe partners (+ DARI h2eu2z6), anything a later agent needs."),
  status: moodboardStatusSchema.optional().describe("Patch only. archived keeps a board but hides it from default lists."),
  coverAssetId: assetRef.nullable().optional().describe("Patch only. Must already be on the board; null falls back to the first item."),
  mjCode: clearableText(80).describe("Midjourney personalization code, e.g. 88ji6bg. A changed code goes onto the code history; this is not a sync."),
  mjMoodboardId: clearableText(80).describe("Midjourney moodboard id, e.g. 7510337594627371941 (prompts use --profile m<id>)."),
  mjUrl: clearableText(MOODBOARD_LIMITS.mjUrl).describe("Link to the moodboard on midjourney.com."),
  expectedRevision: z.number().int().positive().optional().describe("Patch only: the revision last read; a stale one is refused."),
});

export const moodboardAddSchema = z.object({
  moodboardId: boardRef,
  assetIds: z.array(assetRef).min(1).max(MOODBOARD_LIMITS.itemsPerCall).describe("Appended in this order. Already-present assets are skipped and reported."),
  note: z.string().max(MOODBOARD_LIMITS.itemNote).optional().describe("Why these images are on the board."),
});

export const moodboardRemoveSchema = z.object({
  moodboardId: boardRef,
  assetIds: z.array(assetRef).min(1).max(MOODBOARD_LIMITS.itemsPerCall),
});

export const moodboardReorderSchema = z.object({
  moodboardId: boardRef,
  assetIds: z.array(assetRef).min(1).max(MOODBOARD_LIMITS.items).describe("Every current item exactly once, in the new order."),
});

export const moodboardMidjourneySchema = z.object({
  moodboardId: boardRef,
  mjCode: z.string().trim().min(1).max(80).optional().describe("The personalization code Midjourney shows for the board, e.g. 88ji6bg."),
  mjMoodboardId: z.string().trim().min(1).max(80).optional().describe("The Midjourney moodboard id."),
  mjUrl: z.url().max(MOODBOARD_LIMITS.mjUrl).optional().describe("Link to the moodboard on midjourney.com."),
  syncedItemCount: z.number().int().min(0).max(MOODBOARD_LIMITS.items).optional().describe("Board images Midjourney now holds. Defaults to the board's item count."),
  note: z.string().max(MOODBOARD_LIMITS.syncNote).optional().describe("What changed in this sync."),
});

export const moodboardGenerationsSchema = z.object({
  moodboardId: boardRef,
  limit: z.number().int().min(1).max(MOODBOARD_LIMITS.generations).optional().describe(`Newest first; default 24, at most ${MOODBOARD_LIMITS.generations}.`),
});

export const bareMoodboardRef = (value: string) =>
  value.trim().replace(/^(moodboard|moodboards|asset|assets|collection|folder|folders):/, "");
export const bareOptionalMoodboardRef = <T extends string | null | undefined>(value: T) =>
  (typeof value === "string" ? bareMoodboardRef(value) : value) as T;
