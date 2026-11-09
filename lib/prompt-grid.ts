// Prompt sets × style presets × seeds: the comparison grid Michael runs in
// Midjourney (9 Nov 2026). Pure and client-safe: Convex, the agent route, the
// gallery UI and the tests compose the same queue items.
//
// - A prompt has 2–3 variants (short, prose, style-neutral); each variant
//   keeps its own seeds, reused unchanged across every preset.
// - A style preset is one exact recipe written as frozen codes: moodboard
//   codes, profile codes, srefs with their --sv version, parameters and an
//   optional opening sentence. A perturbation (board alone, stylize 750 …) is
//   its own preset, so every frame maps to exactly one recipe.
// - A run is prompts × variants × seeds × presets as one MJ Queue thread,
//   screening cells first. Michael sends every job himself.
//
// Research folded in (CASSANDRA/bible/mj-style-consistency-research-2026-11.md):
// codes not IDs; sref keeps its --sv; screen in Draft (one submit = 24 images,
// one job against the caps), lock at full quality; two fixed seeds per shot;
// never permutations or --repeat for grids; --weird is dropped on board jobs.

import { parseFlags } from "./mj-recipe";

export type VariantKind = "short" | "prose" | "neutral";
export type Variant = { key: string; label: string; kind: VariantKind; text: string; seeds: number[] };

export type PresetCode = { code: string; name?: string };
export type PresetSref = { code: string; sv?: string; weight?: number };
export type PresetForCompose = {
  name: string;
  moodboards: PresetCode[];
  profiles: PresetCode[];
  srefs: PresetSref[];
  parameters?: string;
  sentence?: string;
};

export type PromptForCompose = {
  text: string;
  aspect?: string;
  seed: number;
  variants?: Variant[];
  imagePrompts: Array<{ url?: string; assetId?: string; weight?: number; label?: string; thumbUrl?: string }>;
  attach?: Array<{ url?: string; assetId?: string; label?: string; thumbUrl?: string }>;
  extraParams?: string;
};

export const PACING = { perHour: 30, perDay: 150, breakEvery: 20, breakMinutes: 12.5, gapSeconds: 40 } as const;
export const GRID_LIMITS = { prompts: 40, presets: 16, seedsPerVariant: 4, variants: 3, jobsPerRun: 200 } as const;

/** A prompt's variants: its own, or the locked text as the one neutral variant on its locked seed. */
export function variantsOf(prompt: Pick<PromptForCompose, "text" | "seed" | "variants">): Variant[] {
  if (prompt.variants?.length) return prompt.variants;
  return [{ key: "neutral", label: "Style-neutral", kind: "neutral", text: prompt.text, seeds: [prompt.seed] }];
}

/** The short variant made from a prose prompt: its first phrases, up to about 22 words. */
export function shortVersion(text: string, words = 22) {
  const phrases = text.split(",").map((part) => part.trim()).filter(Boolean);
  const out: string[] = [];
  let count = 0;
  for (const phrase of phrases) {
    const n = phrase.split(/\s+/).length;
    if (out.length && count + n > words) break;
    out.push(phrase);
    count += n;
  }
  return out.join(", ");
}

const DROP = new Set(["sref", "profile", "p", "seed", "ar", "aspect", "edit", "iw", "sv", "draft", "repeat", "r", "permutations"]);

/** A preset as queue fields: style references, profile codes (boards first) and the rest of its parameters. */
export function presetFields(preset: PresetForCompose) {
  const own = parseFlags(preset.parameters).filter((flag) => !DROP.has(flag.name));
  const sv = preset.srefs.map((sref) => sref.sv).find(Boolean);
  const hasBoard = preset.moodboards.length > 0;
  // --weird is stripped from moodboard jobs anyway; leaving it in reads as if it counted.
  const kept = own.filter((flag) => !(hasBoard && flag.name === "weird"));
  const params = [
    ...kept.map((flag) => [`--${flag.name}`, ...flag.values].join(" ")),
    ...(sv && preset.srefs.length ? [`--sv ${sv}`] : []),
  ].join(" ");
  return {
    styleRefs: preset.srefs.map((sref) => ({ code: sref.code, weight: sref.weight, label: `${preset.name} sref` })),
    profileCodes: [...new Set([...preset.moodboards, ...preset.profiles].map((row) => row.code.trim()).filter(Boolean))],
    params,
  };
}

export type GridCell = { variant: Variant; seed: number };

/** One queue item: one variant of one prompt, on one seed, in one preset. */
export function composeCell(prompt: PromptForCompose, cell: GridCell, preset: PresetForCompose, options: { draft?: boolean } = {}) {
  const fields = presetFields(preset);
  const extra = parseFlags(prompt.extraParams).filter((flag) => !DROP.has(flag.name));
  const words = cell.variant.text.trim().replace(/[\s,]+$/, "");
  const sentence = preset.sentence?.trim();
  const text = sentence && !words.toLowerCase().startsWith(sentence.toLowerCase()) ? `${sentence} ${words}` : words;
  const params = [
    fields.params,
    ...extra.map((flag) => [`--${flag.name}`, ...flag.values].join(" ")),
    `--ar ${prompt.aspect?.trim() || "16:9"}`,
    `--seed ${cell.seed}`,
    ...(options.draft ? ["--draft"] : []),
  ].filter(Boolean).join(" ");
  return {
    prompt: text,
    imagePrompts: prompt.imagePrompts,
    styleRefs: fields.styleRefs,
    profileCodes: fields.profileCodes,
    params,
    editRefs: prompt.attach ?? [],
  };
}

export type GridPlanInput<P, S> = {
  prompts: Array<{ id: P; variants: Variant[] }>;
  presets: S[];
  variantKeys?: string[];
  allSeeds?: boolean;
  stage: "screen" | "refine";
};

/**
 * Every cell of a run, screening first. Screen = each prompt's first chosen
 * variant on its first seed, across every preset (prompt by prompt, so one
 * prompt's presets arrive together in the feed). Refine adds the other
 * variants and seeds after the screening cells.
 */
export function planGrid<P, S>(input: GridPlanInput<P, S>) {
  const cells: Array<{ promptId: P; preset: S; cell: GridCell; screen: boolean }> = [];
  const chosen = (variants: Variant[]) => {
    const wanted = input.variantKeys?.length ? variants.filter((variant) => input.variantKeys!.includes(variant.key)) : variants;
    return wanted.length ? wanted : variants.slice(0, 1);
  };
  for (const prompt of input.prompts) {
    const first = chosen(prompt.variants)[0]!;
    for (const preset of input.presets) cells.push({ promptId: prompt.id, preset, cell: { variant: first, seed: first.seeds[0]! }, screen: true });
  }
  if (input.stage === "refine") {
    for (const prompt of input.prompts) {
      const variants = chosen(prompt.variants);
      for (const variant of variants) {
        const seeds = input.allSeeds ? variant.seeds : variant.seeds.slice(0, 1);
        for (const seed of seeds) {
          if (variant === variants[0] && seed === variant.seeds[0]) continue;
          for (const preset of input.presets) cells.push({ promptId: prompt.id, preset, cell: { variant, seed }, screen: false });
        }
      }
    }
  }
  return cells;
}

/** How long a run takes at the account's caps (30 jobs an hour, 150 a day, breaks every 20). */
export function pacingEstimate(jobs: number) {
  const byCap = jobs / PACING.perHour;
  const byGaps = (jobs * PACING.gapSeconds + Math.floor(jobs / PACING.breakEvery) * PACING.breakMinutes * 60) / 3600;
  const hours = Math.max(byCap, byGaps);
  const days = Math.max(1, Math.ceil(jobs / PACING.perDay));
  const label = jobs === 0 ? "nothing to send"
    : hours < 1 ? `about ${Math.max(5, Math.round(hours * 60 / 5) * 5)} minutes`
      : days > 1 ? `${days} days (150 a day), about ${Math.ceil(hours)} hours of sending`
        : `about ${Math.round(hours * 2) / 2} hours`;
  return { jobs, hours: Math.round(hours * 100) / 100, days, label };
}
