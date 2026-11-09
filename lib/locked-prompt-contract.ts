import { z } from "zod";

// Agent input for locked location prompts (/api/agent/locked-prompts and the
// *_locked_prompt MCP tools). A locked prompt is one style-neutral prompt per
// place of a project; a restyle composes MJ Queue items from it and world
// styles. Art-director scope: owner and agents only.

const world = z.string().trim().min(1).max(120).describe("The project's world: key (cassandra), name or root id.");
const session = z.string().trim().max(80).optional().describe("Journal session label, e.g. cassandra-locked-prompts-2026-11-09.");
const ref = z.object({
  url: z.string().trim().max(2048).optional(),
  assetId: z.string().trim().max(120).optional().describe("asset:<id> of a gallery image (brief photo, reference)."),
  weight: z.number().min(0).max(3).optional().describe("Image weight (--iw); the first weight given counts."),
  label: z.string().trim().max(120).optional(),
});

export const lockedListSchema = z.object({
  world,
  place: z.string().trim().max(80).optional().describe("Only this place: \"School\", \"School · Patio\" or a review folder slug."),
  includeArchived: z.boolean().optional(),
});

export const lockedGetSchema = z.object({ prompt: z.string().trim().min(1).max(200).describe("lp:<id>, the id or its ingestKey.") });

export const lockedSaveSchema = z.object({
  world,
  prompt: z.string().trim().max(200).optional().describe("An existing locked prompt to change (lp:<id> or ingestKey)."),
  ingestKey: z.string().trim().max(200).optional().describe("Stable key for a new one: cassandra:lp:school-patio."),
  title: z.string().trim().max(120).optional().describe("Plain words: \"The patio with the big tree\"."),
  place: z.string().trim().max(80).optional().describe("Area · place: \"School · Patio\". The area groups places."),
  reviewFolder: z.string().trim().max(80).nullable().optional().describe("Director-review folder slug (school)."),
  shelf: z.string().trim().max(200).nullable().optional().describe("World shelf its frames go on (name or id): School."),
  scenes: z.array(z.number().int().min(1)).max(60).optional(),
  text: z.string().trim().max(4000).optional().describe("The \"what\" without style words or flags: place, shot, light, objects."),
  imagePrompts: z.array(ref).max(5).optional().describe("Brief/reference images that hold the architecture, e.g. the school brief photos at weight 0.75."),
  aspect: z.string().trim().max(12).optional().describe("16:9 by default."),
  seed: z.number().int().min(0).max(4294967295).optional().describe("Fixed --seed; a stable one is made from the ingestKey when left out."),
  extraParams: z.string().trim().max(200).nullable().optional().describe("Flags that belong to the place, not the style (rare)."),
  note: z.string().trim().max(1000).nullable().optional(),
  lockedFrame: z.string().trim().max(120).nullable().optional().describe("asset:<id> of the take Michael picked; restyle mode frame attaches it with --edit."),
  lockedFrameLabel: z.string().trim().max(120).optional(),
  currentStyle: z.string().trim().max(200).nullable().optional().describe("The world style it is shown in now (style:<id> or name)."),
  sourceQueueItemIds: z.array(z.string().trim().max(120)).max(20).optional(),
  archived: z.boolean().optional(),
  expectedRevision: z.number().int().min(1).optional(),
  session,
});

export const lockedRestyleSchema = z.object({
  world,
  prompts: z.array(z.string().trim().min(1).max(200)).max(60).optional().describe("Locked prompts (lp:<id> or ingestKey)."),
  places: z.array(z.string().trim().min(1).max(80)).max(20).optional().describe("Every locked prompt of these places: \"School\", \"School · Patio\", \"mexico-city-streets\"."),
  styles: z.array(z.string().trim().min(1).max(200)).min(1).max(6).describe("World styles: style:<id> or name (CAS STORYBOOK)."),
  mode: z.enum(["seed", "frame"]).describe("seed: same prompt and seed, new generation (similar composition; a new sref or profile still moves it). frame: the locked frame attached with --edit, same layout, new look."),
  recipe: z.number().int().min(0).max(7).optional().describe("Which recipe of each style (default the first)."),
  thread: z.string().trim().max(120).optional().describe("Thread label; default \"<World> · <place> · in <styles>\"."),
  dryRun: z.boolean().optional().describe("Compose and show the commands; write nothing."),
});

export const lockedResultsSchema = z.object({
  world,
  thread: z.string().trim().max(120).optional().describe("A restyle thread (thr-xxxxxxxx or its label); default every restyle in the world."),
  prompt: z.string().trim().max(200).optional(),
  session,
});
