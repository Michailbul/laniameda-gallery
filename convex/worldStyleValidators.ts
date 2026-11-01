import { v } from "convex/values";

// A style's state. draft = being found; ready = Michael approved the recipe;
// archived = kept out of the carousel; merged = folded into another style
// (mergedIntoStyleId), kept so links and the journal still resolve.
export const worldStyleStatusValidator = v.union(
  v.literal("draft"), v.literal("ready"), v.literal("archived"), v.literal("merged"),
);

// One way to make the style: the gallery moodboards and Midjourney profiles in
// stack order, codes the gallery has no record for yet, the parameters, a
// prompt template and how many frames it made. Names come from the linked
// records; codes are only shown to agents.
export const worldStyleRecipeValidator = v.object({
  name: v.optional(v.string()),
  moodboardIds: v.array(v.id("moodboards")),
  profileIds: v.array(v.id("mjProfiles")),
  unknownCodes: v.optional(v.array(v.string())),
  parameters: v.optional(v.string()),
  template: v.optional(v.string()),
  frames: v.optional(v.number()),
  note: v.optional(v.string()),
});
