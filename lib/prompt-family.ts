// Prompt families: which saved prompts are the same prompt, or a variation of
// one. The gallery folds a family into one pack card, so four renders of a
// prompt saved one by one — or the same prompt with the last line rewritten —
// read as one piece of work instead of a row of near-twins.
//
// Pure and dependency-free on purpose: the grid groups with it today, and the
// Convex side can import the same rules (convex/ already imports from ../lib)
// when packs get stamped at ingest.

import { meaningfulPrompt } from "./prompt";

/** Fewer content words than this and a prompt is too generic to group on. */
export const MIN_IDENTICAL_TOKENS = 4;
/** Variations need a bit more text: short prompts overlap by accident. */
export const MIN_VARIATION_TOKENS = 6;
/** Share of all content words two prompts must have in common. */
export const VARIATION_JACCARD = 0.6;
/** "Same prompt plus a sentence": the shorter one almost fully inside the
 *  longer one, as long as the two still overlap this much overall. */
export const VARIATION_OVERLAP = 0.85;
export const VARIATION_OVERLAP_JACCARD_FLOOR = 0.45;
/** A variation joins a family only while the family is still being worked
 *  on. The same prompt verbatim joins at any distance. */
export const VARIATION_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

// Each family is matched against its first few distinct prompts only, so one
// drifting variation can't chain the whole vault into a single pack.
const MAX_FAMILY_REPRESENTATIVES = 4;
// Words that appear in this many families say nothing about which one a
// prompt belongs to; they're skipped when looking for candidates.
const COMMON_TOKEN_FAMILIES = 48;
// A real variation shares most of its rare words with its family, so it ranks
// near the top; checking only the leaders keeps a big vault cheap to group.
const MAX_CANDIDATE_FAMILIES = 12;

const STOPWORDS = new Set(
  (
    "a an the and or but of in on at to for with by from as into onto over " +
    "under is are was were be been being it its this that these those his " +
    "her their our your my he she they we you i"
  ).split(" "),
);

// Midjourney-style parameters (`--ar 16:9`, `--seed 42`, `--style raw`) change
// between renders of one prompt; they aren't part of what the prompt says.
const PARAMETER_FLAG = /(^|\s)--[a-z][\w-]*(\s+(?!--)[^\s]+)?/gi;
const URL = /https?:\/\/\S+/gi;

export type PromptFingerprint = {
  /** The prompt's content words in order — equal keys are the same prompt. */
  key: string;
  tokens: ReadonlySet<string>;
};

const tokenize = (text: string): string[] =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(URL, " ")
    .replace(PARAMETER_FLAG, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1 || /\d/.test(token))
    .filter((token) => !STOPWORDS.has(token));

// The grid rebuilds on every filter change; prompt text rarely changes.
const FINGERPRINT_CACHE_LIMIT = 5000;
const fingerprintCache = new Map<string, PromptFingerprint | null>();

export function promptFingerprint(
  text?: string | null,
): PromptFingerprint | null {
  const clean = meaningfulPrompt(text);
  if (!clean) return null;
  const cached = fingerprintCache.get(clean);
  if (cached !== undefined) return cached;

  const tokens = tokenize(clean);
  const unique = new Set(tokens);
  const fingerprint =
    unique.size >= MIN_IDENTICAL_TOKENS
      ? { key: tokens.join(" "), tokens: unique }
      : null;

  if (fingerprintCache.size >= FINGERPRINT_CACHE_LIMIT) fingerprintCache.clear();
  fingerprintCache.set(clean, fingerprint);
  return fingerprint;
}

const sharedTokenCount = (
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
) => {
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  let shared = 0;
  for (const token of small) {
    if (large.has(token)) shared += 1;
  }
  return shared;
};

/** True when two prompts are the same prompt or a variation of one another. */
export function arePromptVariations(
  left: PromptFingerprint,
  right: PromptFingerprint,
): boolean {
  if (left.key === right.key) return true;
  if (
    left.tokens.size < MIN_VARIATION_TOKENS ||
    right.tokens.size < MIN_VARIATION_TOKENS
  ) {
    return false;
  }
  const shared = sharedTokenCount(left.tokens, right.tokens);
  const union = left.tokens.size + right.tokens.size - shared;
  const jaccard = shared / union;
  if (jaccard >= VARIATION_JACCARD) return true;
  const overlap = shared / Math.min(left.tokens.size, right.tokens.size);
  return (
    jaccard >= VARIATION_OVERLAP_JACCARD_FLOOR && overlap >= VARIATION_OVERLAP
  );
}

export type PromptFamilyItem = {
  createdAt: number;
  /** Every prompt the item carries (a pack can hold more than one). Items
   *  with no groupable prompt stay on their own. */
  promptTexts: ReadonlyArray<string | undefined>;
};

type Family = {
  members: number[];
  representatives: PromptFingerprint[];
  oldestCreatedAt: number;
};

/**
 * Folds items into prompt families. Returns groups of indices into `items`,
 * each ordered newest first, the groups themselves in the order their newest
 * member was seen (newest first). Every item lands in exactly one group.
 */
export function clusterPromptFamilies(
  items: ReadonlyArray<PromptFamilyItem>,
): number[][] {
  const order = items
    .map((_, index) => index)
    .sort(
      (left, right) =>
        items[right]!.createdAt - items[left]!.createdAt || left - right,
    );

  const families: Family[] = [];
  const familyByKey = new Map<string, number>();
  const familiesByToken = new Map<string, Set<number>>();

  for (const index of order) {
    const item = items[index]!;
    const prints: PromptFingerprint[] = [];
    for (const text of item.promptTexts) {
      const print = promptFingerprint(text);
      if (print && !prints.some((existing) => existing.key === print.key)) {
        prints.push(print);
      }
    }

    let target: number | undefined;
    for (const print of prints) {
      target = familyByKey.get(print.key);
      if (target !== undefined) break;
    }

    if (target === undefined && prints.length > 0) {
      const sharedByFamily = new Map<number, number>();
      for (const print of prints) {
        for (const token of print.tokens) {
          const holders = familiesByToken.get(token);
          if (!holders || holders.size > COMMON_TOKEN_FAMILIES) continue;
          for (const familyIndex of holders) {
            if (
              families[familyIndex]!.oldestCreatedAt - item.createdAt >
              VARIATION_WINDOW_MS
            ) {
              continue;
            }
            sharedByFamily.set(
              familyIndex,
              (sharedByFamily.get(familyIndex) ?? 0) + 1,
            );
          }
        }
      }
      const candidates = [...sharedByFamily.entries()]
        .sort((left, right) => right[1] - left[1] || left[0] - right[0])
        .slice(0, MAX_CANDIDATE_FAMILIES)
        .map(([familyIndex]) => familyIndex);
      for (const familyIndex of candidates) {
        const family = families[familyIndex]!;
        const matches = family.representatives.some((representative) =>
          prints.some((print) => arePromptVariations(representative, print)),
        );
        if (matches) {
          target = familyIndex;
          break;
        }
      }
    }

    if (target === undefined) {
      target = families.length;
      families.push({
        members: [],
        representatives: [],
        oldestCreatedAt: item.createdAt,
      });
    }

    const family = families[target]!;
    family.members.push(index);
    family.oldestCreatedAt = Math.min(family.oldestCreatedAt, item.createdAt);
    for (const print of prints) {
      if (!familyByKey.has(print.key)) familyByKey.set(print.key, target);
      if (
        family.representatives.length >= MAX_FAMILY_REPRESENTATIVES ||
        family.representatives.some((existing) => existing.key === print.key)
      ) {
        continue;
      }
      family.representatives.push(print);
      for (const token of print.tokens) {
        const holders = familiesByToken.get(token) ?? new Set<number>();
        holders.add(target);
        familiesByToken.set(token, holders);
      }
    }
  }

  return families.map((family) => family.members);
}
