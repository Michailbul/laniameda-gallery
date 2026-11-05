import { v } from "convex/values";

export const characterStatusValidator = v.union(
  v.literal("concept"), v.literal("approved"), v.literal("sheeted"), v.literal("retired"),
);
export const characterLaneValidator = v.union(v.literal("live-action"), v.literal("animation"));
export const characterLinkRoleValidator = v.union(
  v.literal("concept"), v.literal("sheet"), v.literal("face"), v.literal("costume"),
  v.literal("appears-in"), v.literal("reference"),
);

// One costume of a person. `code` is the short form (C01); the full ID is
// `${character.code}-${code}`. Codes are never reused inside a character.
export const characterCostumeValidator = v.object({
  code: v.string(),
  name: v.string(),
  status: characterStatusValidator,
  sheetAssetId: v.optional(v.id("assets")),
  faceAssetId: v.optional(v.id("assets")),
  notes: v.optional(v.string()),
});

export const characterDocValidator = v.object({
  _id: v.id("characters"),
  _creationTime: v.number(),
  ownerUserId: v.string(),
  worldFolderId: v.id("folders"),
  code: v.string(),
  prefix: v.string(),
  number: v.number(),
  name: v.string(),
  alias: v.optional(v.string()),
  normalizedName: v.string(),
  otherNames: v.array(v.string()),
  role: v.optional(v.string()),
  lane: v.optional(characterLaneValidator),
  status: characterStatusValidator,
  sheetAssetId: v.optional(v.id("assets")),
  faceAssetId: v.optional(v.id("assets")),
  nameTag: v.optional(v.string()),
  notes: v.optional(v.string()),
  costumes: v.array(characterCostumeValidator),
  lastCostumeNumber: v.number(),
  linkCount: v.number(),
  revision: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});
