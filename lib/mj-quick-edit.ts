// Quick edit of a Midjourney prompt (extension: select text in the Imagine
// bar, ⌥E, say what to change). Client-safe helpers shared by the Convex
// runner (convex/promptEditRunner.ts) and the extension route.

import { SHOT_SCALE_RULES } from "./writer-scale";

export const QUICK_EDIT_LIMITS = {
  prompt: 8000,
  instruction: 1200,
  system: 8000,
} as const;

export const QUICK_EDIT_MODELS = ["haiku", "deepseek"] as const;
export type QuickEditModel = (typeof QUICK_EDIT_MODELS)[number];

/** Provider routes per model, tried in order: fal first, Pika when fal is blocked. */
export const QUICK_EDIT_ROUTES: Record<QuickEditModel, Array<{ provider: "fal" | "pika"; model: string; label: string }>> = {
  haiku: [
    { provider: "fal", model: "anthropic/claude-haiku-5.5", label: "Haiku 5.5" },
    // Pika has no Haiku 5.5 yet: its newest Haiku stands in.
    { provider: "pika", model: "anthropic/claude-haiku-4.5", label: "Haiku 4.5 (Pika)" },
  ],
  deepseek: [
    { provider: "fal", model: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1" },
    { provider: "fal", model: "deepseek/deepseek-v4.1", label: "DeepSeek V4.1" },
    { provider: "pika", model: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 (Pika)" },
  ],
};

// The rules every edit follows, whatever the world prompt says. The world
// prompt (editable in the extension) adds the project's taste on top.
export const QUICK_EDIT_BASE_RULES = `You edit Midjourney prompts for an art director. He selects text in the Imagine bar and tells you in a few words what to change. You return the edited text and nothing else.

Rules:
- Change only what the instruction asks. Keep every other word, the order, the voice and the length close to the original.
- Return plain text only: no quotes around it, no markdown, no notes, no "Here is".
- Image links appear as [[IMG1]], [[IMG2]] …: keep each placeholder exactly where it is unless told to remove it.
- Keep every Midjourney parameter (--ar, --sref, --profile, --stylize, --chaos, --raw, --v, --hd, --relax, --draft, --sw, --iw …) exactly as written unless the instruction is about it. Parameters stay at the end.
- Midjourney reads plain visual description: subject, setting, light, materials, camera, film. Write it as concrete nouns and adjectives in full sentences. No instructions to the model ("make sure", "please"), no negatives ("no people"): say what is there instead ("the street is empty").
- If you get a SELECTION and a FULL PROMPT, rewrite only the selection so it fits back into the full prompt in its place, and return only the new selection.
- When the instruction asks you to add world details or move the prompt into a world, size what you add to the shot, as below.

${SHOT_SCALE_RULES}`;

/** Image URLs become [[IMGn]] so the model cannot drop or garble them. */
export function protectUrls(text: string) {
  const urls: string[] = [];
  const masked = text.replace(/https?:\/\/\S+/g, (url) => {
    urls.push(url);
    return `[[IMG${urls.length}]]`;
  });
  return { masked, urls };
}

export function restoreUrls(text: string, urls: string[]) {
  return text.replace(/\[\[IMG(\d+)\]\]/g, (whole, n: string) => urls[Number(n) - 1] ?? whole);
}

/** Strips what chat models wrap answers in: fences, quotes, a lead-in line. */
export function cleanModelText(raw: string) {
  let text = raw.trim();
  const fence = /^```[a-z]*\s*\n?([\s\S]*?)\n?```$/i.exec(text);
  if (fence) text = fence[1]!.trim();
  text = text.replace(/^(?:here(?:'s| is)[^\n:]*:|edited (?:prompt|text)[^\n:]*:)\s*/i, "").trim();
  if (text.length > 1 && /^["“'][\s\S]*["”']$/.test(text)) text = text.slice(1, -1).trim();
  return text;
}

export function buildQuickEditMessages({ prompt, selection, instruction, system, worldBrief }: {
  prompt: string; selection?: string; instruction: string; system?: string;
  /** The world's files, already laid out (lib/writer-brief.ts composeBrief). */
  worldBrief?: string;
}) {
  const full = protectUrls(prompt);
  const part = selection ? protectUrls(selection) : null;
  // Placeholders in the selection must match those in the full prompt.
  let selectionText = part?.masked;
  if (part && selectionText) {
    part.urls.forEach((url, index) => {
      const at = full.urls.indexOf(url);
      if (at >= 0) selectionText = selectionText!.replace(`[[IMG${index + 1}]]`, `[[IMG${at + 1}]]`);
    });
  }
  const systemText = [
    QUICK_EDIT_BASE_RULES,
    worldBrief?.trim() ? `${worldBrief.trim()}\n\nThe edit stays inside this world. Still change only what the instruction asks, and still return the edited text and nothing else.` : "",
    system?.trim() ? `Project context (what we like, what to avoid):\n${system.trim()}` : "",
  ].filter(Boolean).join("\n\n");
  const user = selectionText
    ? `FULL PROMPT:\n${full.masked}\n\nSELECTION:\n${selectionText}\n\nINSTRUCTION: ${instruction.trim()}`
    : `PROMPT:\n${full.masked}\n\nINSTRUCTION: ${instruction.trim()}`;
  return { messages: [{ role: "system" as const, content: systemText }, { role: "user" as const, content: user }], urls: full.urls };
}
