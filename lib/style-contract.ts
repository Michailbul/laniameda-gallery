import { z } from "zod";
import { STYLE_LIMITS } from "./world-styles";

// Agent-facing payloads for a world's named styles, shared by
// /api/agent/styles and the MCP tool schemas. A style is named by
// style:<id>, or by its name (or slug) together with world.

const world = z.string().trim().min(1).max(200).describe("World key (dear-annete-art-deco), name or root collection ID.");
const style = z.string().trim().min(1).max(200).describe("style:<id>, or the style's name or slug (then give world).");
const session = z.string().trim().max(80).optional().describe("Label for this piece of work. The journal groups by it and world_undo reverts it as a unit.");
const ids = (max: number, what: string) => z.array(z.string().trim().min(1)).max(max).describe(what);
const lines = z.array(z.string().trim().min(1).max(STYLE_LIMITS.listItem)).max(STYLE_LIMITS.listItems);

export const styleListSchema = z.object({
  world,
  universe: z.boolean().optional().describe("Default true: every world of the universe (DEAR ANNETE with its 3D, Art Deco and Iron Stage worlds). false: this world only."),
  includeArchived: z.boolean().optional().describe("Also list archived and merged styles."),
  covers: z.number().int().min(0).max(6).optional().describe("Cover frames per style (default 2 for agents; 0 for names only)."),
});

export const styleGetSchema = z.object({
  style,
  world: world.optional(),
  frames: z.number().int().min(0).max(60).optional().describe("Also return the newest N frames with their prompt excerpts (default 0)."),
});

export const styleRecipeSchema = z.object({
  name: z.string().trim().max(STYLE_LIMITS.name).optional().describe("Optional label, e.g. \"places\" or \"close-ups\"."),
  moodboardIds: ids(STYLE_LIMITS.codes, "Gallery moodboards in stack order: moodboard:<id> (list_moodboards / open_world).").optional(),
  profileIds: ids(STYLE_LIMITS.codes, "Midjourney profiles after the boards: profile id, name or code (mj_profiles list).").optional(),
  unknownCodes: ids(STYLE_LIMITS.codes, "Codes the gallery has no moodboard or profile for yet. The page shows them as \"unnamed profile\"; register them to name them.").optional(),
  parameters: z.string().trim().max(STYLE_LIMITS.parameters).optional().describe("--stylize 600 --raw --v 8.2 …"),
  template: z.string().trim().max(STYLE_LIMITS.recipeText).optional().describe("Copy-ready prompt with [subject] where the scene goes."),
  frames: z.number().int().min(0).optional().describe("How many saved frames this recipe made (counted, not guessed)."),
  note: z.string().trim().max(STYLE_LIMITS.recipeText).optional(),
});

export const styleSaveSchema = z.object({
  world,
  style: style.optional().describe("An existing style to change. Omit to create one."),
  name: z.string().trim().min(1).max(STYLE_LIMITS.name).optional().describe("Required on create. A rename also renames its shelf when the shelf carried the old name."),
  line: z.string().trim().max(STYLE_LIMITS.line).nullable().optional().describe("One plain sentence on how a frame in this style looks. Shown under the name."),
  family: z.string().trim().max(STYLE_LIMITS.family).nullable().optional().describe("Carousel group (Film, Art Deco, 3D). Default: the world's short name."),
  status: z.enum(["draft", "ready", "archived"]).optional().describe("ready only on Michael's word. merged is set by merge_styles."),
  shelf: z.string().trim().min(1).max(200).nullable().optional().describe("The shelf holding its frames (name or id). On create, omitted = the shelf with the style's name, or a new one in the group Styles. null unlinks it (frames stay)."),
  coverAssetIds: ids(STYLE_LIMITS.covers, "The style's covers in order (replaces them). Frames of this world.").optional(),
  addCoverAssetIds: ids(STYLE_LIMITS.covers, "Put these first among the covers, keeping the rest.").optional(),
  recipes: z.array(styleRecipeSchema).max(STYLE_LIMITS.recipes).optional().describe("Replaces the recipes; the first is the main one."),
  raises: lines.optional().describe("What pushes the look up, with numbers when measured."),
  lowers: lines.optional().describe("What breaks it."),
  lockStoryId: z.string().trim().min(1).nullable().optional().describe("story:<id> of the style lock (package_style) holding the full recipe."),
  notes: z.string().max(STYLE_LIMITS.notes).nullable().optional(),
  sortOrder: z.number().nullable().optional().describe("Order in the carousel; lower first."),
  expectedRevision: z.number().int().min(1).optional().describe("The revision get_style returned; a stale one is refused."),
  session,
});

export const styleFileSchema = z.object({
  style,
  world: world.optional(),
  assetIds: ids(STYLE_LIMITS.lookup, "asset:<id> or bare ids; any number (filed 100 per journaled change).").min(1),
  remove: z.boolean().optional().describe("Take them off the style's shelf instead."),
  covers: z.boolean().optional().describe("Also make them the first covers (at most 12 kept)."),
  move: z.boolean().optional().describe("Take them out of other worlds first. Only when Michael said so."),
  note: z.string().trim().max(160).optional(),
  session,
});

export const styleMergeSchema = z.object({
  from: style.describe("The style that goes away: its frames, recipes, covers, raises and lowers join `into`."),
  into: style.describe("The style that stays."),
  world: world.optional(),
  move: z.boolean().optional().describe("Allow a merge across two worlds of a universe: the frames move worlds. Only on Michael's word."),
  dryRun: z.boolean().optional().describe("Report what would move; change nothing. Do this first."),
  session,
});

export const styleUniverseSchema = z.object({
  world,
  universe: z.string().trim().min(1).max(200).nullable().describe("The world whose universe this world joins (dear-annete), or null to leave."),
  session,
});

export const assetLookupSchema = z.object({
  items: z.array(z.string().trim().min(1).max(2000)).min(1).max(STYLE_LIMITS.lookup).describe(
    "Up to 500 references, any mix: Midjourney job URLs (midjourney.com/jobs/<job>?index=2), CDN URLs, file names (mj-<job>-2.png), a board's short id (<first 8 of the job>-<tile>), a bare job id (every tile), asset:<id>, any other source URL, ingestKey or file name.",
  ),
});
