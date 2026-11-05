// Shared by Convex, the agent API and the owner UI. Codes stay strings: do
// not round long values, strip leading zeros, or merge versioned recipes.
export type MidjourneySref = {
  value: string;
  parameters: string;
  modelVersion?: string;
  styleVersion?: string;
  styleWeight?: string;
};

export const SREF_COLLECTION_NAME = "Midjourney Srefs";
export const SREF_DOMAIN = "midjourney-sref";
export const isSrefCollection = (name?: string) =>
  name?.trim().toLowerCase() === SREF_COLLECTION_NAME.toLowerCase();

const referenceToken = /^(?:\d+|https?:\/\/[^\s<>]+?)(?:::\d+(?:\.\d+)?)?$/i;

export function extractMidjourneySrefs(text: string | undefined): MidjourneySref[] {
  if (!text) return [];
  const found = new Map<string, MidjourneySref>();
  // A newline or the next named parameter ends the reference list. Ordinary
  // prose after a code is discarded, never copied into the reusable value.
  for (const line of text.split(/\r?\n/)) {
    const option = (name: string) =>
      new RegExp(`(?:^|\\s)--${name}\\s+(\\d+(?:\\.\\d+)?)(?=\\s|$)`, "i").exec(line)?.[1];
    const modelVersion = option("(?:v|version)");
    const styleVersion = option("sv");
    const styleWeight = option("sw");
    for (const match of line.matchAll(/--sref\s+(.+?)(?=\s+--[a-z]|$)/gi)) {
      const tokens: string[] = [];
      for (const raw of match[1].trim().split(/\s+/)) {
        const token = raw.replace(/[,;]+$/, "");
        if (!referenceToken.test(token)) break;
        tokens.push(token);
      }
      if (!tokens.length) continue; // "random" is not a saved reusable code.
      const value = tokens.join(" ");
      const parameters = [
        `--sref ${value}`,
        styleWeight ? `--sw ${styleWeight}` : "",
        styleVersion ? `--sv ${styleVersion}` : "",
        modelVersion ? `--v ${modelVersion}` : "",
      ].filter(Boolean).join(" ");
      found.set(parameters, { value, parameters, modelVersion, styleVersion, styleWeight });
    }
  }
  return [...found.values()];
}

export function parseSrefInput(input: string): MidjourneySref {
  const text = input.trim();
  const normalized = text.startsWith("--") ? text : `--sref ${text}`;
  const refs = extractMidjourneySrefs(normalized);
  if (refs.length !== 1 || /[\r\n]/.test(normalized)) {
    throw new Error("Enter one --sref recipe, using numeric codes or image URLs.");
  }
  // Reject unknown flags, prose, duplicate flags, and partially accepted input.
  const recipe = refs[0];
  const canonicalInput = normalized.replace(/\s+/g, " ");
  const flags = [...canonicalInput.matchAll(/--(sref|sw|sv|v|version)\s+([^]*?)(?=\s+--|$)/gi)];
  const reconstructed = flags.map((m) => m[0]).join(" ");
  const names = flags.map((m) => m[1].toLowerCase().replace(/^version$/, "v"));
  if (reconstructed !== canonicalInput || new Set(names).size !== names.length ||
      flags.some((m) => m[1].toLowerCase() === "sref"
        ? m[2].trim() !== recipe.value
        : !/^\d+(?:\.\d+)?$/.test(m[2].trim()))) {
    throw new Error("Use only --sref, --sw, --sv and --v parameters.");
  }
  if (recipe.styleWeight && Number(recipe.styleWeight) > 1000) {
    throw new Error("Style weight must be between 0 and 1000.");
  }
  return recipe;
}

export type SrefNote = { title?: string; note?: string; sourceUrl?: string };
export function httpSourceUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try { return /^https?:$/.test(new URL(value).protocol) ? value : undefined; }
  catch { return undefined; }
}
export function readSrefNote(json?: string): SrefNote {
  try {
    const raw: unknown = JSON.parse(json ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const obj = raw as Record<string, unknown>;
    return {
      title: typeof obj.title === "string" ? obj.title : undefined,
      note: typeof obj.note === "string" ? obj.note : undefined,
      sourceUrl: httpSourceUrl(obj.sourceUrl),
    };
  } catch { return {}; }
}
