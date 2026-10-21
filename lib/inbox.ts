// The world Inbox ("Decisions" in the UI): stacks of cards that agents post
// for Michael, one decision per card. Shared by the Convex backend, the
// agent route, the MCP schemas and the /inbox screens.

export const INBOX_LIMITS = {
  stackTitle: 120,
  note: 2000,
  agent: 80,
  ingestKey: 200,
  cardKey: 200,
  question: 600,
  label: 60,
  evidenceText: 1200,
  matchLabel: 120,
  ruleText: 600,
  cardsPerPost: 100,
  cardsPerStack: 300,
  assetsPerStack: 600,
  minTargets: 2,
  maxTargets: 9,
  commentText: 4000,
  audioBytes: 15 * 1024 * 1024,
  audioMs: 10 * 60 * 1000,
  listStacks: 100,
  previews: 4,
} as const;

export const INBOX_CARD_TYPES = ["sort", "duplicates", "artifact", "ab", "choose", "rule"] as const;
export type InboxCardType = (typeof INBOX_CARD_TYPES)[number];

// How many images each card type carries.
export const INBOX_CARD_ASSETS: Record<InboxCardType, { min: number; max: number }> = {
  sort: { min: 1, max: 1 },
  duplicates: { min: 2, max: 8 },
  artifact: { min: 1, max: 1 },
  ab: { min: 2, max: 2 },
  choose: { min: 2, max: 12 },
  rule: { min: 0, max: 12 },
};

export const INBOX_CARD_LABEL: Record<InboxCardType, string> = {
  sort: "Sort",
  duplicates: "Duplicates",
  artifact: "Artifact",
  ab: "A / B",
  choose: "Choose one",
  rule: "Rule",
};

export const INBOX_TARGET_KINDS = ["moodboard", "collection", "option", "out"] as const;
export type InboxTargetKind = (typeof INBOX_TARGET_KINDS)[number];
export const INBOX_TARGET_KIND_LABEL: Record<InboxTargetKind, string> = {
  moodboard: "Moodboard",
  collection: "Collection",
  option: "Option",
  out: "Out · hidden",
};

export const INBOX_MATCH_KINDS = ["same-job", "same-prompt", "same-hash", "similarity", "same-source", "other"] as const;
export type InboxMatchKind = (typeof INBOX_MATCH_KINDS)[number];

export const INBOX_CHOICES = [
  "target", "skip", "keep", "fix", "out", "winner", "neither", "pick", "yes", "no", "not-yet", "stack", "keep-all", "resolve",
] as const;
export type InboxChoice = (typeof INBOX_CHOICES)[number];

// Which answers each card type takes. Skip ("decide later") fits every card.
export const INBOX_CHOICES_BY_TYPE: Record<InboxCardType, readonly InboxChoice[]> = {
  sort: ["target", "skip"],
  duplicates: ["keep-all", "stack", "resolve", "skip"],
  artifact: ["fix", "keep", "out", "skip"],
  ab: ["winner", "neither", "skip"],
  choose: ["pick", "skip"],
  rule: ["yes", "no", "not-yet", "skip"],
};

export const INBOX_STACK_STATUSES = ["open", "closed"] as const;
export type InboxStackStatus = (typeof INBOX_STACK_STATUSES)[number];

// The hidden collection that "Out" files into, inside the card's world.
export const INBOX_OUT_FOLDER_NAME = "Out";

export const inboxStackRef = (id: string) => `stack:${id}`;
export const inboxCardRef = (id: string) => `card:${id}`;
export const bareInboxRef = (value: string) =>
  value.trim().replace(/^(stack|stacks|inboxStack|inboxStacks|card|cards|inboxCard|inboxCards|asset|assets|moodboard|moodboards|collection|folder|folders|world):/, "");

// The short ID printed on an image; the copy button copies `asset:<id>`.
export const shortAssetId = (assetId: string) => assetId.slice(-6);

type DecisionLike = { cardId: string; choice?: InboxChoice };

// A skipped card is decided for now ("decide later") and counts as done.
export const isDecided = (decision: DecisionLike | undefined) => Boolean(decision?.choice);

export const nextOpenIndex = (
  cardIds: readonly string[],
  decisions: ReadonlyMap<string, DecisionLike>,
  fromIndex: number,
) => {
  const count = cardIds.length;
  for (let step = 1; step <= count; step += 1) {
    const index = (fromIndex + step + count) % count;
    if (!isDecided(decisions.get(cardIds[index]!))) return index;
  }
  return -1;
};

export const inboxProgress = (cardIds: readonly string[], decisions: readonly DecisionLike[]) => {
  const inStack = new Set(cardIds);
  let decided = 0;
  let skipped = 0;
  for (const row of decisions) {
    if (!inStack.has(row.cardId) || !row.choice) continue;
    decided += 1;
    if (row.choice === "skip") skipped += 1;
  }
  return { total: cardIds.length, decided, skipped, pending: cardIds.length - decided };
};

export const inboxCaption = (fields: {
  agentDescription?: string; description?: string; promptText?: string; fileName?: string;
}) => {
  const pick = [fields.agentDescription, fields.description, fields.promptText, fields.fileName]
    .map((value) => value?.replace(/\s+/g, " ").trim())
    .find(Boolean);
  if (!pick) return undefined;
  const sentence = /^(.{20,}?[.!?])(\s|$)/.exec(pick)?.[1] ?? pick;
  return sentence.length > 160 ? `${sentence.slice(0, 157).trimEnd()}…` : sentence;
};

export const formatDuration = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

export const formatUsd = (value: number) =>
  value < 1 ? `$${value.toFixed(value < 0.1 ? 3 : 2)}` : `$${value.toFixed(2)}`;

// A defect box in 0–1 image coordinates, clamped inside the image.
export const clampBox = (box: { x: number; y: number; w: number; h: number }) => {
  const round = (value: number) => Math.round(value * 10000) / 10000;
  const x = round(Math.min(1, Math.max(0, box.x)));
  const y = round(Math.min(1, Math.max(0, box.y)));
  return { x, y, w: round(Math.min(1 - x, Math.max(0, box.w))), h: round(Math.min(1 - y, Math.max(0, box.h))) };
};
