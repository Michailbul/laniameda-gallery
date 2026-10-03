// Motion design references: assets (usually video) tagged `motion-design`,
// filtered on their own facets. The tab reads the tag category of each tag, so
// a new technique needs no code: tag it with category `motion_technique`.

export const MOTION_TAG = "motion-design";

export type MotionFacetKey =
  | "motion_technique"
  | "motion_format"
  | "motion_tool"
  | "motion_feel";

export const MOTION_FACETS: {
  key: MotionFacetKey;
  label: string;
  hint: string;
  examples: string[];
}[] = [
  {
    key: "motion_technique",
    label: "Technique",
    hint: "What moves and how",
    examples: ["morph", "mask-reveal", "iris", "goo", "parallax", "kinetic-type", "text-roll", "glass", "camera-move", "path-draw", "counter", "stagger", "shader"],
  },
  {
    key: "motion_format",
    label: "Format",
    hint: "What the piece is",
    examples: ["product-launch", "ui-demo", "explainer", "logo-reveal", "title-sequence", "social-ad", "data-viz", "loop", "transition-pack"],
  },
  {
    key: "motion_tool",
    label: "Built with",
    hint: "Where it was made",
    examples: ["code", "remotion", "after-effects", "canvas", "three-js", "gsap", "css", "lottie", "rive", "blender"],
  },
  {
    key: "motion_feel",
    label: "Feel",
    hint: "How it plays",
    examples: ["smooth", "snappy", "playful", "cinematic", "minimal", "bold"],
  },
];

export const MOTION_FACET_KEYS = MOTION_FACETS.map((facet) => facet.key);

export const canonicalTag = (name: string) =>
  name.trim().toLowerCase().replace(/^#+/, "").replace(/[_\s]+/g, "-");

type MotionAsset = {
  name?: string;
  fileName?: string;
  description?: string;
  agentDescription?: string;
  promptText?: string;
  sourceUrl?: string;
  tagNames: string[];
};

export const motionSearchText = (asset: MotionAsset) =>
  [
    asset.name,
    asset.fileName,
    asset.description,
    asset.agentDescription,
    asset.promptText,
    asset.sourceUrl,
    asset.tagNames.join(" "),
  ]
    .filter(Boolean)
    .join(" \n ")
    .toLowerCase();

/** AND across facets, OR inside one facet. `selected` holds canonical tag names. */
export const matchesMotionFilters = (
  tagNames: string[],
  selected: Partial<Record<MotionFacetKey, string[]>>,
) => {
  const owned = new Set(tagNames.map(canonicalTag));
  return MOTION_FACET_KEYS.every((key) => {
    const picks = selected[key];
    return !picks || picks.length === 0 || picks.some((tag) => owned.has(tag));
  });
};
