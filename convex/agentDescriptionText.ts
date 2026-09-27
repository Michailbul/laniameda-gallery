// Pure helpers for agent descriptions and the semantic-search text lane.
// No Convex runtime imports, so mutations, actions and tests can all use them.

// Short on purpose: one or two sentences an agent can read at a glance.
export const AGENT_DESCRIPTION_MAX_LENGTH = 400;

// Gemini's embedding input is capped; the text lane never needs more.
const TEXT_LANE_MAX_LENGTH = 6000;
const TEXT_LANE_PROMPT_MAX_LENGTH = 2500;

export const normalizeAgentDescription = (value?: string | null) => {
  const collapsed = value?.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return undefined;
  }
  if (collapsed.length <= AGENT_DESCRIPTION_MAX_LENGTH) {
    return collapsed;
  }

  const cut = collapsed.slice(0, AGENT_DESCRIPTION_MAX_LENGTH);
  // Prefer ending on a full sentence when one ends reasonably late.
  const lastStop = cut.lastIndexOf(". ");
  if (lastStop >= AGENT_DESCRIPTION_MAX_LENGTH / 2) {
    return cut.slice(0, lastStop + 1);
  }
  return `${cut.replace(/\s+\S*$/, "")}…`;
};

export const sourceDomainOf = (url?: string | null) => {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).hostname.replace(/^www\./, "") || undefined;
  } catch {
    return undefined;
  }
};

export type AssetTextLaneSource = {
  agentDescription?: string;
  description?: string;
  promptText?: string;
  tagNames: string[];
  modelName?: string;
  designTitle?: string;
  designSummary?: string;
  designSourceDomain?: string;
  sourceUrl?: string;
};

const clean = (value?: string | null) => {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : undefined;
};

// The words an asset is findable by. The agent description leads because it
// is written for retrieval; the prompt is clipped so a long prompt cannot
// drown the rest. Returns "" when the asset carries no text at all.
export const buildAssetTextLane = (source: AssetTextLaneSource) => {
  const domain = clean(source.designSourceDomain) ?? sourceDomainOf(source.sourceUrl);
  const tagNames = source.tagNames.map((tag) => tag.trim()).filter(Boolean);
  const promptText = clean(source.promptText);
  const parts = [
    clean(source.agentDescription),
    clean(source.description),
    clean(source.designTitle),
    clean(source.designSummary),
    promptText ? promptText.slice(0, TEXT_LANE_PROMPT_MAX_LENGTH) : undefined,
    tagNames.length > 0 ? `tags: ${tagNames.join(", ")}` : undefined,
    clean(source.modelName) ? `model: ${clean(source.modelName)}` : undefined,
    domain ? `source: ${domain}` : undefined,
  ].filter((part): part is string => Boolean(part));

  return parts.join("\n").slice(0, TEXT_LANE_MAX_LENGTH);
};
