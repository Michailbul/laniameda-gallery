// Quick edit of a Midjourney prompt (extension: select text in the Imagine
// bar, ⌥E, say what to change). Client-safe helpers shared by the Convex
// runner (convex/promptEditRunner.ts) and the extension route.

import { CINEMATIC_RULES_GENERAL, DEAR_ANNETE_CINEMATIC, MJ_PROMPT_KNOWLEDGE } from "./mj-prompt-knowledge";
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
- Change only what the instruction asks. Keep every other word, the order, the voice and the length close to the original. The one exception is a request for an ordinary prompt (below): that rewrites every sentence.
- Return plain text only: no quotes around it, no markdown, no notes, no "Here is".
- Image links appear as [[IMG1]], [[IMG2]] …: keep each placeholder exactly where it is unless told to remove it.
- Keep every Midjourney parameter (--ar, --sref, --profile, --stylize, --chaos, --raw, --hd, --relax, --draft, --sw, --iw …) exactly as written unless the instruction is about it. Parameters stay at the end.
- The version is the one exception: every job is --v 8.2. Never write --v 8.1, --version 8.1, --v 7 or any older version, even when asked; where the text pins one, write --v 8.2.
- Midjourney reads plain visual description: subject, setting, light, materials, camera, film. Write it as concrete nouns and adjectives in full sentences. No instructions to the model ("make sure", "please"), no negatives ("no people"): say what is there instead ("the street is empty").
- If you get a SELECTION and a FULL PROMPT, rewrite only the selection so it fits back into the full prompt in its place, and return only the new selection.
- When the instruction asks you to add world details or move the prompt into a world, size what you add to the shot, as below.

${MJ_PROMPT_KNOWLEDGE}

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
  // An ordinary-prompt rewrite sometimes echoes the instruction first.
  text = text.replace(/^(?:(?:re)?write(?:n)?\s+(?:it\s+)?as\s+(?:an?\s+)?)?(?:ordinary|normal|plain)\s+prompt\s*:\s*/i, "").trim();
  if (text.length > 1 && /^["“'][\s\S]*["”']$/.test(text)) text = text.slice(1, -1).trim();
  return text;
}

/** "rewrite it as ordinary prompt", "normal prompt pls", "no edit mode", "without the attachment" … */
export const ORDINARY_PROMPT_ASK = /\b(?:ordinary|normal|plain|regular|simple|text[- ]to[- ]image|t2i)\b[\s\S]{0,20}\bprompt\b|\bno edit(?:ing)? mode\b|\bwithout (?:the |an? |any )?(?:edit mode|attachments?|references?|attached images?)\b|\bnot instructive\b/i;

const ORDINARY_REMINDER = "This asks for an ordinary prompt: follow the ordinary-prompt steps. A person, room or place seen only in an attachment is described with what this prompt writes about it and nothing more: no hair, skin, eyes, walls or furniture the prompt does not name.";

// The cinematic rules bind what the edit writes; the rest of the prompt stays as it is.
const CINEMATIC_LEAD = "When you write or rewrite description, write it by these rules. Words the instruction does not touch stay as they are.";

export function buildQuickEditMessages({ prompt, selection, instruction, system, worldBrief, worldKey }: {
  prompt: string; selection?: string; instruction: string; system?: string;
  /** The world's files, already laid out (lib/writer-brief.ts composeBrief). */
  worldBrief?: string;
  /** The world the brief belongs to: a dear-annete world adds its cinematic addendum. */
  worldKey?: string;
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
    `${CINEMATIC_LEAD}\n\n${CINEMATIC_RULES_GENERAL}`,
    /^dear-annete/.test(worldKey ?? "") ? DEAR_ANNETE_CINEMATIC : "",
    worldBrief?.trim() ? `${worldBrief.trim()}\n\nThe edit stays inside this world. Still change only what the instruction asks, and still return the edited text and nothing else.` : "",
    system?.trim() ? `Project context (what we like, what to avoid):\n${system.trim()}` : "",
  ].filter(Boolean).join("\n\n");
  const reminder = ORDINARY_PROMPT_ASK.test(instruction) ? `\n\n${ORDINARY_REMINDER}` : "";
  const user = selectionText
    ? `FULL PROMPT:\n${full.masked}\n\nSELECTION:\n${selectionText}\n\nINSTRUCTION: ${instruction.trim()}${reminder}`
    : `PROMPT:\n${full.masked}\n\nINSTRUCTION: ${instruction.trim()}${reminder}`;
  return { messages: [{ role: "system" as const, content: systemText }, { role: "user" as const, content: user }], urls: full.urls };
}
