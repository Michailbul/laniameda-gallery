import { v } from "convex/values";
import { mjQueueRefValidator } from "./mjQueueValidators";
import { variantValidator } from "./promptGridValidators";

// Locked location prompts (convex/lockedPrompts.ts, lib/locked-prompt.ts): one
// style-neutral prompt per place of a project, with the references that hold
// its architecture, an aspect, a fixed seed and optionally the frame Michael
// picked. Restyled into any world style through the MJ Queue. Art-director
// scope: owner and agents only; nothing here reaches the director review.

export const restyleModeValidator = v.union(v.literal("seed"), v.literal("frame"));

export const lockedFrameValidator = v.object({
  assetId: v.id("assets"),
  // What --edit attaches: the Midjourney CDN image when the frame came from a
  // Midjourney job (what the Edit model reads best), else the gallery copy.
  editUrl: v.string(),
  thumbUrl: v.optional(v.string()),
  label: v.optional(v.string()),
});

export const lockedTakeValidator = v.object({
  assetId: v.id("assets"),
  styleId: v.optional(v.id("worldStyles")),
  presetId: v.optional(v.id("stylePresets")),
  variantKey: v.optional(v.string()),
  seed: v.optional(v.number()),
  mode: v.optional(restyleModeValidator),
  queueItemId: v.optional(v.id("mjQueueItems")),
  jobId: v.optional(v.string()),
  at: v.number(),
});

// What a revision keeps (the record minus bookkeeping).
export const lockedPromptContentFields = {
  title: v.string(),
  // "School · Patio": the area before the dot groups places.
  place: v.string(),
  // Director-review folder slug it is a place of (school).
  reviewFolder: v.optional(v.string()),
  // The world shelf its frames go on (School).
  shelfId: v.optional(v.id("folders")),
  scenes: v.array(v.number()),
  // The "what", without style words: the place, the shot, the light.
  text: v.string(),
  // Brief or reference images that hold the architecture, with their weight (--iw).
  imagePrompts: v.array(mjQueueRefValidator),
  aspect: v.string(),
  seed: v.number(),
  // Flags that belong to the place, not the style (rare: --weird, --tile).
  extraParams: v.optional(v.string()),
  note: v.optional(v.string()),
  lockedFrame: v.optional(lockedFrameValidator),
  // The style it is shown in now (the recipe its first frames used).
  currentStyleId: v.optional(v.id("worldStyles")),
  // 2–3 wordings (short, prose, style-neutral), each with its own locked
  // seeds. Absent: the text on the locked seed is the one neutral variant.
  variants: v.optional(v.array(variantValidator)),
  // Images attached for the Edit model on every run (a design sheet).
  attach: v.optional(v.array(mjQueueRefValidator)),
};

export const lockedPromptFields = {
  ownerUserId: v.string(),
  worldFolderId: v.id("folders"),
  ingestKey: v.string(),
  ...lockedPromptContentFields,
  takes: v.array(lockedTakeValidator),
  // Queue items it was first written as (the seed thread).
  sourceQueueItemIds: v.array(v.id("mjQueueItems")),
  archivedAt: v.optional(v.number()),
  searchText: v.string(),
  revision: v.number(),
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const lockedPromptRevisionFields = {
  ownerUserId: v.string(),
  lockedPromptId: v.id("lockedPrompts"),
  revision: v.number(),
  ...lockedPromptContentFields,
  savedBy: v.string(),
  savedAt: v.number(),
};
