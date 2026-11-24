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
import { CINEMATIC_RULES_GENERAL, DEAR_ANNETE_CINEMATIC, STANDALONE_VIEW_RULE } from "./mj-prompt-knowledge";

export const EXPAND_LIMITS = {
  // A data URL of a 1024 px JPEG is about 300 KB; 3 MB leaves room for PNGs.
  image: 3_000_000,
  command: 8000,
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
    key: "angles", label: "New angles", count: 6,
    hint: "The same moment from six other camera positions.",
    brief: `This subject, this place, this moment and this light, from six other camera positions: (1) the camera turned around: standing where this frame's subject faces, toward where this camera stood, (2) a low angle close to the subject, (3) a high angle looking down on the subject, (4) a side-on profile view, (5) an over-the-shoulder view from behind someone or something in this frame, (6) a far, long-lens view from across the place with the subject small. Write each as its own view: what that camera faces and what stands there (the wall, the far end of the street), never "reverse", "looking back" or "the same". Wardrobe, props and weather keep identical describing words.`,
  },
  {
    key: "close", label: "Close-ups", count: 6,
    hint: "Six close shots cut from this frame.",
    brief: `Six close shots cut from this frame, as an editor would: (1) the face or the main object, (2) the eyes or the face in extreme close-up, (3) hands or a telling detail in use, (4) a second person's or a second object's close-up, (5) a material insert (fabric, metal, glass, a worn surface) under this frame's light, (6) a small object in the scene that tells the story. A long lens, shallow depth of field. The background of each is what sits right behind it in this frame, out of focus.`,
  },
  {
    key: "wide", label: "Wides", count: 6,
    hint: "The place: establishing wide, from the far end, full room or street, high, low, from afar.",
    brief: `Six wide shots of the place this frame belongs to: (1) the establishing wide with the subject small in it, (2) the wide from the far end of the place, facing its open end, described as its own view, (3) the full room or the full street seen straight on, quiet and empty, (4) the high wide from a window, a roof or a hill, (5) the low wide from the ground, the sky or ceiling large, (6) the far wide from outside the place, its edge and its surroundings. The place is the grammatical subject of each. A wide lens, deep focus. Never a tight crop.`,
  },
  {
    key: "cast", label: "Cast", count: 6,
    hint: "Six real-looking people who live in this world.",
    brief: `Six real-looking people of this world who are not in this frame, of different ages, builds and trades, in grounded, believable clothes (a dark wool coat, a plain suit, a simple dress) named by material and cut. A creature only when the art director asks. Each prompt: one person alone, full length, standing in a corner of this same place, a 35mm or 50mm lens, eye level. Real faces with lines and uneven skin, natural hair. Give each two or three traits nobody else has (hair, one garment, build). Name nobody.`,
  },
  {
    key: "details", label: "Props", count: 6,
    hint: "Six objects of this world, each alone in the frame.",
    brief: `Six objects of this world, each alone as the subject: (1) a vehicle, (2) a tool or an everyday instrument, (3) a piece of furniture, (4) an architectural detail (a door, a window, a lamp, a railing), (5) a small personal thing, (6) something to eat, drink or read. Each rests on a surface from this frame, in this frame's light. One object per frame, clear silhouette, a medium-close shot.`,
  },
  {
    key: "story", label: "Story", count: 7,
    hint: "A short story from this frame, seven shots, ready as a thread.",
    brief: `Invent a short story this frame could be the first or the middle beat of. Give its one-sentence LOGLINE, then seven beats as seven shots with real shot variety: an establishing wide, a medium shot with action, a close-up, an insert, a reaction, the turning point, the closing image. The same people in every beat: repeat their wardrobe and hair words verbatim. One place family, one light logic (the hour may move on). Each TITLE is the beat in plain words.`,
  },
  {
    key: "world", label: "World kit", count: 8,
    hint: "Eight frames that turn this picture into a world.",
    brief: `The starter kit that turns this frame into a world: (1) the establishing wide, (2) the wide from the far end of the place, described as its own view, (3) an interior that belongs here, (4) a street-level or ground-level corner, (5) a lead character full length, (6) a second person, (7) a vehicle, machine or key prop, (8) a close detail insert. One look across all eight.`,
  },
  {
    key: "scene", label: "Cinematic scene", count: 7,
    hint: "Seven moments from a real film set in this world.",
    brief: `Seven new scenes of this world, each one frame from a real film, as a cinematographer would shoot it. Real-looking people doing ordinary, specific things (waiting, reading a letter, pouring tea, crossing a square). Every shot size across the set: an extreme wide, a wide, a full shot, a medium, a medium close-up, a close-up and an over-the-shoulder or two-shot. Each prompt names its shot size, lens, camera height and one motivated light with its direction. One subject per frame and empty space around it. Behaviour over emotion.`,
  },
  {
    key: "place", label: "Cinematic location", count: 7,
    hint: "Seven other places of this world, each an establishing wide.",
    brief: `Seven other places that belong to this frame's world, as a location scout would shoot them for a film: (1) a street or lane, (2) a square, courtyard or bridge, (3) a full interior room, (4) a second interior of another kind (a workshop, a hall, a shop, a kitchen), (5) a place of passage (a station, a stair, a gate, a quay), (6) the land around the town (fields, a shore, a forest edge, a road), (7) the town seen from a height or its edge. Each is an establishing wide: the place is the grammatical subject, a 24mm or 28mm lens, deep focus, verticals straight, eye level or slightly low. Two or three architectural features, the weather, one light, at most one strange element. People small or absent.`,
  },
  {
    key: "replay", label: "Replay", count: 10, replay: true,
    hint: "Your last prompts, rewritten one by one in this frame's look.",
    brief: `Rewrite each of the PREVIOUS PROMPTS below, one by one and in their order, into this frame's world and look. Keep each one's subject, view, shot size and idea. Replace its style, medium, world and film words with this frame's own (its world words and style words, word for word). One entry per previous prompt; its TITLE names the previous prompt's subject.`,
  },
  {
    key: "location", label: "Location", count: 7, location: true,
    hint: "Seven wide views of the place this frame is in.",
    brief: `Seven wide views of the place this frame is in, as one location set:
(1) the establishing wide: the whole place from its open end,
(2) the far-end wide: the camera at the far end of the place, facing its open end; describe what stands there as its own view,
(3) the wide from a doorway or a corner: from inside an arch, a doorway or a corner, the frame edge dark and close,
(4) the high wide: from an upper window or a roof, looking down across the whole place,
(5) the establishing wide again at blue dusk or at night under wet lamplight: a new LIGHT LINE only, every architecture word identical,
(6) the empty wide with one small figure: the establishing wide with the place empty but for one small distant person in a dark coat,
(7) the long-lens wide from far off: an 85mm from outside the place, its layers stacked and compressed, the same LIGHT LINE.
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
  STYLE WORDS name the medium or look (an opening sentence such as "Dark art deco animation frame, a hand-painted background.") and the film, lens and light (closing sentences such as "Shot on 35mm colour negative film."). Any artist, book, film or studio the source names as its look is part of its style words ("Painted concept art for Jack Vance's The Dying Earth, in the manner of Moebius and Philippe Druillet"). Copy the style words exactly, names included, unless the art director asks for another style.
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
- Real names pull real things: never add a real city, landmark, river, artist, photographer, studio, film title, brand or franchise word of your own. Describe forms, materials, era and light instead. This covers only words you add: names in the source's own style words stay, exactly.
- Every lit sign grows fake letters: signs are unlit emblems with a shape, or out of frame. No lettering unless a title in quotes is the point.
- "Film still" on a very wide frame can add black bars or a caption strip: on wide frames say "photograph" or keep the source's own wording.
- Vague big shapes drift to famous ones ("cathedral towers", "a long black boat under a bridge"): give invented shapes concrete form.

${SHOT_SCALE_RULES}`;

/**
 * What always rides after the system prompt, the art director's own copy
 * included (Michael, 22 Nov 2026: "its important to keep the style same always
 * when we grow ... or only if user ask"; the shot name first, every other
 * prompt in inverse order, and every prompt thought from its camera). The
 * style itself is put back by the gallery (withStyle), so the writer cannot
 * trim it.
 */
export const GROW_LOCK = `GROW RULES THAT ALWAYS HOLD (they outrank anything above):
- The style is locked. The source prompt's style words (the medium, the look, the palette, and any artist, book, film or studio it names as its look) are copied exactly, names included, unless the art director asks for another style. The rule against real names covers only words you add, never the source's own style words.
- Write the style once, on the STYLE line. Each PROMPT is the content only, without the style words: the gallery puts the style back on every prompt, at the start of some and at the end of others.
- Each PROMPT opens with the shot: its size and angle in plain words ("Close-up of …", "Extreme close-up of …", "Medium shot of …", "Full shot of …", "Wide shot of …", "Low-angle wide of …"), then what that camera sees.
- Think from the camera. Describe only what is visible from that position and distance:
  Close-up and extreme close-up: the character or object fills the frame. Describe its surface in detail: skin and its lines, hair, the weave and folds of the fabric, embroidery and stitching, metal wear, ornament, how the light falls across it. Behind it, only soft shapes.
  Medium and full shots: the figure from the waist or the knees, or head to toe; the pose, the hands, what is within reach, the near background.
  Wide and establishing shots: the place leads. Describe the background, the architecture, the land and sky, the objects around, where the figures stand and how small they are. No fine texture on anything small in the frame.
${STANDALONE_VIEW_RULE}`;

/** Grow's own system prompt, before the world's files and notes: what the extension shows and may replace. */
export const EXPAND_SYSTEM_DEFAULT = `${EXPAND_BASE_RULES}\n\n${CINEMATIC_RULES_GENERAL}`;

const ANSWER_FORM = (count: number, withLogline: boolean, withPlace = false) => [
  "Answer in exactly this form and nothing else (no markdown, no notes):",
  "SET: two to five plain words naming this set",
  "STYLE: the source prompt's style words, copied exactly, names included (no source prompt: the one style sentence you use for this set; a source with no style words: none)",
  "STYLE CHANGED: no (yes only when the art director asked for another style)",
  withLogline ? "LOGLINE: the story in one sentence" : "",
  withPlace ? "PLACE LINE: the fixed place sentence\nLIGHT LINE: the fixed light sentence" : "",
  `Then ${count} ${count === 1 ? "entry" : "entries"}, each as:`,
  "TITLE: three to six plain words naming the frame",
  "PROMPT: the content only, opening with the shot, without the style words",
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
  /** The art director's own version of EXPAND_SYSTEM_DEFAULT (extension: MJ settings → Writer). */
  rules?: string;
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

export function buildExpandMessages({ image, sourceWords, lookNote, preset, idea, count, system, rules, worldBrief, worldKey, attach, previous }: ExpandInput) {
  const dearAnnete = isDearAnnete(worldKey);
  const systemText = [
    rules?.trim() || EXPAND_SYSTEM_DEFAULT,
    GROW_LOCK,
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

export type ParsedExpand = { set?: string; logline?: string; style?: string; styleChanged?: boolean; items: Array<{ title: string; words: string }> };

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
  // The style keeps its own quotes and full stop: it goes back on every prompt as written.
  const style = /(?:^|\n)\s*[#*\s]*STYLE\**\s*:\s*\**\s*([^\n]+)/i.exec(text)?.[1]?.replace(/\*\*/g, "").trim();
  const changed = line("STYLE CHANGED");
  return {
    set: line("SET")?.slice(0, 60), logline: line("LOGLINE")?.slice(0, 300),
    style: style && !/^none\.?$/i.test(style) ? wordsOnly(style.replace(/https?:\/\/\S+/g, "")).slice(0, 1500) : undefined,
    styleChanged: changed ? /^yes\b/i.test(changed) : undefined,
    items,
  };
}

// ── The style, kept word for word (Michael, 22 Nov 2026) ──

const normal = (text: string) => text.toLowerCase().replace(/[“”"]/g, "").replace(/\s+/g, " ").replace(/[\s.,;:!]+$/g, "").trim();
const contentWords = (text: string) => new Set(normal(text).split(/[^\p{L}\p{N}']+/u).filter((word) => word.length > 2));
const sentencesOf = (text: string) => text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=\S)/).map((part) => part.trim()).filter(Boolean);
/** Share of `sentence`'s words that also appear in `words`. */
const overlap = (sentence: string, words: Set<string>) => {
  const own = contentWords(sentence);
  if (own.size < 3) return 0;
  let shared = 0;
  for (const word of own) if (words.has(word)) shared += 1;
  return shared / own.size;
};
const withStop = (text: string) => (/[.!?]["”']?$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

/**
 * The style that goes on every prompt. The writer's STYLE line when it is the
 * source's own words (or the art director asked for another style, or there is
 * no source); when the writer trimmed it ("Painted concept art: …" for
 * "Painted concept art for Jack Vance's The Dying Earth, in the manner of
 * Moebius and Philippe Druillet: …"), the source sentences it came from.
 */
export function styleOf(style: string | undefined, sourceWords: string | undefined, changed?: boolean): { style: string; restored: boolean } {
  const said = style?.trim() ?? "";
  const source = sourceWords?.trim() ?? "";
  if (!said || changed || !source) return { style: said, restored: false };
  if (normal(source).includes(normal(said))) return { style: said, restored: false };
  const words = contentWords(said);
  const picked = sentencesOf(source).filter((sentence) => overlap(sentence, words) >= 0.5);
  if (!picked.length) return { style: said, restored: false };
  return { style: picked.join(" "), restored: true };
}

/** The content without the style the writer repeated anyway (whole, or as an opening or closing sentence). */
export function stripStyle(content: string, style: string) {
  let text = content.trim();
  if (!style.trim()) return text;
  const bare = style.trim().replace(/[.\s]+$/, "");
  const at = text.toLowerCase().indexOf(bare.toLowerCase());
  if (at >= 0) text = `${text.slice(0, at)} ${text.slice(at + bare.length).replace(/^[.\s]+/, "")}`.replace(/\s+/g, " ").trim();
  const words = contentWords(style);
  const parts = sentencesOf(text);
  while (parts.length > 1 && overlap(parts[0]!, words) >= 0.6) parts.shift();
  while (parts.length > 1 && overlap(parts[parts.length - 1]!, words) >= 0.6) parts.pop();
  return parts.join(" ").replace(/^[\s.,;:]+/, "").trim();
}

/**
 * Every prompt with the style put back word for word: the first, third, fifth
 * … with the style first and the shot after it; the others the inverse, what
 * we see first and the style at the end, for variety.
 */
export function withStyle<T extends { words: string }>(items: T[], style: string): T[] {
  if (!style.trim()) return items;
  return items.map((item, index) => {
    const content = stripStyle(item.words, style) || item.words;
    const words = index % 2 === 0 ? `${withStop(style)} ${content}` : `${withStop(content)} ${withStop(style)}`;
    return { ...item, words };
  });
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
