import { z } from "zod";
import {
  INBOX_CARD_TYPES, INBOX_LIMITS, INBOX_MATCH_KINDS, INBOX_STACK_STATUSES, INBOX_TARGET_KINDS, bareInboxRef,
} from "./inbox";

// Agent-facing Inbox payloads, shared by /api/agent/inbox and the MCP tool
// schemas. IDs may keep the prefix they were copied with (stack:, card:,
// asset:, moodboard:, collection:). The top-level schemas are strict: a key a
// tool does not take is refused, not ignored.

const ref = (what: string) => z.string().trim().min(1).describe(what);
const worldRef = z.string().trim().min(1).max(200).describe("The world: its key (dear-annete), name or root collection ID, as open_world resolves it. open_world with no arguments lists the worlds.");
const worldFolderIdAlias = z.string().trim().min(1).max(200).describe("Alias of world: the world's root collection ID.");
const oneOf = (first: string, second: string) => (value: Record<string, unknown>) => Boolean(value[first] || value[second]);

/** The world a request names: `world` first, `worldFolderId` as the older alias. */
export const inboxWorldRefOf = (input: { world?: string; worldFolderId?: string }) => input.world ?? input.worldFolderId;
/** The stack a request names: `stackId` first, `id` as an alias. */
export const inboxStackRefOf = (input: { stackId?: string; id?: string }) => (input.stackId ?? input.id)!;

export const inboxTargetInputSchema = z.object({
  kind: z.enum(INBOX_TARGET_KINDS).describe("moodboard: appends the image to that gallery moodboard. collection: adds the asset to that collection (other memberships stay). option: records the choice only. out: files it into the world's hidden Out collection (nothing is deleted)."),
  label: z.string().trim().min(1).max(INBOX_LIMITS.label).optional().describe("Shown on the drop zone. Defaults to the moodboard's or collection's name, or Out; required for an option."),
  moodboardId: ref("moodboard:<id> from list_moodboards. Moodboard targets only.").optional(),
  folderId: ref("Collection ID from list_collections (a style branch, shelf or any plain collection). Collection targets only.").optional(),
});

export const inboxEvidenceSchema = z.object({
  text: z.string().max(INBOX_LIMITS.evidenceText).optional().describe("Facts only: what was found and where. Never which option is better."),
  matches: z.array(z.object({
    kind: z.enum(INBOX_MATCH_KINDS),
    label: z.string().max(INBOX_LIMITS.matchLabel).describe("e.g. same Midjourney job 3f2a…, same prompt, pHash distance 4"),
    score: z.number().optional().describe("A similarity 0–1, or a hash distance."),
  })).max(12).optional().describe("Duplicates: how the images match."),
  defect: z.object({
    box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).describe("The defect in 0–1 image coordinates from the top-left."),
    note: z.string().max(INBOX_LIMITS.matchLabel).optional().describe("What is wrong, e.g. six fingers on the left hand."),
  }).optional().describe("Artifact cards: required."),
  priceUsd: z.number().min(0).optional().describe("Artifact cards: what the repair costs."),
  priceNote: z.string().max(INBOX_LIMITS.matchLabel).optional().describe("e.g. Krea 3 edit on fal"),
});

export const inboxCardInputSchema = z.object({
  type: z.enum(INBOX_CARD_TYPES).describe("sort (1 image, 2–9 targets) · duplicates (2–8 near-identical images) · artifact (1 image + evidence.defect, priceUsd) · ab (2 images) · choose (2–12 options) · rule (ruleText + 0–12 evidence images)"),
  key: z.string().trim().min(1).max(INBOX_LIMITS.cardKey).optional().describe("Your stable key for the card; re-posting it into the stack is skipped."),
  question: z.string().trim().min(1).max(INBOX_LIMITS.question).optional().describe("The question on this card, in plain words."),
  assetIds: z.array(ref("asset:<id> or bare asset ID.")).max(12),
  labels: z.array(z.string().max(INBOX_LIMITS.label)).max(12).optional().describe("One label per image, e.g. Board v1 / Board v2."),
  targets: z.array(inboxTargetInputSchema).min(INBOX_LIMITS.minTargets).max(INBOX_LIMITS.maxTargets).optional().describe("Sort cards only: 2–9 targets; hotkeys 1–9 follow this order."),
  evidence: inboxEvidenceSchema.optional(),
  ruleText: z.string().trim().min(1).max(INBOX_LIMITS.ruleText).optional().describe("Rule cards: the proposed automatic rule."),
});

export const inboxPostSchema = z.strictObject({
  world: worldRef.optional().describe("The world whose Inbox gets the cards: key (dear-annete), name or root collection ID (required unless worldFolderId is given)."),
  worldFolderId: worldFolderIdAlias.optional(),
  stackId: ref("stack:<id>: append to this open stack.").optional(),
  stackTitle: z.string().trim().min(1).max(INBOX_LIMITS.stackTitle).optional().describe("Title of a new stack, e.g. Duplicates · 12 or Daylight V2 · 31 candidates."),
  ingestKey: z.string().trim().min(1).max(INBOX_LIMITS.ingestKey).optional().describe("Stable key: posting again with it appends to the same stack."),
  note: z.string().max(INBOX_LIMITS.note).optional().describe("Shown under the stack title: why these cards, what happens after."),
  agent: z.string().max(INBOX_LIMITS.agent).optional().describe("Who posts, e.g. Hygiene routine."),
  cards: z.array(inboxCardInputSchema).min(1).max(INBOX_LIMITS.cardsPerPost),
}).refine(oneOf("world", "worldFolderId"), { message: "world is required: the world's key, name or root collection ID.", path: ["world"] });

export const inboxListSchema = z.strictObject({
  world: worldRef.optional().describe("Only this world's stacks: key (dear-annete), name or root collection ID. Omit for every world."),
  worldFolderId: worldFolderIdAlias.optional(),
  status: z.enum(INBOX_STACK_STATUSES).optional().describe("open (default) or closed."),
  limit: z.number().int().min(1).max(INBOX_LIMITS.listStacks).optional(),
});

export const inboxStackRefSchema = z.strictObject({
  stackId: ref("stack:<id> from post_inbox_cards or list_inbox_stacks.").optional(),
  id: ref("Alias of stackId: stack:<id> or the bare ID.").optional(),
}).refine(oneOf("stackId", "id"), { message: "stackId is required: stack:<id> from post_inbox_cards or list_inbox_stacks.", path: ["stackId"] });

export const inboxCloseSchema = z.strictObject({
  stackId: ref("stack:<id>."),
  reopen: z.boolean().optional().describe("true reopens a closed stack."),
});

export const similarGroupsSchema = z.strictObject({
  world: worldRef.optional().describe("Scan a whole world (root and shelves): key, name or root collection ID. Give world or folderId."),
  folderId: ref("A world root or any collection (ID from list_collections or open_world).").optional(),
  includeChildren: z.boolean().optional().describe("Also scan its child collections (a world's style branches and shelves). On by default with world."),
  maxDistance: z.number().int().min(0).max(24).optional().describe("Largest hash difference inside a group, in bits of 64. 4 ≈ the takes of one job (default 6), 10 ≈ the same shot reworked, 20 ≈ the same subject."),
  minSize: z.number().int().min(2).max(50).optional().describe("Smallest group returned (default 2)."),
  limit: z.number().int().min(1).max(50).optional().describe("Groups returned, largest first (default 30)."),
}).refine(oneOf("world", "folderId"), { message: "Give world (key, name or root ID) or folderId.", path: ["folderId"] });

export const bareOptionalInboxRef = (value: string | undefined) => (value === undefined ? undefined : bareInboxRef(value));
