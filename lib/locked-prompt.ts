// Locked location prompts: one style-neutral prompt per place (the "what"),
// redone in any world style with one click. Pure and client-safe: Convex, the
// agent route, the gallery UI and the tests compose the same queue item.
//
// A restyle is the locked words + the style's recipe (lib/mj-recipe: sref,
// profiles, moodboards, parameters, template) + the locked aspect and seed.
// Two modes:
//   "seed"  same prompt and seed: a new generation with a similar composition.
//           A different sref or profile still moves the picture.
//   "frame" the locked frame attached with --edit (Midjourney V8.2's Edit
//           model, which replaced Retexture): keeps that frame's layout and
//           changes the look. Image prompts are left out; the frame holds the
//           architecture.

import { composeRecipe, parseFlags, templateWords } from "./mj-recipe";

export type RestyleMode = "seed" | "frame";

export const LOCKED_PROMPT_LIMITS = {
  title: 120,
  place: 80,
  text: 4000,
  note: 1000,
  imagePrompts: 5,
  scenes: 60,
  revisions: 200,
  promptsPerRestyle: 60,
  stylesPerRestyle: 6,
} as const;

export const SEED_MAX = 4294967295;

/** A stable seed from a key (FNV-1a, 32 bit), in Midjourney's 0–4294967295 range. */
export function seedFor(key: string) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(key)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

const phrasesOf = (text: string) => text.split(",").map((part) => part.trim()).filter(Boolean);
const norm = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

// A template's place words ("in Mexico City") belong to the template's first
// subject, not to the style: the locked prompt says where.
const isPlacePhrase = (phrase: string) => /^in\s+[A-Z]/.test(phrase.trim());

/**
 * The locked words inside a style's template. "[subject] in Mexico City,
 * feature animation film, wide shot, hand-drawn 2.5D…" around "A school patio,
 * wide shot, …" gives "A school patio, wide shot, …, feature animation film,
 * hand-drawn 2.5D…": the template's words that the prompt already says, and its
 * place words, are left out. A template without [subject] adds nothing.
 */
export function applyStyleTemplate(text: string, template: string | undefined) {
  const words = templateWords(template);
  const body = text.trim().replace(/[\s,.]+$/, "");
  if (!words || !/\[subject\]/i.test(words)) return body;
  const [before = "", after = ""] = words.split(/\[subject\]/i);
  const have = norm(body);
  const keep = (phrase: string) => !isPlacePhrase(phrase) && !have.includes(norm(phrase));
  const lead = before.trim();
  const tail = phrasesOf(after).filter(keep);
  const head = lead && !have.startsWith(norm(lead)) ? `${lead} ` : "";
  return `${head}${body}${tail.length ? `, ${tail.join(", ")}` : ""}`;
}

export type LockedForCompose = {
  text: string;
  aspect?: string;
  seed: number;
  imagePrompts: Array<{ url?: string; assetId?: string; weight?: number; label?: string; thumbUrl?: string }>;
  extraParams?: string;
};

export type StyleForCompose = {
  name: string;
  parameters?: string;
  template?: string;
  moodboardCodes: Array<string | undefined>;
  profileCodes: string[];
  unknownCodes: string[];
};

export type RestyledItem = {
  prompt: string;
  imagePrompts: LockedForCompose["imagePrompts"];
  styleRefs: Array<{ code: string; label?: string }>;
  profileCodes: string[];
  params: string;
  editRefs: Array<{ url: string; assetId?: string; label?: string }>;
  warnings: string[];
};

const DROP_FROM_PARAMS = new Set(["sref", "profile", "seed", "ar", "aspect", "edit", "iw"]);

/** One queue item: the locked prompt in one style, by one mode. */
export function restyle(locked: LockedForCompose, style: StyleForCompose, mode: RestyleMode,
  frame?: { url: string; assetId?: string; label?: string }): RestyledItem {
  const warnings: string[] = [];
  const recipe = composeRecipe({
    parameters: style.parameters, template: style.template,
    moodboardCodes: style.moodboardCodes, profileCodes: style.profileCodes, unknownCodes: style.unknownCodes,
  });
  const flags = parseFlags(recipe.params).filter((flag) => !DROP_FROM_PARAMS.has(flag.name));
  const extra = parseFlags(locked.extraParams).filter((flag) => !DROP_FROM_PARAMS.has(flag.name));
  const merged = [...flags.filter((flag) => !extra.some((own) => own.name === flag.name)), ...extra];
  const aspect = locked.aspect?.trim() || "16:9";
  const params = [...merged.map((flag) => [`--${flag.name}`, ...flag.values].join(" ")), `--ar ${aspect}`, `--seed ${locked.seed}`].join(" ");
  const editRefs: RestyledItem["editRefs"] = [];
  let imagePrompts = locked.imagePrompts;
  if (mode === "frame") {
    if (frame?.url) {
      editRefs.push({ url: frame.url, assetId: frame.assetId, label: frame.label ?? "Locked frame" });
      imagePrompts = [];
    } else {
      warnings.push("No locked frame yet: made as a same-prompt-and-seed take instead.");
    }
  }
  if (mode === "seed") warnings.push(`Same words and seed in ${style.name}: the composition stays close, but a new sref or profile still moves the picture.`);
  return {
    prompt: applyStyleTemplate(locked.text, style.template),
    imagePrompts,
    styleRefs: recipe.srefs.map((code) => ({ code, label: `${style.name} sref` })),
    profileCodes: recipe.profiles,
    params,
    editRefs,
    warnings,
  };
}

/** The Midjourney job id in a frame's source link or file name, with the grid index. */
export function midjourneyJobOf(sourceUrl?: string, fileName?: string) {
  const job = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  const fromUrl = sourceUrl ? job.exec(sourceUrl) : null;
  const fromName = !fromUrl && fileName ? job.exec(fileName) : null;
  const id = (fromUrl ?? fromName)?.[1]?.toLowerCase();
  if (!id) return null;
  const index = sourceUrl ? /[?&]index=(\d+)/.exec(sourceUrl)?.[1] ?? /\/0_(\d+)\./.exec(sourceUrl)?.[1] : undefined;
  const fromFile = fileName ? new RegExp(`${id}[-_](\\d+)`, "i").exec(fileName)?.[1] : undefined;
  const at = index ?? fromFile;
  return { jobId: id, index: at === undefined ? undefined : Number(at) };
}

/** The Midjourney CDN address of a grid image: what --edit reads best. */
export const midjourneyCdnUrl = (jobId: string, index = 0) => `https://cdn.midjourney.com/${jobId}/0_${index}.png`;
