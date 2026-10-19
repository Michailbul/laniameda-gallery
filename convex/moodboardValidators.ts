import { v } from "convex/values";

export const moodboardStatusValidator = v.union(
  v.literal("draft"), v.literal("in-midjourney"), v.literal("archived"),
);

// A code the board carried before its current one. `at` is when it was
// replaced; prompts made with it still count as made with the board.
export const moodboardCodeHistoryEntryValidator = v.object({
  code: v.string(),
  at: v.number(),
  note: v.optional(v.string()),
});

// Mirrors the `moodboards` table in schema.ts; tests keep the two in step.
export const moodboardDocValidator = v.object({
  _id: v.id("moodboards"),
  _creationTime: v.number(),
  ownerUserId: v.string(),
  folderId: v.id("folders"),
  name: v.string(),
  normalizedName: v.string(),
  description: v.optional(v.string()),
  styleTag: v.optional(v.string()),
  status: moodboardStatusValidator,
  mjCode: v.optional(v.string()),
  mjMoodboardId: v.optional(v.string()),
  mjUrl: v.optional(v.string()),
  mjSyncedAt: v.optional(v.number()),
  mjSyncedItemCount: v.optional(v.number()),
  mjCodeHistory: v.optional(v.array(moodboardCodeHistoryEntryValidator)),
  notes: v.optional(v.string()),
  coverAssetId: v.optional(v.id("assets")),
  itemCount: v.number(),
  revision: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const moodboardPreviewValidator = v.object({
  assetId: v.id("assets"),
  kind: v.union(v.literal("image"), v.literal("video")),
  url: v.optional(v.string()),
  thumbUrl: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
});
