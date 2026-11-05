import { z } from "zod";
import { CHARACTER_LANES, CHARACTER_LINK_ROLES, CHARACTER_STATUSES } from "./character-codes";

// Agent-facing character payloads, shared by /api/agent/characters and the
// MCP tool schemas. A character is addressed by its code (DA-CH-001) or
// character:<id>; IDs from other tools may keep their asset:/collection: prefix.
// Every schema is strict: a key a tool does not take (a stray `world` on
// get_character, a misspelled filter) is refused instead of silently ignored.

const ref = z.string().trim().min(1).describe("Character code such as DA-CH-001, or character:<id>.");
const assetRef = z.string().trim().min(1).describe("asset:<id> or bare asset ID.");
const clearableText = (max: number) => z.string().max(max).nullable().optional();
const worldRef = z.string().trim().min(1).max(200).describe("The world: its key (dear-annete), name or root collection ID, as open_world resolves it. open_world with no arguments lists the worlds.");
const worldFolderIdAlias = z.string().trim().min(1).max(200).describe("Alias of world: the world's root collection ID.");

/** The world a request names: `world` first, `worldFolderId` as the older alias. */
export const worldRefOf = (input: { world?: string; worldFolderId?: string }) => input.world ?? input.worldFolderId;
/** The character a request names: `character` first, `id` as an alias. */
export const characterRefOf = (input: { character?: string; id?: string }) => (input.character ?? input.id)!;
const oneOf = (first: string, second: string) => (value: Record<string, unknown>) => Boolean(value[first] || value[second]);

export const characterStatusSchema = z.enum(CHARACTER_STATUSES);
export const characterLaneSchema = z.enum(CHARACTER_LANES);
export const characterLinkRoleSchema = z.enum(CHARACTER_LINK_ROLES);

export const characterListSchema = z.strictObject({
  world: worldRef.optional().describe("Only this world's cast: key (dear-annete), name or root collection ID. Omit for every world."),
  worldFolderId: worldFolderIdAlias.optional(),
  status: characterStatusSchema.optional(),
  search: z.string().max(200).optional().describe("Matches code, name, alias, other names, role, notes and costume names."),
  limit: z.number().int().min(1).max(1000).optional(),
});

export const characterCreateSchema = z.strictObject({
  world: worldRef.optional().describe("The world the person belongs to (required unless worldFolderId is given)."),
  worldFolderId: worldFolderIdAlias.optional(),
  name: z.string().trim().min(1).max(80).describe("First name, e.g. Ilka."),
  alias: z.string().max(120).optional().describe("Distinguishing alias, e.g. Tram-Stop Flower Seller. Name plus alias is unique inside the world."),
  otherNames: z.array(z.string().max(80)).max(12).optional().describe("Former or alternate names kept for search, e.g. a retired name."),
  role: z.string().max(120).optional().describe("Story role, e.g. heroine, suitor, minor."),
  lane: characterLaneSchema.optional(),
  status: characterStatusSchema.optional().describe("Defaults to concept. approved and sheeted only on Michael's word."),
  sheetAssetId: assetRef.optional().describe("Canonical master character sheet."),
  faceAssetId: assetRef.optional().describe("Face close-up anchor."),
  nameTag: z.string().max(80).optional().describe("The plain name tag used on this person's assets, e.g. ilka."),
  notes: z.string().max(20000).optional(),
  prefix: z.string().max(4).optional().describe("Only for a world's first character when the derived prefix clashes, e.g. DA."),
}).refine(oneOf("world", "worldFolderId"), { message: "world is required: the world's key, name or root collection ID.", path: ["world"] });

// No defaults: omission keeps the stored value, null clears it.
export const characterUpdateSchema = z.strictObject({
  character: ref,
  expectedRevision: z.number().int().positive().describe("revision from get_character; prevents overwriting a concurrent edit."),
  name: z.string().trim().min(1).max(80).optional(),
  alias: clearableText(120),
  otherNames: z.array(z.string().max(80)).max(12).optional(),
  role: clearableText(120),
  lane: characterLaneSchema.nullable().optional(),
  status: characterStatusSchema.optional(),
  sheetAssetId: assetRef.nullable().optional(),
  faceAssetId: assetRef.nullable().optional(),
  nameTag: clearableText(80),
  notes: clearableText(20000),
});

export const characterCostumeSchema = z.strictObject({
  character: ref,
  code: z.string().max(20).optional().describe("Existing costume to edit: C01 or DA-CH-001-C01. Omit to add a new costume."),
  name: z.string().trim().min(1).max(120).optional().describe("Costume name; required for a new costume. Same name returns the existing costume."),
  status: characterStatusSchema.optional(),
  sheetAssetId: assetRef.nullable().optional(),
  faceAssetId: assetRef.nullable().optional(),
  notes: clearableText(5000),
});

export const characterLinkSchema = z.strictObject({
  character: ref,
  links: z.array(z.strictObject({
    assetId: assetRef,
    role: characterLinkRoleSchema.describe("concept, sheet, face, costume (wardrobe study), appears-in (scene/still) or reference."),
    costumeCode: z.string().max(20).optional().describe("C01 or DA-CH-001-C01 when the asset belongs to one costume."),
    note: z.string().max(500).optional(),
  })).min(1).max(100),
});

export const characterUnlinkSchema = z.strictObject({ character: ref, assetIds: z.array(assetRef).min(1).max(100) });
export const characterRefSchema = z.strictObject({
  character: ref.optional(),
  id: ref.optional().describe("Alias of character: the code or character:<id>."),
}).refine(oneOf("character", "id"), { message: "character is required: a code such as DA-CH-001 or character:<id>.", path: ["character"] });
export const characterRemoveCostumeSchema = z.strictObject({ character: ref, code: z.string().min(1).max(20) });

export const bareId = (value: string) => value.trim().replace(/^(asset|assets|collection|folder|folders|character):/, "");
export const bareOptionalId = <T extends string | null | undefined>(value: T) =>
  (typeof value === "string" ? bareId(value) : value) as T;
