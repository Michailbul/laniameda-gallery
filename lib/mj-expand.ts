// Grow a Midjourney frame into more prompts (extension: point at an image on
// midjourney.com, ⌥X, pick a move or say an idea). The writer sees the picture
// and its prompt, keeps the look that is working (style words, codes and
// params) and writes new shots: other angles, close-ups, wides, cast, props,
// a story in six beats, a world kit. Client-safe helpers shared by the Convex
// runner (convex/promptEditRunner.ts expand) and the extension route.
//
// The model writes words only. Codes and params are never its job: they are
// lifted from the source command here and put back on every result, so a
// look made of --sref / --profile codes cannot drift.

import { parseFlags } from "./mj-recipe";
import { wordsOnly } from "./mj-describe";
import { SHOT_SCALE_RULES } from "./writer-scale";

export const EXPAND_LIMITS = {
  // A data URL of a 1024 px JPEG is about 300 KB; 3 MB leaves room for PNGs.
  image: 3_000_000,
  command: 8000,
  idea: 800,
  system: 8000,
  maxCount: 8,
} as const;

export type ExpandPreset = { key: string; label: string; count: number; hint: string; brief: string };

// The moves. `brief` is what the writer is told; `hint` is the tooltip.
export const EXPAND_PRESETS: ExpandPreset[] = [
  {
    key: "angles", label: "New angles", count: 3,
    hint: "The same moment from three other camera positions.",
    brief: `Same subject, same place, same moment, same light. Three other camera positions: (1) the reverse angle, looking back the way this camera looks, (2) a low or a high angle close to the subject, (3) a side-on or over-the-shoulder view. Say what each new position reveals that this frame hides (the wall behind the camera, the far end of the street). Wardrobe, props and weather stay identical, in the same words.`,
  },
  {
    key: "close", label: "Close-ups", count: 3,
    hint: "Three close shots cut from this frame.",
    brief: `Three close shots cut from this frame, as an editor would: (1) the face or the main object, (2) hands or a telling detail in use, (3) a material insert (fabric, metal, glass, a worn surface) under this frame's light. A long lens, shallow depth of field. The background of each is what sits right behind it in this frame, out of focus.`,
  },
  {
    key: "wide", label: "Wides", count: 3,
    hint: "The place: establishing wide, wide reverse, the full room or street.",
    brief: `Three wide shots of the place this frame belongs to: (1) the establishing wide with the subject small in it, (2) the wide reverse angle from the opposite end, (3) the full room or the full street seen straight on, quiet and empty. The place is the grammatical subject of each. Eye level or slightly above, a wide lens, deep focus. Never a tight crop.`,
  },
  {
    key: "cast", label: "Cast", count: 3,
    hint: "Three people or creatures who live in this world.",
    brief: `Three inhabitants of this world who are not in this frame. Each prompt: one figure alone, full length, standing in a corner of this same place, wardrobe built from the materials and palette already visible here. Give each two or three traits nobody else has (hair, one garment, build). Name nobody.`,
  },
  {
    key: "details", label: "Props", count: 4,
    hint: "Four objects of this world, each alone in the frame.",
    brief: `Four objects of this world, each alone as the subject: (1) a vehicle or machine, (2) a tool, weapon or instrument, (3) a piece of furniture or an architectural detail, (4) a small personal thing. Each rests on a surface from this frame, in this frame's light. One object per frame, clear silhouette, a medium-close shot.`,
  },
  {
    key: "story", label: "Story", count: 6,
    hint: "A short story from this frame, six shots, ready as a thread.",
    brief: `Invent a short story this frame could be the first or the middle beat of. Give its one-sentence LOGLINE, then six beats as six shots with real shot variety: an establishing wide, a medium shot with action, a close-up, an insert, the turning point, the closing image. The same people in every beat: repeat their wardrobe and hair words verbatim. One place family, one light logic (the hour may move on). Each TITLE is the beat in plain words.`,
  },
  {
    key: "world", label: "World kit", count: 8,
    hint: "Eight frames that turn this picture into a world.",
    brief: `The starter kit that turns this frame into a world: (1) the establishing wide, (2) the wide reverse angle, (3) an interior that belongs here, (4) a street-level or ground-level corner, (5) a lead character full length, (6) a second character or a creature, (7) a vehicle, machine or key prop, (8) a close detail insert. One look across all eight.`,
  },
];

export const EXPAND_PRESET_KEYS = EXPAND_PRESETS.map((preset) => preset.key) as [string, ...string[]];
export const expandPreset = (key?: string | null) => EXPAND_PRESETS.find((preset) => preset.key === key) ?? null;

// What the writer knows about Midjourney, whatever the world says. Packed from
// our own runs (midjourney-moodboards web-app notes, the V8.2 prompt skill).
export const EXPAND_BASE_RULES = `You write Midjourney V8.2 prompts for an art director who is exploring a look. You see one of his generated frames, and the prompt that made it when there is one. He liked this frame. Your job is to grow it: new frames that belong to the same world and keep the same look.

How the look is kept:
- Codes and parameters (--sref, --profile, --ar, --stylize …) carry most of a look. They are added to your prompts for you, unchanged. Never write a parameter, a URL or a "--" flag.
- Read the source prompt as three kinds of words:
  WORLD WORDS name the genre, the era and the kind of world ("a baroque futuristic cyberpunk town", "dark art deco city"). Keep them word for word in every prompt, attached to the new subject or place. Never drop one, never swap in a synonym.
  STYLE WORDS name the medium or look (an opening sentence such as "Dark art deco animation frame, a hand-painted background.") and the film, lens and light (closing sentences such as "Shot on 35mm colour negative film."). Copy them word for word into every prompt, in the same places.
  SUBJECT WORDS name what this one frame shows: its subject, its room, its action. They are content. Keep them only where the new frame still shows that thing: a close-up of a pot does not open with "apartment interior", a street outside is not "an interior".
- A look fades when its world and style words rotate. Repeat them; vary only the subject.
- If the source prompt is short and plain, the codes carry the look: keep your prompts short and plain too, in the same voice and about the same length. Do not add style adjectives it did not have.
- If there is no source prompt, open every prompt with one identical sentence that names the medium and rendering you see (film stock or render, paint, line, grain, palette), then the content.
- Reuse the source prompt's own nouns for people, wardrobe, materials and place. A character keeps the exact same describing words in every prompt.

How Midjourney V8 reads:
- It reads literally and weights the first words most. The grammatical subject of the first content sentence becomes the centre of the picture: lead with the person for a portrait, with the place for a wide.
- Short direct sentences, one visual unit each: subject and traits, action or pose, what is near, what is behind, light. Keep details of one region together.
- Only what a camera would record. Behaviour over emotion ("she is smiling", not "she is happy"). No backstory, symbolism or mood words.
- One picture, one shot: every word is visible in this frame. A wide says wide and describes the place; a close-up describes the face and what is right behind it.
- Light as a spec: source, direction, hour ("one low warm sun from the left, long hard shadows"), in the same words across a set.
- Say what is there, never what is not ("the street is empty", not "no people"). No commands ("create", "make", "show").
- No filler ("stunning", "masterpiece", "8k", "highly detailed", "cinematic masterpiece").
- Under 900 characters each. Shorter is usually better.
- Several people: say the headcount, give each one clause anchored to a place in the frame and two or three traits nobody else has.

Traps we have hit:
- Real names pull real things: no real city, landmark, river, artist, photographer, studio, film title, brand or franchise word. Describe forms, materials, era and light instead.
- Every lit sign grows fake letters: signs are unlit emblems with a shape, or out of frame. No lettering unless a title in quotes is the point.
- "Film still" on a very wide frame can add black bars or a caption strip: on wide frames say "photograph" or keep the source's own wording.
- Vague big shapes drift to famous ones ("cathedral towers", "a long black boat under a bridge"): give invented shapes concrete form.
- A bare "mechanical hand" or similar can come out as an instrument: describe joints, rods and wires.

${SHOT_SCALE_RULES}`;

const ANSWER_FORM = (count: number, withLogline: boolean) => [
  "Answer in exactly this form and nothing else (no markdown, no notes):",
  "SET: two to five plain words naming this set",
  withLogline ? "LOGLINE: the story in one sentence" : "",
  `Then ${count} ${count === 1 ? "entry" : "entries"}, each as:`,
  "TITLE: three to six plain words naming the frame",
  "PROMPT: the prompt, words only",
].filter(Boolean).join("\n");

export type ExpandRef = { code?: string; url?: string; weight?: number };

export type SplitCommand = {
  /** Image prompts at the head of the command. */
  images: string[];
  /** The prose. */
  words: string;
  srefs: ExpandRef[];
  profiles: string[];
  /** Every other flag, in order, as typed. */
  rest: string;
  aspect?: string;
};

// Not carried to a new frame: a seed pins one picture, --iw belongs to image
// prompts (re-added only when they are kept), --edit and --oref name a frame.
const DROP_FLAGS = new Set(["seed", "sameseed", "edit", "oref", "ow", "cref", "cw", "repeat", "r"]);

const parseRef = (token: string): ExpandRef | null => {
  const match = /^(.+?)(?:::(-?\d+(?:\.\d+)?))?$/.exec(token.trim());
  if (!match || !match[1]) return null;
  const ref: ExpandRef = /^https?:\/\//i.test(match[1]) ? { url: match[1] } : { code: match[1] };
  if (match[2] != null && Number.isFinite(Number(match[2]))) ref.weight = Number(match[2]);
  return ref;
};

export const refText = (ref: ExpandRef) => `${ref.url || ref.code || ""}${typeof ref.weight === "number" ? `::${ref.weight}` : ""}`;

/** A Midjourney command taken apart: image prompts, words, codes, the other flags. */
export function splitCommand(command: string | undefined): SplitCommand {
  let text = (command ?? "").replace(/[–—](?=[a-z])/gi, "--").replace(/\s+/g, " ").trim();
  const images: string[] = [];
  for (;;) {
    const match = /^(https?:\/\/\S+)\s*/.exec(text);
    if (!match) break;
    images.push(match[1]!);
    text = text.slice(match[0].length);
  }
  const at = text.search(/(^|\s)--[a-z]/i);
  const words = (at < 0 ? text : text.slice(0, at)).trim();
  const flags = parseFlags(at < 0 ? "" : text.slice(at));
  const srefs: ExpandRef[] = [];
  const profiles: string[] = [];
  const rest: string[] = [];
  let aspect: string | undefined;
  for (const flag of flags) {
    if (flag.name === "sref") {
      for (const value of flag.values) { const ref = parseRef(value); if (ref) srefs.push(ref); }
    } else if (flag.name === "profile") {
      for (const value of flag.values) if (!profiles.includes(value)) profiles.push(value);
    } else if (DROP_FLAGS.has(flag.name) || flag.name === "iw") {
      continue;
    } else {
      if ((flag.name === "ar" || flag.name === "aspect") && flag.values[0]) aspect = flag.values[0];
      rest.push([`--${flag.name}`, ...flag.values].join(" "));
    }
  }
  return { images, words, srefs, profiles, rest: rest.join(" "), aspect };
}

/** --iw of the source command, when it set one. */
export function imageWeightOf(command: string | undefined) {
  const flag = parseFlags((command ?? "").replace(/^[^-]*(?=--)/, "")).find((entry) => entry.name === "iw");
  return flag?.values[0];
}

export type ExpandOptions = {
  /** Keep the source's image prompts at the head of each new command. */
  keepImages?: boolean;
  /** Add this picture as a style reference (--sref <url>), first in the list. */
  srefUrl?: string;
  /** Used when the source has no --ar. */
  fallbackAspect?: string;
  iw?: string;
};

export type ExpandMade = {
  title: string;
  words: string;
  prompt: string;
  rest: string;
  profiles: string[];
  srefs: ExpandRef[];
  images: string[];
};

/** One result as a full command: [images] words rest --sref … --profile … */
export function composeExpanded(title: string, words: string, source: SplitCommand, options: ExpandOptions = {}): ExpandMade {
  const images = options.keepImages ? source.images : [];
  const srefs = [...source.srefs];
  if (options.srefUrl && !srefs.some((ref) => ref.url === options.srefUrl)) srefs.unshift({ url: options.srefUrl });
  const restParts = [source.rest];
  if (!source.aspect && options.fallbackAspect) restParts.unshift(`--ar ${options.fallbackAspect}`);
  if (images.length && options.iw) restParts.push(`--iw ${options.iw}`);
  const rest = restParts.filter(Boolean).join(" ").trim();
  const prompt = [
    ...images,
    words,
    rest,
    srefs.length ? `--sref ${srefs.map(refText).join(" ")}` : "",
    source.profiles.length ? `--profile ${source.profiles.join(" ")}` : "",
  ].filter(Boolean).join(" ");
  return { title, words, prompt, rest, profiles: source.profiles, srefs, images };
}

export type ExpandInput = {
  image: string;
  /** The words of the source prompt (no URLs, no flags). */
  sourceWords?: string;
  /** What the codes are, in plain words, for the writer's orientation only. */
  lookNote?: string;
  preset?: ExpandPreset | null;
  idea?: string;
  count: number;
  system?: string;
  /** The world's files, already laid out (lib/writer-brief.ts composeBrief). */
  worldBrief?: string;
};

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export function buildExpandMessages({ image, sourceWords, lookNote, preset, idea, count, system, worldBrief }: ExpandInput) {
  const systemText = [
    EXPAND_BASE_RULES,
    worldBrief?.trim() ?? "",
    system?.trim() ? `Project rules (his own notes for this world):\n${system.trim().slice(0, EXPAND_LIMITS.system)}` : "",
  ].filter(Boolean).join("\n\n");

  const lines: string[] = [];
  lines.push(sourceWords?.trim()
    ? `SOURCE PROMPT (the words that made this frame):\n${sourceWords.trim()}`
    : "There is no source prompt: read the look from the picture.");
  if (lookNote?.trim()) lines.push(`LOOK CARRIED BY CODES (added for you, do not write them): ${lookNote.trim()}`);
  if (preset) lines.push(`THE MOVE: ${preset.label}.\n${preset.brief}`);
  if (idea?.trim()) lines.push(`${preset ? "ART DIRECTOR'S STEER (it outranks the move's defaults)" : "ART DIRECTOR'S IDEA"}: ${idea.trim()}`);
  if (!preset) {
    lines.push(count === 1
      ? "Write one prompt for that idea, in this frame's world and look."
      : `Write ${count} prompts for that idea, in this frame's world and look. If the idea names one picture, make ${count} distinct takes on it (another framing, another moment); if it names several, one prompt each.`);
  }
  lines.push(ANSWER_FORM(count, preset?.key === "story"));

  const content: Part[] = [{ type: "image_url", image_url: { url: image } }, { type: "text", text: lines.join("\n\n") }];
  return [{ role: "system" as const, content: systemText }, { role: "user" as const, content }];
}

export type ParsedExpand = { set?: string; logline?: string; items: Array<{ title: string; words: string }> };

/** SET / LOGLINE / TITLE + PROMPT pairs from the writer's answer. */
export function parseExpandAnswer(raw: string): ParsedExpand {
  const text = raw.replace(/```[a-z]*\n?|```/gi, "").replace(/\r/g, "").trim();
  const line = (label: string) => {
    const match = new RegExp(`(?:^|\\n)\\s*[#*\\s]*${label}\\**\\s*:\\s*\\**\\s*([^\\n]+)`, "i").exec(text);
    return match?.[1]?.replace(/[*"“”]+/g, "").replace(/[.\s]+$/g, "").trim() || undefined;
  };
  const items: ParsedExpand["items"] = [];
  const pair = /(?:^|\n)[\s#*]*(?:\d+\s*[).:-]\s*)?\**TITLE\**\s*:\s*\**\s*([^\n]*)\n+[\s#*]*PROMPT\**\s*:\s*\**\s*([\s\S]*?)(?=\n[\s#*]*(?:\d+\s*[).:-]\s*)?\**TITLE\**\s*:|$)/gi;
  for (const match of text.matchAll(pair)) {
    const title = (match[1] ?? "").replace(/[*"“”]+/g, "").replace(/[.\s]+$/g, "").trim().slice(0, 80);
    const words = wordsOnly((match[2] ?? "").replace(/\*\*/g, "").replace(/https?:\/\/\S+/g, ""));
    if (words) items.push({ title: title || `Frame ${items.length + 1}`, words });
  }
  return { set: line("SET")?.slice(0, 60), logline: line("LOGLINE")?.slice(0, 300), items };
}

/** "sref 123 456 · profile abc" so the writer knows codes exist, without their values mattering. */
export function lookNoteOf(source: SplitCommand) {
  const parts: string[] = [];
  if (source.srefs.length) parts.push(`${source.srefs.length} style reference${source.srefs.length > 1 ? "s" : ""}`);
  if (source.profiles.length) parts.push(`${source.profiles.length} personalization or moodboard code${source.profiles.length > 1 ? "s" : ""}`);
  if (source.images.length) parts.push(`${source.images.length} image prompt${source.images.length > 1 ? "s" : ""} in the source`);
  if (source.rest) parts.push(`settings ${source.rest}`);
  return parts.join(", ");
}
