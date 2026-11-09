import { v } from "convex/values";

// Prompt sets × style presets × seeds (convex/promptGrid.ts, lib/prompt-grid.ts).
// Art-director scope: owner and agents only.

export const variantValidator = v.object({
  key: v.string(),
  label: v.string(),
  kind: v.union(v.literal("short"), v.literal("prose"), v.literal("neutral")),
  text: v.string(),
  // Locked seeds of this variant, reused unchanged across every preset.
  seeds: v.array(v.number()),
});

export const presetStatusValidator = v.union(v.literal("candidate"), v.literal("locked"), v.literal("archived"));

// One exact recipe as frozen codes: a code is the version of a board or
// profile at that moment (an ID points at the latest), an sref keeps its --sv.
export const stylePresetFields = {
  ownerUserId: v.string(),
  worldFolderId: v.id("folders"),
  ingestKey: v.string(),
  name: v.string(),
  status: presetStatusValidator,
  source: v.union(v.literal("gallery"), v.literal("dock"), v.literal("style")),
  // The world style it was made from (or saved as).
  styleId: v.optional(v.id("worldStyles")),
  // A perturbation of another preset, and what changed ("stylize 750").
  parentPresetId: v.optional(v.id("stylePresets")),
  perturbation: v.optional(v.string()),
  moodboards: v.array(v.object({ code: v.string(), moodboardId: v.optional(v.id("moodboards")), name: v.optional(v.string()) })),
  profiles: v.array(v.object({ code: v.string(), profileId: v.optional(v.id("mjProfiles")), name: v.optional(v.string()) })),
  srefs: v.array(v.object({ code: v.string(), sv: v.optional(v.string()), weight: v.optional(v.number()) })),
  parameters: v.optional(v.string()),
  // Opening style sentence ("Painted storybook animation frame.").
  sentence: v.optional(v.string()),
  note: v.optional(v.string()),
  revision: v.number(),
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const promptSetFields = {
  ownerUserId: v.string(),
  worldFolderId: v.id("folders"),
  ingestKey: v.string(),
  name: v.string(),
  kind: v.union(v.literal("test_shots"), v.literal("locations"), v.literal("custom")),
  note: v.optional(v.string()),
  promptIds: v.array(v.id("lockedPrompts")),
  revision: v.number(),
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const runVerdictValidator = v.union(v.literal("keep"), v.literal("drop"));

export const promptRunFields = {
  ownerUserId: v.string(),
  worldFolderId: v.id("folders"),
  name: v.string(),
  thread: v.string(),
  threadId: v.string(),
  stage: v.union(v.literal("screen"), v.literal("refine")),
  draft: v.boolean(),
  setId: v.optional(v.id("promptSets")),
  presetIds: v.array(v.id("stylePresets")),
  promptIds: v.array(v.id("lockedPrompts")),
  jobs: v.number(),
  // Michael's keep/drop on a whole preset row, a cell (preset × prompt) or one frame.
  rowVerdicts: v.array(v.object({ presetId: v.id("stylePresets"), verdict: runVerdictValidator, at: v.number() })),
  cellVerdicts: v.array(v.object({ presetId: v.id("stylePresets"), promptId: v.id("lockedPrompts"), verdict: runVerdictValidator, at: v.number() })),
  frameVerdicts: v.array(v.object({ assetId: v.id("assets"), verdict: runVerdictValidator, at: v.number() })),
  // Frames that came back, each with its exact cell.
  frames: v.array(v.object({
    assetId: v.id("assets"), presetId: v.id("stylePresets"), promptId: v.id("lockedPrompts"),
    variantKey: v.string(), seed: v.number(), queueItemId: v.id("mjQueueItems"), at: v.number(),
  })),
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
};
