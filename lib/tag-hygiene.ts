// Tags that say which model or app made a picture ("Midjourney",
// "Midjourney 7", "nano banana 2", "GPT Image 2.5 Flare"). The asset's
// modelName field already carries that, so as tags they only add noise to
// tiles, search text and the tag list (Michael, 9 Nov 2026: "we don't need
// the tags midjourney 7"). Saves drop them; tiles never show them.

const MODEL_FAMILIES = [
  "midjourney", "mj", "niji", "nano banana", "nanobanana", "gpt image", "gpt-image", "dall e", "dalle",
  "seedream", "seedance", "flux", "krea", "ideogram", "recraft", "imagen", "gemini", "kling", "veo", "sora",
  "runway", "gen", "luma", "ray", "hailuo", "minimax", "wan", "hunyuan", "stable diffusion", "sdxl", "sd",
  "higgsfield", "magnific", "leonardo", "firefly", "qwen image", "grok imagine", "uni",
];

const SUFFIX = "(\\s?v?\\d+(\\.\\d+)*)?(\\s(pro|flare|sunburst|max|ultra|turbo|fast|lite|plus|dev|schnell|raw|edit))*";
const MODEL_TAG = new RegExp(
  `^(${MODEL_FAMILIES.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})${SUFFIX}$`,
  "i",
);

const fold = (name: string) => name.trim().toLowerCase().replace(/[\s_\-·]+/g, " ").replace(/\s+/g, " ");

// Names that are only ever a model. The others are ordinary words too
// (runway, flux, firefly, luma, gen …) and count only with a version.
const BARE_MODELS = new Set([
  "midjourney", "mj", "niji", "nano banana", "nanobanana", "gpt image", "dall e", "dalle", "seedream", "seedance",
  "ideogram", "recraft", "imagen", "kling", "hailuo", "minimax", "hunyuan", "stable diffusion", "sdxl", "higgsfield",
  "magnific", "qwen image", "grok imagine", "krea",
]);

/** A tag that only names the model ("Midjourney 7", "flux pro", "Nano Banana 2"). */
export const isModelTag = (name: string) => {
  const folded = fold(name);
  if (!folded || !MODEL_TAG.test(folded)) return false;
  return BARE_MODELS.has(folded) || /\d/.test(folded) || /\s(pro|flare|sunburst|max|ultra|turbo|fast|lite|plus|dev|schnell|raw|edit)$/.test(folded);
};

/** Where a picture was picked up (Midjourney Explore, web, teach): kept for filters, not shown on tiles. */
const SOURCE_TAGS = new Set(["midjourney explore", "midjourney web", "midjourney teach"]);

/** Tags left off a tile's label line: model names and pickup sources. */
export const isTileHiddenTag = (name: string) => isModelTag(name) || SOURCE_TAGS.has(fold(name));

/** Drops model-name tags from a list of tag inputs before they are saved. */
export const withoutModelTags = <T extends { name: string }>(tags: T[]) => tags.filter((tag) => !isModelTag(tag.name));
