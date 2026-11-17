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
import { enforceMjVersion } from "./mj-version";
import { wordsOnly } from "./mj-describe";
import { MJ_BANNED_PROFILE_CODES } from "./mj-queue";
import { SHOT_SCALE_RULES } from "./writer-scale";
import { CINEMATIC_RULES_GENERAL, DEAR_ANNETE_CINEMATIC } from "./mj-prompt-knowledge";

export const EXPAND_LIMITS = {
  // A data URL of a 1024 px JPEG is about 300 KB; 3 MB leaves room for PNGs.
  image: 3_000_000,
  command: 8000,
  idea: 800,
  system: 8000,
  maxCount: 10,
  /** Previous Midjourney prompts the writer may replay (newest first). */
  previous: 10,
  previousChars: 1500,
} as const;

export type ExpandPreset = {
  key: string; label: string; count: number; hint: string; brief: string;
  /** A move about one place: the writer fixes a PLACE LINE and a LIGHT LINE first and repeats them in every view. */
  location?: boolean;
  /** The move rewrites the previous prompts one by one (count = how many there are). */
  replay?: boolean;
};

// The location rules every place move follows (from lib/mj-prompt-knowledge.ts, LOCATION RULES).
const LOCATION_LINES = `Write a fixed PLACE LINE first (architecture style, materials, ground, one landmark feature) and a fixed LIGHT LINE (source, direction, hour, weather), from what this frame shows. Copy both word for word into every view; change only the camera sentence. Every view is wide: a 24mm or 28mm lens, deep focus, verticals straight, camera at eye level or slightly low unless the view says high. The place is the grammatical subject of the first sentence. People are small or absent.`;

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
    hint: "Three real-looking people who live in this world.",
    brief: `Three real-looking people of this world who are not in this frame, in grounded, believable clothes (a dark wool coat, a plain suit, a simple dress) named by material and cut. A creature only when the art director asks. Each prompt: one person alone, full length, standing in a corner of this same place, a 35mm or 50mm lens, eye level. Real faces with lines and uneven skin, natural hair. Give each two or three traits nobody else has (hair, one garment, build). Name nobody.`,
  },
  {
    key: "details", label: "Props", count: 4,
    hint: "Four objects of this world, each alone in the frame.",
    brief: `Four objects of this world, each alone as the subject: (1) a vehicle, (2) a tool or an everyday instrument, (3) a piece of furniture or an architectural detail, (4) a small personal thing. Each rests on a surface from this frame, in this frame's light. One object per frame, clear silhouette, a medium-close shot.`,
  },
  {
    key: "story", label: "Story", count: 6,
    hint: "A short story from this frame, six shots, ready as a thread.",
    brief: `Invent a short story this frame could be the first or the middle beat of. Give its one-sentence LOGLINE, then six beats as six shots with real shot variety: an establishing wide, a medium shot with action, a close-up, an insert, the turning point, the closing image. The same people in every beat: repeat their wardrobe and hair words verbatim. One place family, one light logic (the hour may move on). Each TITLE is the beat in plain words.`,
  },
  {
    key: "world", label: "World kit", count: 8,
    hint: "Eight frames that turn this picture into a world.",
    brief: `The starter kit that turns this frame into a world: (1) the establishing wide, (2) the wide reverse angle, (3) an interior that belongs here, (4) a street-level or ground-level corner, (5) a lead character full length, (6) a second person, (7) a vehicle, machine or key prop, (8) a close detail insert. One look across all eight.`,
  },
  {
    key: "scene", label: "Cinematic scene", count: 4,
    hint: "Four moments from a real film set in this world.",
    brief: `Four new scenes of this world, each one frame from a real film, as a cinematographer would shoot it. Real-looking people doing ordinary, specific things (waiting, reading a letter, pouring tea, crossing a square). Four different shot sizes across the set: a wide, a full shot, a medium, a close-up. Each prompt names its shot size, lens, camera height and one motivated light with its direction. One subject per frame and empty space around it. Behaviour over emotion.`,
  },
  {
    key: "place", label: "Cinematic location", count: 4,
    hint: "Four other places of this world, each an establishing wide.",
    brief: `Four other places that belong to this frame's world, as a location scout would shoot them for a film: (1) a street or lane, (2) a square, courtyard or bridge, (3) a full interior room, (4) the town seen from a height or its edge. Each is an establishing wide: the place is the grammatical subject, a 24mm or 28mm lens, deep focus, verticals straight, eye level or slightly low. Two or three architectural features, the weather, one light, at most one strange element. People small or absent.`,
  },
  {
    key: "replay", label: "Replay", count: 10, replay: true,
    hint: "Your last prompts, rewritten one by one in this frame's look.",
    brief: `Rewrite each of the PREVIOUS PROMPTS below, one by one and in their order, into this frame's world and look. Keep each one's subject, view, shot size and idea. Replace its style, medium, world and film words with this frame's own (its world words and style words, word for word). One entry per previous prompt; its TITLE names the previous prompt's subject.`,
  },
  {
    key: "location", label: "Location", count: 6, location: true,
    hint: "Six wide views of the place this frame is in.",
    brief: `Six wide views of the place this frame is in, as one location set:
(1) the establishing wide: the whole place from its open end,
(2) the wide reverse: from the far end, looking back the way this camera looks, and say what that reveals,
(3) the wide from a doorway or a corner: from inside an arch, a doorway or a corner, the frame edge dark and close,
(4) the high wide: from an upper window or a roof, looking down across the whole place,
(5) the establishing wide again at blue dusk or at night under wet lamplight: a new LIGHT LINE only, every architecture word identical,
(6) the empty wide with one small figure: the establishing wide with the place empty but for one small distant person in a dark coat.
${LOCATION_LINES}`,
  },
];

export const EXPAND_PRESET_KEYS = EXPAND_PRESETS.map((preset) => preset.key) as [string, ...string[]];
export const expandPreset = (key?: string | null) => EXPAND_PRESETS.find((preset) => preset.key === key) ?? null;

// What the writer knows about Midjourney, whatever the world says. Packed from
// our own runs (midjourney-moodboards web-app notes, the V8.2 prompt skill).
export const EXPAND_BASE_RULES = `You write Midjourney V8.2 prompts for an art director who is exploring a look. You see one of his generated frames, and the prompt that made it when there is one. He liked this frame. Your job is to grow it: new frames that belong to the same world and keep the same look.

How the look is kept:
- Codes and parameters (--sref, --profile, --ar, --stylize …) carry most of a look. They are added to your prompts for you, unchanged, except the version: every job is --v 8.2, never 8.1 or 7. Never write a parameter, a URL or a "--" flag.
- Read the source prompt as three kinds of words:
  WORLD WORDS name the genre, the era and the kind of world ("a dark Gothic old town", "dark art deco city"). Keep them word for word in every prompt, attached to the new subject or place. Never drop one, never swap in a synonym.
  STYLE WORDS name the medium or look (an opening sentence such as "Dark art deco animation frame, a hand-painted background.") and the film, lens and light (closing sentences such as "Shot on 35mm colour negative film."). Copy them word for word into every prompt, in the same places.
  SUBJECT WORDS name what this one frame shows: its subject, its room, its action. They are content. Keep them only where the new frame still shows that thing: a close-up of a pot does not open with "apartment interior", a street outside is not "an interior".
- A look fades when its world and style words rotate. Repeat them; vary only the subject.
- If the source prompt is short and plain, the codes carry the look: keep your prompts short and plain too, in the same voice and about the same length. Do not add style adjectives it did not have.
- If there is no source prompt, open every prompt with one identical sentence that names the medium and rendering you see (film stock or render, paint, line, grain, palette), then the content.
- Reuse the source prompt's own nouns for people, wardrobe, materials and place. A character keeps the exact same describing words in every prompt.

How Midjourney V8.2 reads:
- It reads literally and weights the first words most. The grammatical subject of the first content sentence becomes the centre of the picture: lead with the person for a portrait, with the place for a wide.
- Short direct sentences, one visual unit each: subject and traits, action or pose, what is near, what is behind, light. Keep details of one region together.
- Only what a camera would record. Behaviour over emotion ("she is smiling", not "she is happy"). No backstory, symbolism or mood words.
- One picture, one shot: every word is visible in this frame. A wide says wide and describes the place; a close-up describes the face and what is right behind it.
- Light as a spec: source, direction, hour ("one low warm sun from the left, long hard shadows"), in the same words across a set.
- Say what is there, never what is not ("the street is empty", not "no people"). No commands ("create", "make", "show").
- No filler ("stunning", "masterpiece", "8k", "highly detailed", "cinematic masterpiece").
- Under about 900 characters of prose each. Shorter is usually better.
- Several people: say the headcount, give each one clause anchored to a place in the frame and two or three traits nobody else has.

Traps we have hit:
- Real names pull real things: no real city, landmark, river, artist, photographer, studio, film title, brand or franchise word. Describe forms, materials, era and light instead.
- Every lit sign grows fake letters: signs are unlit emblems with a shape, or out of frame. No lettering unless a title in quotes is the point.
- "Film still" on a very wide frame can add black bars or a caption strip: on wide frames say "photograph" or keep the source's own wording.
- Vague big shapes drift to famous ones ("cathedral towers", "a long black boat under a bridge"): give invented shapes concrete form.

${SHOT_SCALE_RULES}`;

const ANSWER_FORM = (count: number, withLogline: boolean, withPlace = false) => [
  "Answer in exactly this form and nothing else (no markdown, no notes):",
  "SET: two to five plain words naming this set",
  withLogline ? "LOGLINE: the story in one sentence" : "",
  withPlace ? "PLACE LINE: the fixed place sentence\nLIGHT LINE: the fixed light sentence" : "",
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

const BANNED = new Set<string>(MJ_BANNED_PROFILE_CODES);

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
    } else if (flag.name === "profile" || flag.name === "p") {
      // AndromedaCartoon (n9iqix8) is never carried to a new frame.
      for (const value of flag.values) if (!profiles.includes(value) && !BANNED.has(value.toLowerCase())) profiles.push(value);
    } else if (DROP_FLAGS.has(flag.name) || flag.name === "iw") {
      continue;
    } else {
      if ((flag.name === "ar" || flag.name === "aspect") && flag.values[0]) aspect = flag.values[0];
      rest.push([`--${flag.name}`, ...flag.values].join(" "));
    }
  }
  // A grown frame never inherits a retired version: --v 8.1 or 7 on the source becomes --v 8.2.
  return { images, words, srefs, profiles, rest: enforceMjVersion(rest.join(" ")).text, aspect };
}

/** --iw of the source command, when it set one. */
export function imageWeightOf(command: string | undefined) {
  const flag = parseFlags((command ?? "").replace(/^[^-]*(?=--)/, "")).find((entry) => entry.name === "iw");
  return flag?.values[0];
}

/** How the source picture rides on each result (the Grow card's "Use this image as" switch). */
export const EXPAND_ATTACH = ["none", "sref", "image", "edit"] as const;
export type ExpandAttach = (typeof EXPAND_ATTACH)[number];

export type ExpandOptions = {
  /** Keep the source's image prompts at the head of each new command. */
  keepImages?: boolean;
  /** Add this picture as a style reference (--sref <url>), first in the list. */
  srefUrl?: string;
  /** The source picture as: a style reference, an image prompt at the head, or the frame for Midjourney's Edit model. */
  attach?: ExpandAttach;
  /** The picture's public link for `attach`. */
  attachUrl?: string;
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
  /** Frames for Midjourney's Edit model ("--edit <url>", V8.2). */
  edits: string[];
};

/** One result as a full command: [images] words rest --sref … --profile … --edit … */
export function composeExpanded(title: string, words: string, source: SplitCommand, options: ExpandOptions = {}): ExpandMade {
  const url = /^https:\/\/\S+$/.test(options.attachUrl ?? "") ? options.attachUrl! : "";
  const attach = url ? options.attach ?? "none" : "none";
  const images = options.keepImages ? [...source.images] : [];
  if (attach === "image" && !images.includes(url)) images.unshift(url);
  const srefs = [...source.srefs];
  const srefUrl = attach === "sref" ? url : options.srefUrl;
  if (srefUrl && !srefs.some((ref) => ref.url === srefUrl)) srefs.unshift({ url: srefUrl });
  const edits = attach === "edit" ? [url] : [];
  const restParts = [source.rest];
  if (!source.aspect && options.fallbackAspect) restParts.unshift(`--ar ${options.fallbackAspect}`);
  if (images.length && options.iw) restParts.push(`--iw ${options.iw}`);
  const rest = restParts.filter(Boolean).join(" ").trim();
  const profiles = source.profiles.filter((code) => !BANNED.has(code.toLowerCase()));
  const prompt = [
    ...images,
    words,
    rest,
    srefs.length ? `--sref ${srefs.map(refText).join(" ")}` : "",
    profiles.length ? `--profile ${profiles.join(" ")}` : "",
    edits.length ? `--edit ${edits.join(" ")}` : "",
  ].filter(Boolean).join(" ");
  return { title, words, prompt, rest, profiles, srefs, images, edits };
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
  /** The world the brief belongs to: a dear-annete world adds its cinematic addendum. */
  worldKey?: string;
  /** How the picture rides on each result, so the writer knows what it carries. */
  attach?: ExpandAttach;
  /** The art director's last Midjourney prompts, newest first (the "Replay previous prompts" switch, or the Replay move). */
  previous?: string[];
};

const ATTACH_NOTES: Record<ExpandAttach, string> = {
  none: "",
  sref: "THIS FRAME RIDES AS A STYLE REFERENCE (--sref) on every result: it carries colour, light and texture. Your words carry the content.",
  image: "THIS FRAME RIDES AS AN IMAGE PROMPT at the head of every result: it pulls the layout and content toward itself, so make each view clearly different in camera position and subject.",
  edit: "THIS FRAME GOES TO MIDJOURNEY'S EDIT MODEL with every result: the picture is edited toward your words and keeps its look. Write each prompt as the finished new picture, its new camera position or moment stated in the first sentence.",
};

/** Dear Annete worlds (dear-annete, dear-annete-art-deco …) get the cinematic addendum. */
export const isDearAnnete = (worldKey?: string) => /^dear-annete/.test(worldKey ?? "");

/** The art director's previous prompts, cleaned: links out, each capped, at most ten, empties and repeats dropped. */
export function cleanPrevious(previous: string[] | undefined) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of previous ?? []) {
    const text = String(raw ?? "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, EXPAND_LIMITS.previousChars);
    const key = wordsOnly(text).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= EXPAND_LIMITS.previous) break;
  }
  return out;
}

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export function buildExpandMessages({ image, sourceWords, lookNote, preset, idea, count, system, worldBrief, worldKey, attach, previous }: ExpandInput) {
  const dearAnnete = isDearAnnete(worldKey);
  const systemText = [
    EXPAND_BASE_RULES,
    CINEMATIC_RULES_GENERAL,
    dearAnnete ? `${DEAR_ANNETE_CINEMATIC}\n\nThis is a Dear Annete frame: real cinematography comes first. Every prompt reads as a frame from a real film shot in a real old Gothic town.` : "",
    worldBrief?.trim() ?? "",
    system?.trim() ? `Project rules (his own notes for this world):\n${system.trim().slice(0, EXPAND_LIMITS.system)}` : "",
  ].filter(Boolean).join("\n\n");

  const lines: string[] = [];
  lines.push(sourceWords?.trim()
    ? `SOURCE PROMPT (the words that made this frame):\n${sourceWords.trim()}`
    : "There is no source prompt: read the look from the picture.");
  if (lookNote?.trim()) lines.push(`LOOK CARRIED BY CODES (added for you, do not write them): ${lookNote.trim()}`);
  if (preset) lines.push(`THE MOVE: ${preset.label}.\n${preset.brief}`);
  const note = ATTACH_NOTES[attach ?? "none"];
  if (note) lines.push(note);
  const past = cleanPrevious(previous);
  if (past.length) {
    lines.push(`PREVIOUS PROMPTS (the art director's last ${past.length} Midjourney prompts, newest first): ${preset?.replay ? "rewrite each one as the move says" : "reuse their subjects, views and ideas, rewritten in the visual DNA of the source image (its words of style; its codes stay)"}. Their codes and parameters are not yours to write.\n${past.map((text, index) => `${index + 1}. ${text}`).join("\n")}`);
  }
  if (idea?.trim()) lines.push(`${preset ? "ART DIRECTOR'S STEER (it outranks the move's defaults)" : "ART DIRECTOR'S IDEA"}: ${idea.trim()}`);
  if (!preset) {
    lines.push(count === 1
      ? "Write one prompt for that idea, in this frame's world and look."
      : `Write ${count} prompts for that idea, in this frame's world and look. If the idea names one picture, make ${count} distinct takes on it (another framing, another moment); if it names several, one prompt each.`);
  }
  lines.push(ANSWER_FORM(count, preset?.key === "story", Boolean(preset?.location)));

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
