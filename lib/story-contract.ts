import { z } from "zod";

export const storyInputSchema = z.object({
  title: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(200000),
  kind: z.enum(["idea", "script", "style-lock"]).default("idea"),
  status: z.enum(["idea", "draft", "ready", "archived"]).default("draft"),
  logline: z.string().optional(), hook: z.string().optional(),
  folderId: z.string().optional(), styleTag: z.string().optional(),
  tagNames: z.array(z.string()).default([]), assetIds: z.array(z.string()).max(120).default([]),
  storybookId: z.string().optional(),
});
// Patches must have no defaults: omission means preserve the existing value.
// Zod 4 applies nested defaults even after .partial().
export const storyPatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(), body: z.string().trim().min(1).max(200000).optional(),
  kind: z.enum(["idea", "script", "style-lock"]).optional(),
  status: z.enum(["idea", "draft", "ready", "archived"]).optional(),
  logline: z.string().optional(), hook: z.string().optional(),
  folderId: z.string().nullable().optional(), styleTag: z.string().optional(),
  tagNames: z.array(z.string()).optional(), assetIds: z.array(z.string()).max(120).optional(),
  storybookId: z.string().nullable().optional(),
});
export const presetFiltersSchema = z.object({
  selectedFilterIds: z.array(z.string()).default([]), excludedFilterIds: z.array(z.string()).default([]),
  folderId: z.string().optional(), mediaKind: z.enum(["image", "video"]).optional(),
  onlyLiked: z.boolean().default(false), includeSkills: z.boolean().default(false),
  flattenStacks: z.boolean().default(false), sortOrder: z.enum(["newest", "featured", "shuffle"]).default("newest"),
});
