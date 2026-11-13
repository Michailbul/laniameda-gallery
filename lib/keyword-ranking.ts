// Keyword search that needs no embedding provider (convex/assetKeywords.ts).
// Pure helpers: the full-text index finds candidates that hold any of the
// request's words; these rank them so pieces tagged with what was asked lead,
// then pieces that hold every word, then the rest.

import { canonicalTagKey } from "../convex/helpers";

const WORD_SPLIT = /[^\p{L}\p{N}]+/u;

// Words that carry no subject, and search-bar phrasing around the subject.
const FILLER = new Set([
  "a", "an", "and", "at", "by", "for", "from", "in", "into", "of", "on", "or", "the", "to", "with",
  "show", "me", "find", "some", "any", "all", "my", "our", "is", "are", "that", "this", "these",
  "image", "images", "picture", "pictures", "photo", "photos", "frame", "frames",
]);

// Convex full-text search reads at most 16 terms.
const MAX_SEARCH_TOKENS = 16;
const MAX_TERMS = 8;

const words = (text: string) => text.toLowerCase().split(WORD_SPLIT).filter(Boolean);

/** The request's subject words, in order, without filler. */
export const keywordTerms = (query: string) => {
  const all = words(query);
  const subject = all.filter((word) => !FILLER.has(word));
  return [...new Set(subject.length > 0 ? subject : all)].slice(0, MAX_TERMS);
};

// "cars" and "car" find each other; so do "boxes" and "box".
const variants = (term: string) => {
  const forms = [term];
  if (term.length > 3 && /(s|x|z|ch|sh)es$/.test(term)) forms.push(term.slice(0, -2));
  if (term.length > 3 && term.endsWith("s") && !term.endsWith("ss")) forms.push(term.slice(0, -1));
  else if (/(s|x|z|ch|sh)$/.test(term)) forms.push(`${term}es`);
  else forms.push(`${term}s`);
  return forms;
};

/** The request's steps, each as its subject words; empty steps dropped. */
export const keywordClauses = (query: string) =>
  query.split(",").map(keywordTerms).filter((clause) => clause.length > 0);

/** The string handed to the full-text index: every term and its plural or singular. */
export const keywordSearchString = (terms: string[]) => {
  const tokens: string[] = [];
  for (const term of terms) {
    for (const form of variants(term)) {
      if (tokens.length < MAX_SEARCH_TOKENS && !tokens.includes(form)) tokens.push(form);
    }
  }
  return tokens.join(" ");
};

const holds = (set: Set<string>, term: string) => variants(term).some((form) => set.has(form));

export type KeywordCandidate<T> = { item: T; text: string; tagNames: string[] };

/**
 * Score candidates, best first. `candidates` arrive in the index's own
 * relevance order, which breaks ties.
 *  - tag: the share of the request's words found in the piece's tags
 *  - exact: a tag is the request, or a several-word tag ("dear annete") is in it
 *  - words: the share of the request's words anywhere in its text
 * Pieces holding none of the words as whole words (a prefix hit: "car" in
 * "character") are dropped while any candidate holds one.
 */
export const rankKeywordCandidates = <T>(query: string, candidates: Array<KeywordCandidate<T>>) => {
  const terms = keywordTerms(query);
  if (terms.length === 0) return [];
  // Each step of a search arrives as its own comma clause ("library, candles").
  // A later step never widens the results: pieces must answer the earlier
  // steps, and the newest step narrows them further when any piece answers it.
  const clauses = keywordClauses(query);
  const earlier = clauses.slice(0, -1);
  const newest = clauses.at(-1) ?? [];
  const wanted = canonicalTagKey(terms.join(" "));
  const total = candidates.length;
  const scored = candidates.map((candidate, index) => {
    const textWords = new Set(words(candidate.text));
    const tagKeys = candidate.tagNames.map((tag) => canonicalTagKey(tag)).filter(Boolean);
    const tagWords = new Set(tagKeys.flatMap((key) => key.split(" ")));
    for (const word of tagWords) textWords.add(word);
    const inText = terms.filter((term) => holds(textWords, term)).length / terms.length;
    const inTags = terms.filter((term) => holds(tagWords, term)).length / terms.length;
    const exact = tagKeys.some((key) =>
      key === wanted ||
      (key.includes(" ") && ` ${wanted} `.includes(` ${key} `)),
    ) ? 1 : 0;
    const position = total > 1 ? 1 - index / (total - 1) : 1;
    return {
      item: candidate.item,
      inText,
      earlierHit: earlier.filter((clause) => clause.some((term) => holds(textWords, term))).length,
      newestHit: newest.some((term) => holds(textWords, term)),
      score: 0.45 * inText + 0.3 * inTags + 0.15 * exact + 0.1 * position,
    };
  });
  const anyWhole = scored.some((hit) => hit.inText > 0);
  let kept = scored.filter((hit) => !anyWhole || hit.inText > 0);
  if (clauses.length > 1) {
    const mostEarlier = Math.max(0, ...kept.map((hit) => hit.earlierHit));
    kept = kept.filter((hit) => hit.earlierHit === mostEarlier);
    if (kept.some((hit) => hit.newestHit)) kept = kept.filter((hit) => hit.newestHit);
  }
  return kept
    .sort((left, right) => right.score - left.score)
    .map(({ item, score }) => ({ item, score }));
};
