type SearchableAsset = {
  name?: string; description?: string; agentDescription?: string; promptText?: string;
  fileName?: string; sourceUrl?: string; tagNames?: string[];
  bookmark?: { text?: string; authorName?: string; authorHandle?: string; userNote?: string; quotedPost?: { text?: string } };
};

/** Plain substring search, shared by scoped agent listing paths. */
export const galleryAssetSearchText = (asset: SearchableAsset) => [
  asset.name, asset.description, asset.agentDescription, asset.promptText,
  asset.fileName, asset.sourceUrl, ...(asset.tagNames ?? []),
  asset.bookmark?.text, asset.bookmark?.authorName, asset.bookmark?.authorHandle,
  asset.bookmark?.userNote, asset.bookmark?.quotedPost?.text,
].filter(Boolean).join("\n").toLowerCase();

const SEARCH_WORD_SPLIT = /[^\p{L}\p{N}]+/u;

/**
 * Whole-word match for the keyword results that follow a ranked search: every
 * word of the query must be a word of the text, so "car" finds "car" and
 * "cars" but not "character" or "scarf". Plurals count in both directions.
 */
// Words that carry no subject: "rainy street at night" asks for rainy,
// street and night.
const SEARCH_FILLER_WORDS = new Set([
  "a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with",
]);

export const galleryWordMatcher = (query: string) => {
  const all = query.toLowerCase().split(SEARCH_WORD_SPLIT).filter(Boolean);
  const subject = all.filter((term) => !SEARCH_FILLER_WORDS.has(term));
  const terms = subject.length > 0 ? subject : all;
  if (terms.length === 0) return () => false;
  return (text: string) => {
    const words = new Set(text.toLowerCase().split(SEARCH_WORD_SPLIT));
    return terms.every(
      (term) =>
        words.has(term) ||
        words.has(`${term}s`) ||
        words.has(`${term}es`) ||
        (term.length > 3 && term.endsWith("s") && words.has(term.slice(0, -1))),
    );
  };
};
