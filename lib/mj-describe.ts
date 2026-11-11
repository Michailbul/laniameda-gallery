// Describe an image into one of our Midjourney prompts (extension: "Make it
// ours" after Midjourney's Describe, and the side panel's own describer).
// Client-safe helpers shared by the Convex runner (convex/promptEditRunner.ts
// describe) and the extension route. The same quick-edit agent does the work:
// same providers, same world system prompt, plus the picture.
//
// Style lock (Michael, 9 Nov 2026): the style words of a prompt matter, so the
// person decides where they come from.
//   keep  the image's own look, described too: the prompt recreates it.
//   ours  the image's style words are dropped; a world style from the gallery
//         (its lock, line, template and recipe codes) is applied instead.
//   both  the two, side by side.

import { composeRecipe, parseFlags } from "./mj-recipe";
import { SHOT_SCALE_RULES } from "./writer-scale";

export const DESCRIBE_MODES = ["keep", "ours", "both"] as const;
export type DescribeMode = (typeof DESCRIBE_MODES)[number];

export const DESCRIBE_LIMITS = {
  // A data URL of a 1024 px JPEG is about 300 KB; 3 MB leaves room for PNGs.
  image: 3_000_000,
  descriptions: 4,
  description: 1500,
  note: 600,
  system: 8000,
  lock: 6000,
} as const;

/** What the runner knows about the chosen world style (from the gallery). */
export type DescribeStyle = {
  name: string;
  line?: string;
  lock?: string;
  template?: string;
  params?: string;
  raises?: string[];
  lowers?: string[];
};

export const DESCRIBE_BASE_RULES = `You write Midjourney V8 prompts for an art director. You get one picture, sometimes Midjourney's own Describe output for it (how Midjourney reads the image), and the project's rules. You write prompts that make that picture again in our house format.

House format:
- The first sentence names the look: medium, rendering and era of the image (keep) or the locked style (ours). One sentence, concrete, no artist names.
- Then the subject as the grammatical subject of the next sentence: who or what, doing what, where.
- Then concrete forms, materials, colour and light: name the light source and its direction, the time of day, the surfaces.
- Then the shot: framing (wide, medium, close-up), camera height, lens in mm, depth of field.
- Plain visual prose in full sentences, about 60 to 140 words. One picture only: describe this frame, not a world.
- Never a real place, landmark, city, artist, photographer, studio, film title or brand. Describe forms, materials, era and light instead, and change a recognisable shape so it is not the real one.
- Never a negative ("no people", "without text"): say what is there ("the street is empty").
- No lettering unless the picture's point is a title in quotes.
- No filler ("stunning", "masterpiece", "8k", "highly detailed", "trending"), no instructions to the model.
- Write no parameters (--ar, --v, --sref, --profile …): they are added for you.

Midjourney's Describe lines, when given, are vocabulary: use the words that match what you see, correct what they get wrong, and drop their artist and place names.

${SHOT_SCALE_RULES}`;

const KEEP_RULES = `KEEP: recreate the image's own look. The first sentence describes the image's medium and style in concrete words (film stock or render, paint, grain, palette, lens character), so the prompt rebuilds the reference.`;

const OURS_RULES = `OURS: the same subject, framing, camera distance and light, in our locked style. Leave out every style word of the image itself (its medium, rendering, film stock, palette words, artist-like terms). Open with the style's opening sentence from the STYLE LOCK below, word for word when it gives one; otherwise write one from the style's line. If a STYLE TEMPLATE has [subject], write the subject where [subject] is and keep the template's style words. Follow the style's raises and lowers. World details you bring in are sized to the picture's own distances (the scale rule above): a far city behind a person gets skyline-size markers only.`;

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

const DROP_FROM_STYLE = new Set(["ar", "aspect", "seed", "iw", "edit"]);

/**
 * The parameter line of a result: the picture's aspect and, for "ours", the
 * style's codes and settings. `rest` is the line without --sref and --profile,
 * which the queue keeps in their own fields.
 */
export function describeParams(mode: "keep" | "ours", aspect: string | undefined, style?: DescribeStyle) {
  const rest: string[] = aspect ? [`--ar ${aspect}`] : [];
  let profiles: string[] = [];
  let srefs: string[] = [];
  if (mode === "ours" && style) {
    const recipe = composeRecipe({ parameters: style.params, template: style.template });
    profiles = recipe.profiles;
    srefs = recipe.srefs;
    for (const flag of parseFlags(recipe.params)) {
      if (DROP_FROM_STYLE.has(flag.name) || flag.name === "sref" || flag.name === "profile") continue;
      rest.push([`--${flag.name}`, ...flag.values].join(" "));
    }
  }
  const params = [
    ...rest,
    srefs.length ? `--sref ${srefs.join(" ")}` : "",
    profiles.length ? `--profile ${profiles.join(" ")}` : "",
  ].filter(Boolean).join(" ");
  return { params, rest: rest.join(" "), profiles, srefs };
}

export type DescribeInput = {
  image: string;
  descriptions?: string[];
  system?: string;
  style?: DescribeStyle;
  mode: DescribeMode;
  note?: string;
  /** The files of the style's world, already laid out (lib/writer-brief.ts composeBrief). */
  worldBrief?: string;
};

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export function buildDescribeMessages({ image, descriptions, system, style, mode, note, worldBrief }: DescribeInput) {
  const wantKeep = mode === "keep" || mode === "both";
  const wantOurs = (mode === "ours" || mode === "both") && Boolean(style);
  const systemText = [
    DESCRIBE_BASE_RULES,
    wantKeep ? KEEP_RULES : "",
    wantOurs ? OURS_RULES : "",
    wantOurs && worldBrief?.trim() ? `${worldBrief.trim()}\n\nThe world's files shape the OURS prompt only${wantKeep ? "; KEEP stays a plain recreation of the image" : ""}. The subject, framing and light still come from the picture.` : "",
    system?.trim() ? `Project rules (the world this is for):\n${system.trim()}` : "",
  ].filter(Boolean).join("\n\n");

  const lines: string[] = [];
  const mj = (descriptions ?? []).map((line) => line.trim()).filter(Boolean).slice(0, DESCRIBE_LIMITS.descriptions);
  if (mj.length) lines.push(`HOW MIDJOURNEY READS THIS IMAGE (its Describe):\n${mj.map((line, index) => `${index + 1}. ${line}`).join("\n")}`);
  if (wantOurs && style) {
    lines.push([
      `STYLE: ${style.name}${style.line ? ` — ${style.line}` : ""}`,
      style.lock?.trim() ? `STYLE LOCK:\n${style.lock.trim().slice(0, DESCRIBE_LIMITS.lock)}` : "",
      style.template?.trim() ? `STYLE TEMPLATE: ${wordsOnly(style.template)}` : "",
      style.raises?.length ? `Raises: ${style.raises.join("; ")}` : "",
      style.lowers?.length ? `Lowers: ${style.lowers.join("; ")}` : "",
    ].filter(Boolean).join("\n"));
  }
  if (note?.trim()) lines.push(`ART DIRECTOR'S NOTE: ${note.trim()}`);
  const answer = [
    "Answer in exactly this form, nothing else:",
    "TITLE: three to six plain words naming the picture",
    wantKeep ? "KEEP: the prompt that recreates the image's own look" : "",
    wantOurs ? "OURS: the prompt in our locked style" : "",
  ].filter(Boolean).join("\n");
  lines.push(answer);

  const content: Part[] = [{ type: "image_url", image_url: { url: image } }, { type: "text", text: lines.join("\n\n") }];
  return [{ role: "system" as const, content: systemText }, { role: "user" as const, content }];
}

/** TITLE / KEEP / OURS lines from the model's answer. */
export function parseDescribeAnswer(raw: string) {
  const text = raw.replace(/```[a-z]*\n?|```/gi, "").trim();
  const grab = (label: string) => {
    const match = new RegExp(`(?:^|\\n)\\s*\\**${label}\\**\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*\\**(?:TITLE|KEEP|OURS)\\**\\s*:|$)`, "i").exec(text);
    return match?.[1]?.trim() || undefined;
  };
  const title = grab("TITLE")?.split("\n")[0]?.replace(/[."]+$/g, "").trim();
  const keep = grab("KEEP");
  const ours = grab("OURS");
  return {
    title: title?.slice(0, 80),
    keep: keep ? wordsOnly(keep) : undefined,
    ours: ours ? wordsOnly(ours) : undefined,
  };
}
