import { v } from "convex/values";

export const storyKindValidator = v.union(v.literal("idea"), v.literal("script"), v.literal("style-lock"));
export const storyStatusValidator = v.union(v.literal("idea"), v.literal("draft"), v.literal("ready"), v.literal("archived"));
export const storyFields = {
  title: v.string(),
  body: v.string(),
  kind: storyKindValidator,
  status: storyStatusValidator,
  logline: v.optional(v.string()),
  hook: v.optional(v.string()),
  folderId: v.optional(v.id("folders")),
  styleTag: v.optional(v.string()),
  tagNames: v.array(v.string()),
  assetIds: v.array(v.id("assets")),
  storybookId: v.optional(v.id("folders")),
};
export const storyResultValidator = v.object({
  _id: v.id("stories"), _creationTime: v.number(), ownerUserId: v.string(),
  ...storyFields,
  ingestKey: v.string(), revision: v.number(), searchText: v.string(), createdAt: v.number(), updatedAt: v.number(),
});

export const presetFiltersValidator = v.object({
  selectedFilterIds: v.array(v.id("menuFilters")),
  excludedFilterIds: v.array(v.id("menuFilters")),
  folderId: v.optional(v.id("folders")),
  mediaKind: v.optional(v.union(v.literal("image"), v.literal("video"))),
  onlyLiked: v.boolean(),
  includeSkills: v.boolean(),
  flattenStacks: v.boolean(),
  sortOrder: v.union(v.literal("newest"), v.literal("featured"), v.literal("shuffle")),
});
