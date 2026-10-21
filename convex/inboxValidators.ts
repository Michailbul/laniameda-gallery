import { v } from "convex/values";

// The world Inbox (convex/inbox.ts): stacks of cards agents post for Michael.
// Shared by the schema and the functions' return validators.

export const inboxStackStatusValidator = v.union(v.literal("open"), v.literal("closed"));

export const inboxCardTypeValidator = v.union(
  v.literal("sort"), v.literal("duplicates"), v.literal("artifact"),
  v.literal("ab"), v.literal("choose"), v.literal("rule"),
);

export const inboxTargetKindValidator = v.union(
  v.literal("moodboard"), v.literal("collection"), v.literal("option"), v.literal("out"),
);

// A drop zone on a sort card. The hotkey (1–9, in order) is its key.
export const inboxTargetValidator = v.object({
  hotkey: v.number(),
  label: v.string(),
  kind: inboxTargetKindValidator,
  moodboardId: v.optional(v.id("moodboards")),
  folderId: v.optional(v.id("folders")),
});

export const inboxMatchValidator = v.object({
  kind: v.union(
    v.literal("same-job"), v.literal("same-prompt"), v.literal("same-hash"),
    v.literal("similarity"), v.literal("same-source"), v.literal("other"),
  ),
  label: v.string(),
  // 0–1 for a similarity; a distance for a hash.
  score: v.optional(v.number()),
});

// Facts the agent found, never taste.
export const inboxEvidenceValidator = v.object({
  text: v.optional(v.string()),
  matches: v.optional(v.array(inboxMatchValidator)),
  // Artifact cards: the defect, boxed in 0–1 image coordinates.
  defect: v.optional(v.object({
    box: v.object({ x: v.number(), y: v.number(), w: v.number(), h: v.number() }),
    note: v.optional(v.string()),
  })),
  priceUsd: v.optional(v.number()),
  priceNote: v.optional(v.string()),
});

export const inboxChoiceValidator = v.union(
  v.literal("target"), v.literal("skip"), v.literal("keep"), v.literal("fix"), v.literal("out"),
  v.literal("winner"), v.literal("neither"), v.literal("pick"), v.literal("yes"), v.literal("no"),
  v.literal("not-yet"), v.literal("stack"), v.literal("keep-all"), v.literal("resolve"),
);

// What a decision changed in the gallery, so undo reverses exactly that.
export const inboxAppliedValidator = v.union(
  v.object({
    kind: v.literal("moodboard"),
    moodboardId: v.id("moodboards"),
    assetId: v.id("assets"),
    // False when the image was already on the board.
    added: v.boolean(),
  }),
  v.object({
    // Collection membership; "Out" files into the world's hidden Out collection.
    kind: v.literal("collection"),
    folderId: v.id("folders"),
    assetId: v.id("assets"),
    added: v.boolean(),
    // True when the decision also made it the asset's primary collection.
    setPrimary: v.boolean(),
  }),
  v.object({
    // Duplicates collapsed into one stack: cover first, then the alternates.
    kind: v.literal("stack"),
    packId: v.id("assetPacks"),
    members: v.array(v.id("assets")),
    // Each member's pack before, to restore on undo.
    previous: v.array(v.object({
      assetId: v.id("assets"),
      packId: v.optional(v.id("assetPacks")),
      slot: v.optional(v.number()),
    })),
  }),
);

export const inboxStackFields = {
  ownerUserId: v.string(),
  // The world (a root collection) whose Inbox holds the stack.
  worldFolderId: v.id("folders"),
  title: v.string(),
  note: v.optional(v.string()),
  agent: v.optional(v.string()),
  ingestKey: v.optional(v.string()),
  status: inboxStackStatusValidator,
  // The card types in the stack, for its label in lists.
  cardTypes: v.array(inboxCardTypeValidator),
  createdAt: v.number(),
  updatedAt: v.number(),
  closedAt: v.optional(v.number()),
};

export const inboxStackDocValidator = v.object({
  _id: v.id("inboxStacks"),
  _creationTime: v.number(),
  ...inboxStackFields,
});

// A card never changes after it is posted; its answer lives in inboxDecisions.
export const inboxCardFields = {
  ownerUserId: v.string(),
  stackId: v.id("inboxStacks"),
  worldFolderId: v.id("folders"),
  position: v.number(),
  type: inboxCardTypeValidator,
  // The agent's own key: re-posting it into the stack is a no-op.
  key: v.optional(v.string()),
  question: v.optional(v.string()),
  assetIds: v.array(v.id("assets")),
  // Per-image labels, e.g. "Board v1" / "Board v2" on an A/B card.
  labels: v.optional(v.array(v.string())),
  targets: v.optional(v.array(inboxTargetValidator)),
  evidence: v.optional(inboxEvidenceValidator),
  ruleText: v.optional(v.string()),
  createdAt: v.number(),
};

// Open/decided counts per stack, kept apart from the stack and its cards so
// a decision never re-runs the queries that read images.
export const inboxCountFields = {
  ownerUserId: v.string(),
  stackId: v.id("inboxStacks"),
  worldFolderId: v.id("folders"),
  status: inboxStackStatusValidator,
  cards: v.number(),
  decided: v.number(),
};

export const inboxDecisionFields = {
  ownerUserId: v.string(),
  stackId: v.id("inboxStacks"),
  cardId: v.id("inboxCards"),
  // Absent on a card that only carries a comment or was undone.
  choice: v.optional(inboxChoiceValidator),
  targetHotkey: v.optional(v.number()),
  // The winner of an A/B, the pick of a choose-one.
  pickedAssetId: v.optional(v.id("assets")),
  // Duplicates: the chosen cover, the images to delete, and those deleted.
  coverAssetId: v.optional(v.id("assets")),
  deleteAssetIds: v.optional(v.array(v.id("assets"))),
  deletedAssetIds: v.optional(v.array(v.id("assets"))),
  applied: v.optional(v.array(inboxAppliedValidator)),
  decidedAt: v.optional(v.number()),
  // A comment on the card as a whole (rule cards); notes on single images
  // are asset comments.
  commentText: v.optional(v.string()),
  audioStorageId: v.optional(v.id("_storage")),
  audioDurationMs: v.optional(v.number()),
  audioContentType: v.optional(v.string()),
  commentedAt: v.optional(v.number()),
  updatedAt: v.number(),
};
