// Describe a picture (extension: the side panel's Describe tab, a right-click
// "Describe to a prompt", and Midjourney's own Describe answers it caught).
// The writer looks at the picture like a cinematographer and answers in
// labelled lines: subject and action, shot size and angle, lens and depth of
// field, composition, light, palette, materials, setting, mood. Then one ready
// Midjourney V8.2 prompt built from those lines. Client-safe helpers shared by
// the Convex runner (convex/promptEditRunner.ts describe) and the route.
//
// Michael, 17 Nov 2026: "The describer feature should describe the image:
// cinematography, lighting etc." The old "Make it ours" (a world style laid
// over the picture) is gone: "remove that feature, not needed."

import { SHOT_SCALE_RULES } from "./writer-scale";
import { CINEMATIC_RULES_GENERAL } from "./mj-prompt-knowledge";

export const DESCRIBE_LIMITS = {
  // A data URL of a 1024 px JPEG is about 300 KB; 3 MB leaves room for PNGs.
  image: 3_000_000,
  descriptions: 4,
  description: 1500,
  note: 600,
  system: 8000,
} as const;

/** The labelled lines of a description, in the order the card shows them. */
export const DESCRIBE_FIELDS = [
  { key: "subject", label: "Subject", ask: "who or what is in the frame and what they are doing" },
  { key: "shot", label: "Shot", ask: "shot size (extreme wide, wide, full, medium, medium close-up, close-up, insert) and camera angle and height" },
  { key: "lens", label: "Lens", ask: "lens feel in mm and the depth of field (what is sharp, what is soft)" },
  { key: "composition", label: "Composition", ask: "where the subject sits, lines, symmetry, foreground and background, empty space" },
  { key: "light", label: "Light", ask: "the light source, its direction, hard or soft, colour, and the time of day" },
  { key: "palette", label: "Palette", ask: "the main colours in plain words, and the contrast" },
  { key: "materials", label: "Materials", ask: "the surfaces and textures that matter (stone, wool, wet cobbles, rust)" },
  { key: "setting", label: "Setting", ask: "the place and its architecture style in style words (late Gothic, Brick Gothic, Art Deco …), era, weather" },
  { key: "mood", label: "Mood", ask: "the feeling in a few plain words, as a viewer would say it" },
  { key: "medium", label: "Medium", ask: "film stock, photograph, render or paint; grain and finish" },
] as const;
export type DescribeFieldKey = (typeof DESCRIBE_FIELDS)[number]["key"];
export type DescribeField = { key: DescribeFieldKey; label: string; text: string };

export const DESCRIBE_BASE_RULES = `You are a cinematographer and a Midjourney V8.2 prompt writer working for an art director. You get one picture, sometimes Midjourney's own Describe output for it, and you take the picture apart the way a director of photography would on a set: what the camera sees, how it is framed, how it is lit. Then you write one Midjourney V8.2 prompt that makes this picture again.

The description:
- Each line is short, concrete and visual: what a camera records. Name things a crew could set up (a 35mm lens, one window on the left, a low sun behind the subject, haze).
- Say what is there, never what is not. No guesses about story or backstory.
- Never a real place, landmark, city, artist, photographer, studio, film title or brand: describe forms, materials, era and light instead.

The prompt:
- The grammatical subject of the first sentence is what the picture centres on: the person for a portrait, the place for a wide.
- Shape: shot and subject first, then its details, then what is around and behind it, then light, then the medium and film or render words.
- Name the shot size, the lens, the camera height and the one light with its direction, in plain film words.
- Plain visual prose in full sentences, under about 900 characters of prose. One picture only: this frame, not a world.
- Never a negative ("no people", "without text"): say what is there ("the street is empty"). No lettering unless the picture's point is a title in quotes.
- No filler ("stunning", "masterpiece", "8k", "highly detailed", "intricate", "ornate", "trending"), no instructions to the model.
- Write no parameters (--ar, --v, --sref, --profile …): they are added for you.

Midjourney's Describe lines, when given, are vocabulary: use the words that match what you see, correct what they get wrong, and drop their artist and place names.

${CINEMATIC_RULES_GENERAL}

${SHOT_SCALE_RULES}`;

/** "16:9" from Midjourney's [w, h], a "w:h" string, or pixel sizes; reduced. */
export function aspectOf(input?: string | number[] | null, width?: number, height?: number) {
  let w = 0;
  let h = 0;
  if (Array.isArray(input) && input.length >= 2) [w, h] = [Number(input[0]), Number(input[1])];
  else if (typeof input === "string" && /^\s*\d+\s*:\s*\d+\s*$/.test(input)) [w, h] = input.split(":").map((part) => Number(part.trim())) as [number, number];
  else if (width && height) [w, h] = [width, height];
  if (!(w > 0 && h > 0)) return undefined;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w > 64 || h > 64) {
    // Pixel sizes: snap to the nearest of the usual Midjourney ratios.
    const ratio = w / h;
    const usual = ["1:1", "5:4", "4:3", "3:2", "16:9", "2:1", "21:9", "3:1", "4:5", "3:4", "2:3", "9:16", "1:2"];
    let best = usual[0]!;
    let gap = Infinity;
    for (const entry of usual) {
      const [a, b] = entry.split(":").map(Number) as [number, number];
      const next = Math.abs(Math.log(ratio / (a / b)));
      if (next < gap) { gap = next; best = entry; }
    }
    return best;
  }
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

/** Words only: any flags the model wrote anyway are cut, whitespace tidied. */
export function wordsOnly(text: string) {
  const at = text.search(/(^|\s)--[a-z]/i);
  return (at < 0 ? text : text.slice(0, at)).replace(/\s+/g, " ").trim().replace(/^["“]|["”]$/g, "").trim();
}

/** The parameter line of a result: the picture's aspect, nothing else. */
export function describeParams(aspect: string | undefined) {
  return aspect ? `--ar ${aspect}` : "";
}

export type DescribeInput = {
  image: string;
  descriptions?: string[];
  /** The world's own notes (the quick edit's world prompt): vocabulary only. */
  system?: string;
  note?: string;
};

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export function buildDescribeMessages({ image, descriptions, system, note }: DescribeInput) {
  const systemText = [
    DESCRIBE_BASE_RULES,
    system?.trim() ? `Project notes (vocabulary for the setting and the light; the picture decides what is in it):\n${system.trim().slice(0, DESCRIBE_LIMITS.system)}` : "",
  ].filter(Boolean).join("\n\n");

  const lines: string[] = [];
  const mj = (descriptions ?? []).map((line) => line.trim()).filter(Boolean).slice(0, DESCRIBE_LIMITS.descriptions);
  if (mj.length) lines.push(`HOW MIDJOURNEY READS THIS IMAGE (its Describe):\n${mj.map((line, index) => `${index + 1}. ${line}`).join("\n")}`);
  if (note?.trim()) lines.push(`ART DIRECTOR'S NOTE (apply it to the PROMPT): ${note.trim()}`);
  lines.push([
    "Answer in exactly this form, one line each, nothing else (no markdown):",
    "TITLE: three to six plain words naming the picture",
    ...DESCRIBE_FIELDS.map((field) => `${field.label.toUpperCase()}: ${field.ask}`),
    "PROMPT: the Midjourney V8.2 prompt built from the lines above, words only",
  ].join("\n"));

  const content: Part[] = [{ type: "image_url", image_url: { url: image } }, { type: "text", text: lines.join("\n\n") }];
  return [{ role: "system" as const, content: systemText }, { role: "user" as const, content }];
}

const LABELS = ["TITLE", ...DESCRIBE_FIELDS.map((field) => field.label.toUpperCase()), "PROMPT"];

/** TITLE, the labelled lines and PROMPT from the model's answer. */
export function parseDescribeAnswer(raw: string): { title?: string; fields: DescribeField[]; prompt?: string } {
  const text = raw.replace(/```[a-z]*\n?|```/gi, "").replace(/\r/g, "").trim();
  const any = LABELS.join("|");
  const grab = (label: string) => {
    const match = new RegExp(`(?:^|\\n)[\\s#*-]*\\**${label}\\**\\s*:\\s*\\**\\s*([\\s\\S]*?)(?=\\n[\\s#*-]*\\**(?:${any})\\**\\s*:|$)`, "i").exec(text);
    return match?.[1]?.replace(/\*\*/g, "").replace(/\s+/g, " ").trim() || undefined;
  };
  const title = grab("TITLE")?.replace(/[."]+$/g, "").trim();
  const fields: DescribeField[] = [];
  for (const field of DESCRIBE_FIELDS) {
    const value = grab(field.label.toUpperCase());
    if (value) fields.push({ key: field.key, label: field.label, text: value.slice(0, 400) });
  }
  const prompt = grab("PROMPT");
  return { title: title?.slice(0, 80), fields, prompt: prompt ? wordsOnly(prompt) : undefined };
}
