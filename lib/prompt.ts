// Single source of truth for "does this asset actually have a prompt?".
//
// Gallery entries fall back to the file name or the literal "Untitled prompt"
// when an asset has no prompt text (see lib/gallery-entries.ts), so a plain
// truthy/trim check is not enough — those placeholders would light up a PROMPT
// button that reveals nothing useful. The rule: a prompt is shown only when
// it carries real content. Empty, placeholder words ("untitled", "n/a", …),
// "Untitled …" phrases, and bare file names are treated as no prompt.

const PLACEHOLDER_PROMPTS = new Set([
  "untitled",
  "unknown",
  "n/a",
  "na",
  "none",
  "null",
  "prompt",
  "image",
  "video",
  "asset",
  "-",
  "—",
  "...",
]);

/**
 * Returns the prompt only when it's meaningful; otherwise `undefined` so callers
 * can hide the prompt UI. Filters empties, placeholder words (incl. trailing
 * numbers like "Untitled 2"), "Untitled …" fallbacks, and bare file names
 * ("img_0421.png", "angry.mp4").
 */
export function meaningfulPrompt(raw?: string | null): string | undefined {
  const text = raw?.trim();
  if (!text) return undefined;
  const lower = text.toLowerCase();
  if (PLACEHOLDER_PROMPTS.has(lower)) return undefined;
  // Any "Untitled …" fallback (e.g. "Untitled prompt", "Untitled 2").
  if (/^untitled\b/.test(lower)) return undefined;
  // A placeholder word with a trailing index ("prompt 3", "image-2").
  const base = lower.replace(/[\s_-]*\d+$/, "").trim();
  if (PLACEHOLDER_PROMPTS.has(base)) return undefined;
  // A single token that's just a media file name.
  if (/^\S+\.(png|jpe?g|webp|gif|mp4|mov|webm)$/i.test(text)) return undefined;
  return text;
}

/** Convenience predicate for gating prompt UI. */
export function hasMeaningfulPrompt(raw?: string | null): boolean {
  return meaningfulPrompt(raw) !== undefined;
}
