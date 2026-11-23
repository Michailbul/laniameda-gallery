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

export const mjQueueDescribeValidator = v.object({
  sourceUrl: v.optional(v.string()),
  pageUrl: v.optional(v.string()),
  descriptions: v.array(v.string()),
  mode: v.union(v.literal("keep"), v.literal("ours")),
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
  // The retired Midjourney version the params pinned (8.1, 7 …) before they
  // were stored as --v 8.2 (lib/mj-version.ts); the item warns about it.
  replacedVersion: v.optional(v.string()),
  // Images attached for the Edit model (--edit), e.g. a locked frame to restyle.
  editRefs: v.optional(v.array(mjQueueRefValidator)),
  // A restyle of a locked location prompt (convex/lockedPrompts.ts): which
  // prompt, in which world style, by which mode; the labels the panel shows.
  lockedPromptId: v.optional(v.id("lockedPrompts")),
  placeLabel: v.optional(v.string()),
  styleId: v.optional(v.id("worldStyles")),
  styleLabel: v.optional(v.string()),
  restyleMode: v.optional(v.union(v.literal("seed"), v.literal("frame"))),
  // Made by the extension's describer (lib/mj-describe.ts): the picture it
  // came from, Midjourney's Describe lines when caught, and the style mode.
  describe: v.optional(mjQueueDescribeValidator),
  // A cell of a prompt run (convex/promptGrid.ts): preset × variant × seed.
  runId: v.optional(v.id("promptRuns")),
  presetId: v.optional(v.id("stylePresets")),
  presetLabel: v.optional(v.string()),
  variantKey: v.optional(v.string()),
  variantLabel: v.optional(v.string()),
  seed: v.optional(v.number()),
  screen: v.optional(v.boolean()),
  note: v.optional(v.string()),
  // A copy queued again from a sent prompt (to rerun it, e.g. at another
  // stylize); the sent original keeps its job and its filed frames.
  requeuedFrom: v.optional(v.id("mjQueueItems")),
  // The run of the thread this prompt belongs to (convex/mjThreads.ts): 1 when
  // unset; a rerun copies prompts into the next run with a new recipe.
  run: v.optional(v.number()),
  status: mjQueueStatusValidator,
  injectedAt: v.optional(v.number()),
  sentAt: v.optional(v.number()),
  // The exact command in the Imagine bar when he pressed Send.
  sentCommand: v.optional(v.string()),
  jobId: v.optional(v.string()),
  ingestKey: v.optional(v.string()),
  // The thread was archived (deleted from the panel, 20 Nov 2026): hidden from
  // the queue, kept with its history so an agent or the panel can restore it.
  archivedAt: v.optional(v.number()),
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
};

// A recipe a rerun or a thread edit applied (lib/mj-thread.ts MjRecipe).
export const mjRecipeValidator = v.object({
  profileCodes: v.optional(v.array(v.string())),
  addProfileCodes: v.optional(v.array(v.string())),
  removeProfileCodes: v.optional(v.array(v.string())),
  srefs: v.optional(v.array(v.string())),
  params: v.optional(v.string()),
  stylize: v.optional(v.union(v.number(), v.null())),
  chaos: v.optional(v.union(v.number(), v.null())),
  weird: v.optional(v.union(v.number(), v.null())),
  ar: v.optional(v.union(v.string(), v.null())),
  raw: v.optional(v.boolean()),
  hd: v.optional(v.boolean()),
  opening: v.optional(v.string()),
});

// One run of a thread after the first (a rerun): which run it came from,
// the recipe it applied, which prompts it copied and who asked for it.
// Run 1 has no row: its settings are read from its prompts.
export const mjThreadRunFields = {
  ownerUserId: v.string(),
  batchKey: v.string(),
  batch: v.string(),
  worldKey: v.optional(v.string()),
  run: v.number(),
  fromRun: v.number(),
  recipe: mjRecipeValidator,
  label: v.string(),
  note: v.optional(v.string()),
  itemCount: v.number(),
  // The chat message that asked for it, when one did.
  messageId: v.optional(v.id("mjThreadMessages")),
  createdBy: v.string(),
  createdAt: v.number(),
};

export const mjThreadRoleValidator = v.union(v.literal("michael"), v.literal("agent"));

// One message of a thread's chat. Michael's wait for an answer ("waiting")
// until the writer or an agent on MCP answers ("answered"); a writer failure
// leaves it waiting with the error, so an agent can still pick it up.
export const mjThreadMessageFields = {
  ownerUserId: v.string(),
  batchKey: v.string(),
  batch: v.string(),
  worldKey: v.optional(v.string()),
  role: mjThreadRoleValidator,
  author: v.string(),
  text: v.string(),
  // What the answer changed in the thread, in plain words, one line each.
  changes: v.optional(v.array(v.string())),
  // A rerun this answer queued.
  run: v.optional(v.number()),
  replyTo: v.optional(v.id("mjThreadMessages")),
  status: v.optional(v.union(v.literal("waiting"), v.literal("answered"))),
  error: v.optional(v.string()),
  model: v.optional(v.string()),
  createdAt: v.number(),
};
