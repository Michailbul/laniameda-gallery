import { z } from "zod";

// Agent input for prompt sets × style presets × seeds (/api/agent/prompt-grid).
const world = z.string().trim().min(1).max(120).describe("The project's world (cassandra).");
const session = z.string().trim().max(80).optional();
const presetRef = z.string().trim().min(1).max(200).describe("preset:<id>, its id or ingestKey.");

export const presetListSchema = z.object({ world, includeArchived: z.boolean().optional() });
export const presetSaveSchema = z.object({
  world,
  preset: presetRef.optional().describe("An existing preset to change."),
  ingestKey: z.string().trim().max(200).optional(),
  name: z.string().trim().max(100).optional().describe("\"CAS STORYBOOK\", \"CAS STORYBOOK · stylize 750\"."),
  codes: z.array(z.string().trim().min(1).max(40)).max(12).optional().describe("Moodboard and profile CODES as they are now (frozen; never a board id). Named from the gallery's records."),
  srefs: z.array(z.object({ code: z.string().trim().min(1).max(40), sv: z.string().trim().max(4).optional(), weight: z.number().optional() })).max(6).optional().describe("Style references with their --sv version."),
  parameters: z.string().trim().max(300).nullable().optional().describe("The rest of the recipe: --stylize 600 --chaos 5 --raw --v 8.2. Aspect and seed come from the prompt."),
  sentence: z.string().trim().max(300).nullable().optional().describe("Opening style sentence, e.g. \"Painted storybook animation frame.\""),
  note: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(["candidate", "locked", "archived"]).optional(),
  session,
});
export const presetFromStyleSchema = z.object({ world, style: z.string().trim().min(1).max(200).describe("style:<id> or the world style's name."), recipe: z.number().int().min(0).max(7).optional(), name: z.string().trim().max(100).optional(), session });
export const presetPerturbSchema = z.object({
  world, preset: presetRef,
  perturbations: z.array(z.object({
    kind: z.enum(["board_alone", "sref_only", "add_profile", "drop_profiles", "stylize", "raw", "chaos", "sv", "version"]),
    value: z.string().trim().max(40).optional().describe("stylize 250/750, raw on/off, add_profile <code>, sv 6, version 8.1 …"),
  })).min(1).max(12),
  session,
});
export const presetToStyleSchema = z.object({
  world, preset: presetRef,
  style: z.string().trim().max(200).optional().describe("An existing world style to add this recipe to; left out, a new draft style named after the preset."),
  session,
});
export const setListSchema = z.object({ world });
export const setSaveSchema = z.object({
  world, set: z.string().trim().max(200).optional(), ingestKey: z.string().trim().max(200).optional(),
  name: z.string().trim().max(100).optional().describe("\"Cassandra test shots\", \"Cassandra locations\"."),
  kind: z.enum(["test_shots", "locations", "custom"]).optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  prompts: z.array(z.string().trim().min(1).max(200)).max(60).optional().describe("Locked prompts in order (lp:<id> or ingestKey); replaces the list."),
  session,
});
export const runSchema = z.object({
  world,
  set: z.string().trim().max(200).optional().describe("A prompt set (set:<id> or ingestKey)."),
  prompts: z.array(z.string().trim().min(1).max(200)).max(40).optional().describe("Extra or only prompts."),
  variants: z.array(z.string().trim().min(1).max(24)).max(3).optional().describe("Which variant keys (default all; screening uses the first)."),
  presets: z.array(presetRef).min(1).max(16),
  stage: z.enum(["screen", "refine"]).describe("screen: every preset × each prompt's first variant on its first seed. refine: also the other variants (and seeds with allSeeds)."),
  allSeeds: z.boolean().optional(),
  draft: z.boolean().optional().describe("Draft (24 small images per job). Default on for screen, off for refine."),
  name: z.string().trim().max(100).optional(),
  thread: z.string().trim().max(120).optional(),
});
export const runRefSchema = z.object({ run: z.string().trim().min(1).max(200).describe("run:<id> or the thread id thr-xxxxxxxx."), session });
