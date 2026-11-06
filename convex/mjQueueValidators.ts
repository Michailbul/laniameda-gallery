import { v } from "convex/values";

// Midjourney prompt queue (convex/mjQueue.ts, lib/mj-queue.ts). Agents queue
// prompts with every reference set; Michael reviews each in the Imagine bar
// through the extension and sends it himself, one job per click.

export const mjQueueStatusValidator = v.union(
  v.literal("queued"), v.literal("injected"), v.literal("sent"), v.literal("skipped"),
);

// One reference: a public image URL Midjourney can fetch (gallery assets are
// resolved to their R2 URL when queued), or a numeric sref code.
export const mjQueueRefValidator = v.object({
  url: v.optional(v.string()),
  code: v.optional(v.string()),
  assetId: v.optional(v.id("assets")),
  thumbUrl: v.optional(v.string()),
  weight: v.optional(v.number()),
  label: v.optional(v.string()),
});

export const mjQueueItemFields = {
  ownerUserId: v.string(),
  worldFolderId: v.optional(v.id("folders")),
  worldKey: v.optional(v.string()),
  batch: v.string(),
  batchKey: v.string(),
  order: v.number(),
  // A few plain words for Michael ("The letter-writer's hand").
  title: v.optional(v.string()),
  prompt: v.string(),
  imagePrompts: v.array(mjQueueRefValidator),
  styleRefs: v.array(mjQueueRefValidator),
  omniRef: v.optional(mjQueueRefValidator),
  characterRef: v.optional(mjQueueRefValidator),
  profileCodes: v.array(v.string()),
  params: v.optional(v.string()),
  note: v.optional(v.string()),
  status: mjQueueStatusValidator,
  injectedAt: v.optional(v.number()),
  sentAt: v.optional(v.number()),
  // The exact command in the Imagine bar when he pressed Send.
  sentCommand: v.optional(v.string()),
  jobId: v.optional(v.string()),
  ingestKey: v.optional(v.string()),
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
};
