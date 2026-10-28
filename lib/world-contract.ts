import { z } from "zod";
import { WORLD_DOC_LIMITS } from "./world-docs";

// Agent-facing world payloads, shared by /api/agent/worlds and the MCP tool
// schemas. A world is named by its key (dear-annete), its name or its root
// collection ID. Every write takes an optional `session`: a short label for
// one piece of work, so Michael can read and undo it as a unit.

const world = z.string().trim().min(1).max(200).describe("World key (dear-annete), name or root collection ID. open_world with no arguments lists them.");
const session = z.string().trim().max(80).optional().describe("Label for this piece of work (e.g. da-tram-stop-2026-10-23). The journal groups by it and world_undo can revert it as a unit.");
const shelfRefs = z.array(z.string().trim().min(1).max(200)).max(20);

export const worldOpenSchema = z.object({
  world: world.optional(),
  journalLimit: z.number().int().min(0).max(50).optional().describe("How many recent journal entries to include (default 5)."),
});

export const worldDocSchema = z.object({
  world,
  op: z.enum(["list", "read", "write", "delete", "history"]),
  path: z.string().trim().min(1).max(120).optional().describe("WORLD.md, LEARNINGS.md or docs/<kebab-name>.md."),
  body: z.string().max(WORLD_DOC_LIMITS.doc + 1000).optional().describe("The whole new text (write)."),
  expectedRevision: z.number().int().min(0).optional().describe("The revision you read; 0 when creating. A stale one is refused."),
  note: z.string().trim().max(WORLD_DOC_LIMITS.note).optional().describe("One line on why: shown in the journal."),
  limit: z.number().int().min(1).max(100).optional(),
  session,
}).superRefine((value, ctx) => {
  if (value.op !== "list" && !value.path) ctx.addIssue({ code: "custom", path: ["path"], message: "path is required." });
  if (value.op === "write" && value.body === undefined) ctx.addIssue({ code: "custom", path: ["body"], message: "body is required to write." });
});

export const worldFileSchema = z.object({
  world,
  assetIds: z.array(z.string().trim().min(1)).min(1).max(100).describe("asset:<id> or bare IDs, up to 100 per call."),
  addTo: shelfRefs.optional().describe("Shelves of this world to add the assets to: names or IDs; \"root\" is the world collection."),
  removeFrom: shelfRefs.optional().describe("Shelves of this world to take the assets out of."),
  addTags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  removeTags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  move: z.boolean().optional().describe("Take the assets out of every other world first. Without it, filing an asset that lives in another world is refused."),
  createTags: z.boolean().optional().describe("Allow addTags to create tags that do not exist yet. Off by default: reuse the vocabulary."),
  note: z.string().trim().max(200).optional(),
  session,
});

export const worldShelfSchema = z.object({
  world,
  shelf: z.string().trim().min(1).max(200).optional().describe("Existing shelf or storybook (name or ID) to change, or a root collection's ID to bring into the world. Omit to create."),
  name: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(["shelf", "storybook"]).optional().describe("Create only. A storybook is one production-ready episode (references/storybooks.md)."),
  description: z.string().max(4000).nullable().optional(),
  group: z.string().max(40).nullable().optional().describe("Display group: Styles, Places, Cast, World building, Moods, Footage, Storybooks …"),
  sortOrder: z.number().nullable().optional(),
  session,
});

export const worldMoveSchema = z.object({
  world: world.describe("The world to move into: key (dear-annete-3d), name or root collection ID."),
  shelf: z.string().trim().min(1).max(200).optional().describe("A shelf or storybook to move: its ID (collection:<id> or bare). It keeps its ID and goes under the target world's root; its pieces leave the source world with it."),
  moodboard: z.string().trim().min(1).max(200).optional().describe("A moodboard to move: moodboard:<id> or bare ID. It keeps its ID, items, Midjourney code and sync record."),
  name: z.string().trim().min(1).max(120).optional().describe("Shelf only: a new name, when the target world already has a collection by that name."),
  into: z.string().trim().min(1).max(200).optional().describe("Moodboard only: the plain collection of the target world it goes into (name or ID; default the root)."),
  items: z.enum(["move", "drop"]).optional().describe("Moodboard only, needed when some items belong to another world: move = file them into the target world with the board (into its collection); drop = leave them where they are and take them off the board. The result lists them."),
  dryRun: z.boolean().optional().describe("Report what would move, what leaves other shelves and what blocks it; change nothing. Do this first."),
  note: z.string().trim().max(160).optional().describe("One line on why: shown in the journal."),
  session,
}).refine((value) => Boolean(value.shelf) !== Boolean(value.moodboard), { message: "Give shelf or moodboard (one of them)." });

export const worldMarkSchema = z.object({
  collectionId: z.string().trim().min(1).describe("Root collection to mark as a world."),
  worldKey: z.string().trim().max(60).nullable().optional().describe("Lowercase hyphenated key; omit to derive it from the name; null clears the mark."),
  convertStorybook: z.boolean().optional().describe("The collection is a root storybook that is really a world: make it a plain collection."),
  session,
});

export const worldProfileSchema = z.object({
  op: z.enum(["list", "save"]),
  world: world.optional().describe("list: only this world's profiles and roles. save: the world the role is for (required)."),
  includeRetired: z.boolean().optional(),
  profile: z.string().trim().max(120).optional().describe("Existing profile: its id, name or code. Omit to create."),
  name: z.string().trim().max(80).optional(),
  code: z.string().trim().max(40).optional().describe("The --profile code, e.g. h2eu2z6. A new code moves the old one into codeHistory."),
  codeNote: z.string().trim().max(300).optional(),
  mjProfileId: z.string().trim().max(60).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  status: z.enum(["active", "retired"]).optional(),
  role: z.string().trim().max(600).nullable().optional().describe("What the profile does in this world (taste it adds, when to stack it). null removes the world's use."),
  styleTag: z.string().trim().max(40).nullable().optional().describe("The style it serves, e.g. da-film."),
  expectedRevision: z.number().int().min(1).optional(),
  session,
});

export const worldJournalSchema = z.object({
  world: world.optional(),
  session: z.string().trim().max(80).optional(),
  before: z.number().optional().describe("Page back: the `at` of the oldest change already read."),
  limit: z.number().int().min(1).max(100).optional(),
  changeId: z.string().trim().min(1).optional().describe("One change in full, with its before and after."),
});

export const worldUndoSchema = z.object({
  changeId: z.string().trim().min(1).optional(),
  session: z.string().trim().max(80).optional().describe("Undo every change of this session, newest first."),
  world: world.optional().describe("With session: only that world's changes."),
  dryRun: z.boolean().optional().describe("Report what would be undone and what is blocked, change nothing. Do this first."),
}).refine((value) => Boolean(value.changeId) !== Boolean(value.session), { message: "Give changeId or session (one of them)." });
