import { z } from "zod";
import {
  INBOX_CARD_TYPES, INBOX_LIMITS, INBOX_MATCH_KINDS, INBOX_STACK_STATUSES, INBOX_TARGET_KINDS, bareInboxRef,
} from "./inbox";

// Agent-facing Inbox payloads, shared by /api/agent/inbox and the MCP tool
// schemas. IDs may keep the prefix they were copied with (stack:, card:,
// asset:, moodboard:, collection:).

const ref = (what: string) => z.string().trim().min(1).describe(what);

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

export const inboxPostSchema = z.object({
  worldFolderId: ref("The world (root collection) whose Inbox gets the cards."),
  stackId: ref("stack:<id>: append to this open stack.").optional(),
  stackTitle: z.string().trim().min(1).max(INBOX_LIMITS.stackTitle).optional().describe("Title of a new stack, e.g. Duplicates · 12 or Daylight V2 · 31 candidates."),
  ingestKey: z.string().trim().min(1).max(INBOX_LIMITS.ingestKey).optional().describe("Stable key: posting again with it appends to the same stack."),
  note: z.string().max(INBOX_LIMITS.note).optional().describe("Shown under the stack title: why these cards, what happens after."),
  agent: z.string().max(INBOX_LIMITS.agent).optional().describe("Who posts, e.g. Hygiene routine."),
  cards: z.array(inboxCardInputSchema).min(1).max(INBOX_LIMITS.cardsPerPost),
});

export const inboxListSchema = z.object({
  worldFolderId: ref("A world (root collection). Omit for every world.").optional(),
  status: z.enum(INBOX_STACK_STATUSES).optional().describe("open (default) or closed."),
  limit: z.number().int().min(1).max(INBOX_LIMITS.listStacks).optional(),
});

export const inboxStackRefSchema = z.object({ stackId: ref("stack:<id> from post_inbox_cards or list_inbox_stacks.") });

export const inboxCloseSchema = z.object({
  stackId: ref("stack:<id>."),
  reopen: z.boolean().optional().describe("true reopens a closed stack."),
});

export const bareOptionalInboxRef = (value: string | undefined) => (value === undefined ? undefined : bareInboxRef(value));
