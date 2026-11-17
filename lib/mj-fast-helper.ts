// The Midjourney fast helper (extension/mj-fast-helper.js): one frame on
// midjourney.com, one line of instruction, a fal model, 1–4 takes. Every take
// is one fal queue request on the owner's fal key (convex/mjQuickRunner.ts).
// Pure: the Convex runner, the extension route and the tests share it.

import { z } from "zod";
import { buildEditInput, estimateEditUsd, readFalStatus } from "./edit-models";

export type FastModel = {
  id: string;
  name: string;
  /** Short chip label. */
  chip: string;
  endpoint: string;
  /** Extra reference images it takes besides the frame. */
  maxRefs: number;
  hint: string;
  default?: boolean;
  /** A tool, not an edit: it takes no instruction (the upscaler). */
  tool?: boolean;
};

/** fal only. Keys 1–4 in the card pick the first four. */
export const FAST_MODELS: readonly FastModel[] = [
  {
    id: "seedream-5.5", name: "Seedream 5.5", chip: "Seedream 5.5", endpoint: "bytedance/seedream/v5.5/edit", maxRefs: 9, default: true,
    hint: "Edit and restyle. Keeps the look of the frame.",
  },
  {
    id: "krea-3", name: "Krea 3", chip: "Krea 3", endpoint: "krea/v3/edit", maxRefs: 7,
    hint: "The edit model. Keeps the frame, changes what you name.",
  },
  {
    id: "gpt-flare", name: "GPT Image 2.5 Flare", chip: "GPT Flare", endpoint: "openai/gpt-image-2.5/flare/edit", maxRefs: 7,
    hint: "Change one thing. Never for composing scenes.",
  },
  {
    id: "nano-21", name: "Nano Banana 2.1", chip: "Nano 2.1", endpoint: "google/nano-banana-2.1/edit", maxRefs: 6,
    hint: "Good at keeping a face from a reference.",
  },
  {
    id: "upscale-2k", name: "SeedVR2 upscale", chip: "Upscale 2K", endpoint: "fal-ai/seedvr/upscale/image", maxRefs: 0, tool: true,
    hint: "Twice the size, same picture.",
  },
];

export const fastModelById = (id: string) => FAST_MODELS.find((model) => model.id === id);
export const DEFAULT_FAST_MODEL = FAST_MODELS.find((model) => model.default)!;

export type FastTemplate = { key: string; label: string; instruction: string; model?: string };

/** One-click chips in the card. Plain instructions; the upscaler is a model of its own. */
export const FAST_TEMPLATES: readonly FastTemplate[] = [
  { key: "night", label: "Night", instruction: "Make it night: the same place and moment after dark, lit by its own lamps, windows and moonlight. Keep the composition, the camera and every person as they are." },
  { key: "wider", label: "Wider shot", instruction: "Pull the camera back to a wide shot of the same place: show more of the surroundings around the same subject, same light and same style." },
  { key: "face", label: "Close-up of the face", instruction: "A close-up of the main person's face from this frame: the same person, the same light and the same style, framed from the shoulders up." },
  { key: "clean", label: "Remove text and logos", instruction: "Remove every piece of text, lettering, watermark, signature and logo. Change nothing else." },
  { key: "angle", label: "Same place, other angle", instruction: "The same place and the same moment seen from another camera angle: a different camera position looking across the scene, same light and same style." },
  { key: "upscale", label: "Upscale 2K", instruction: "Upscale", model: "upscale-2k" },
];

export const FAST_LIMITS = { instruction: 2000, count: 4, refs: 6, url: 2000, prompt: 6000, motion: 1500, recent: 20 } as const;
/** A run at or over this is refused: the helper is for quick takes. */
export const FAST_MAX_RUN_USD = 5;
/** A take not back after this long is given up (its request id is kept). */
export const FAST_TIMEOUT_MS = 10 * 60 * 1000;
export const FAST_SESSION_LABEL = "mj-fast-helper";

const DEFAULT_W = 1456;
const DEFAULT_H = 816;
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** fal SeedVR2: $0.001 per output megapixel, 2× each side. */
const seedvrUsd = (w?: number, h?: number) => round4(Math.max(0.001, (((w || DEFAULT_W) * 2) * ((h || DEFAULT_H) * 2)) / 1e6 * 0.001));

/** USD for one take of a model on a frame of w×h with `refs` extra images. */
export function fastTakeUsd(model: FastModel, w?: number, h?: number, refs = 0) {
  if (model.endpoint === "fal-ai/seedvr/upscale/image") return seedvrUsd(w, h);
  return estimateEditUsd(model.endpoint, w, h, Math.min(refs, model.maxRefs));
}

/** "≈ $0.030" for one take, "≈ $0.06 · 2 × $0.030" for several. */
export function priceLabel(perTake: number, count: number) {
  const one = `$${perTake.toFixed(perTake < 0.1 ? 3 : 2)}`;
  if (count <= 1) return `≈ ${one}`;
  const total = perTake * count;
  return `≈ $${total.toFixed(total < 0.1 ? 3 : 2)} · ${count} × ${one}`;
}

/** The request body for one take. `urls[0]` is the frame, the rest are references. */
export function fastInput(model: FastModel, instruction: string, urls: string[], w?: number, h?: number): Record<string, unknown> {
  if (model.endpoint === "fal-ai/seedvr/upscale/image") {
    return { image_url: urls[0], upscale_mode: "factor", upscale_factor: 2, output_format: "png" };
  }
  return buildEditInput(model.endpoint, instruction, urls.slice(0, 1 + model.maxRefs), w, h);
}

export type FastPlan =
  | { ok: true; model: FastModel; count: number; refs: number; refsDropped: number; perTakeUsd: number; totalUsd: number; instruction: string }
  | { ok: false; error: string };

/** Checks a run before anything is stored or sent. */
export function planFastRun(input: { modelId: string; instruction: string; count: number; refs: number; width?: number; height?: number }): FastPlan {
  const model = fastModelById(input.modelId);
  if (!model) return { ok: false, error: `Unknown model ${input.modelId}.` };
  const instruction = (input.instruction || "").replace(/\s+/g, " ").trim() || (model.tool ? model.name : "");
  if (!instruction) return { ok: false, error: "Say what to change." };
  if (instruction.length > FAST_LIMITS.instruction) return { ok: false, error: `Keep it under ${FAST_LIMITS.instruction} characters.` };
  const count = Math.floor(input.count || 1);
  if (count < 1 || count > FAST_LIMITS.count) return { ok: false, error: `1 to ${FAST_LIMITS.count} takes.` };
  if (input.refs > FAST_LIMITS.refs) return { ok: false, error: `Up to ${FAST_LIMITS.refs} extra pictures.` };
  const refs = Math.min(input.refs, model.maxRefs);
  const perTakeUsd = fastTakeUsd(model, input.width, input.height, refs);
  const totalUsd = round4(perTakeUsd * count);
  if (totalUsd >= FAST_MAX_RUN_USD) return { ok: false, error: `≈$${totalUsd.toFixed(2)} is too much for a quick take.` };
  return { ok: true, model, count, refs, refsDropped: input.refs - refs, perTakeUsd, totalUsd, instruction };
}

/** The models with their price for one take on a frame, for the card. */
export function fastCatalog(w?: number, h?: number, refs = 0) {
  return {
    models: FAST_MODELS.map((model) => ({
      id: model.id, name: model.name, chip: model.chip, hint: model.hint, maxRefs: model.maxRefs,
      default: Boolean(model.default), tool: Boolean(model.tool), perTakeUsd: fastTakeUsd(model, w, h, refs),
    })),
    templates: FAST_TEMPLATES,
    limits: FAST_LIMITS,
  };
}

export type TakeStatus = "queued" | "submitting" | "running" | "done" | "error";
export type RunStatus = "queued" | "running" | "done" | "error";

/** A run is running while any take is; done when one landed; error when none did. */
export function runStatusOf(takes: ReadonlyArray<{ status: TakeStatus }>): RunStatus {
  if (!takes.length) return "error";
  if (takes.every((take) => take.status === "queued")) return "queued";
  if (takes.some((take) => take.status === "queued" || take.status === "submitting" || take.status === "running")) return "running";
  return takes.some((take) => take.status === "done") ? "done" : "error";
}

/** The picture in a fal result: edit models answer `images`, the upscaler `image`. */
export function readFastImage(status: number, body: unknown): { url: string; width?: number; height?: number } | { error: string } {
  if (status >= 300) return { error: `fal result ${status}: ${JSON.stringify(body ?? "").slice(0, 300)}` };
  const row = (body ?? {}) as { images?: Array<{ url?: string; width?: number; height?: number }>; image?: { url?: string; width?: number; height?: number } };
  const image = row.images?.[0] ?? row.image;
  if (!image?.url) return { error: "fal returned no image (safety filter?)" };
  return { url: image.url, ...(image.width ? { width: image.width } : {}), ...(image.height ? { height: image.height } : {}) };
}

export { readFalStatus };

/** The plain line saved on the asset: what made it, from what. */
export function fastLineage(input: {
  modelName: string; endpoint: string; instruction: string; requestId?: string;
  mjJobId?: string; mjIndex?: number; pageUrl?: string; mjPrompt?: string; parentRunId?: string;
}) {
  const from = input.mjJobId
    ? `Midjourney job ${input.mjJobId}${typeof input.mjIndex === "number" ? ` image ${input.mjIndex + 1}` : ""}`
    : input.parentRunId ? `an earlier fast-helper take (run ${input.parentRunId})` : input.pageUrl ? input.pageUrl : "a frame";
  return [
    `Fast helper edit of ${from}.`,
    `${input.modelName} on fal (${input.endpoint})${input.requestId ? `, request ${input.requestId}` : ""}.`,
    `Instruction: ${input.instruction}`,
    input.mjPrompt ? `Midjourney prompt: ${input.mjPrompt}` : "",
    `Session ${FAST_SESSION_LABEL}.`,
  ].filter(Boolean).join("\n").slice(0, 3900);
}

// ── The extension route's payloads ──

const imageRef = z.object({
  r2Key: z.string().trim().min(1).max(500).optional(),
  url: z.string().trim().url().max(FAST_LIMITS.url).optional(),
  mjJobId: z.string().trim().regex(/^[0-9a-f-]{20,}$/i).optional(),
  mjIndex: z.number().int().min(0).max(15).optional(),
}).refine((value) => Boolean(value.r2Key || value.url), { message: "A picture needs r2Key or url." });

export const fastStartSchema = z.object({
  action: z.literal("start"),
  model: z.string().trim().min(1).max(40),
  instruction: z.string().max(FAST_LIMITS.instruction).default(""),
  count: z.number().int().min(1).max(FAST_LIMITS.count).default(1),
  source: imageRef.and(z.object({
    pageUrl: z.string().trim().max(FAST_LIMITS.url).optional(),
    prompt: z.string().max(FAST_LIMITS.prompt).optional(),
    parentRunId: z.string().trim().max(64).optional(),
    parentIndex: z.number().int().min(0).max(FAST_LIMITS.count).optional(),
    width: z.number().int().positive().max(20000).optional(),
    height: z.number().int().positive().max(20000).optional(),
  })),
  refs: z.array(imageRef).max(FAST_LIMITS.refs).default([]),
  world: z.object({
    key: z.string().trim().max(120).optional(),
    name: z.string().trim().max(200).optional(),
    folderId: z.string().trim().max(64).optional(),
  }).optional(),
});

export const FAST_SECTIONS = ["scene", "location", "character", "inspiration"] as const;

export const fastSaveSchema = z.object({
  action: z.literal("save"),
  runId: z.string().trim().min(1).max(64),
  index: z.number().int().min(0).max(FAST_LIMITS.count),
  folderId: z.string().trim().max(64).optional(),
  section: z.enum(FAST_SECTIONS).default("scene"),
});

export const fastReviewSchema = z.object({
  action: z.literal("review"),
  runId: z.string().trim().min(1).max(64),
  index: z.number().int().min(0).max(FAST_LIMITS.count),
  review: z.enum(["pending", "dropped"]),
});

export const fastFantasySchema = z.object({
  action: z.literal("fantasy"),
  runId: z.string().trim().min(1).max(64),
  index: z.number().int().min(0).max(FAST_LIMITS.count),
  draftId: z.string().trim().min(1).max(80),
  project: z.string().trim().min(1).max(200),
});

export const fastPostSchema = z.discriminatedUnion("action", [fastStartSchema, fastSaveSchema, fastReviewSchema, fastFantasySchema]);
export type FastStart = z.infer<typeof fastStartSchema>;
