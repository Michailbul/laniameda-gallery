// In-place edits: which model runs where, what a take costs and what each
// endpoint is sent. Ported from the reviewer kit (reviewer-kit/server.py,
// MODELS / estimate / build_input), prices checked on fal and Pika 1 Nov 2026.
// Pure: the Convex runner, the detail panel and the agent route share it.

export type EditProvider = "fal" | "pika";
export type EditRoute = { provider: EditProvider; endpoint: string };
export type EditModel = {
  id: string;
  name: string;
  hint: string;
  maxRefs: number;
  default?: boolean;
  /** The routing table's order (~/.claude/CLAUDE.md): the first route that accepts the job wins. */
  routes: readonly EditRoute[];
};

export const EDIT_MODELS: readonly EditModel[] = [
  {
    id: "krea-3", name: "Krea 3", maxRefs: 7, default: true,
    hint: "The edit model. Keeps the frame, changes what you name.",
    routes: [{ provider: "fal", endpoint: "krea/v3/edit" }],
  },
  {
    id: "seedream-5", name: "Seedream 5 Pro", maxRefs: 6,
    hint: "Edit and style transfer. Strong on texture and light.",
    routes: [
      { provider: "pika", endpoint: "bytedance/seedream-5.0-pro/image-to-image" },
      { provider: "fal", endpoint: "bytedance/seedream/v5/pro/edit" },
    ],
  },
  {
    id: "gpt-flare", name: "GPT Image 2.5 Flare", maxRefs: 7,
    hint: "Targeted edit of one thing. Never for composing scenes.",
    routes: [
      { provider: "fal", endpoint: "openai/gpt-image-2.5/flare/edit" },
      { provider: "pika", endpoint: "openai/gpt-image-2.5-flare/image-to-image" },
    ],
  },
  {
    id: "gpt-sunburst", name: "GPT Image 2.5 Sunburst", maxRefs: 7,
    hint: "Targeted edit, tighter control.",
    routes: [
      { provider: "fal", endpoint: "openai/gpt-image-2.5/sunburst/edit" },
      { provider: "pika", endpoint: "openai/gpt-image-2.5-sunburst/image-to-image" },
    ],
  },
  {
    id: "nano-21", name: "Nano Banana 2.1", maxRefs: 6,
    hint: "Runs on Pika. Never on the Gemini key.",
    routes: [{ provider: "pika", endpoint: "google/gemini-nano-banana-2.1/image-to-image" }],
  },
  {
    id: "kontext-max", name: "Flux Kontext Max", maxRefs: 0,
    hint: "Context edit. Flat price. Takes no references.",
    routes: [{ provider: "fal", endpoint: "fal-ai/flux-pro/kontext/max" }],
  },
];

export const editModelById = (id: string) => EDIT_MODELS.find((model) => model.id === id);

/** Michael's rule: ask before anything at $30 or more. A send at or over it is refused. */
export const MAX_SEND_USD = 30;
export const MAX_TAKES = 8;
export const MAX_MODELS_PER_SEND = 6;
export const MAX_JOBS_PER_SEND = 24;
export const MAX_EDIT_REFS = 10;
export const MAX_EDIT_PROMPT = 5000;
export const TAKE_CHOICES = [1, 2, 3, 4, 6, 8] as const;

const DEFAULT_W = 1456;
const DEFAULT_H = 816;

const megapixels = (w?: number, h?: number) => ((w || DEFAULT_W) * (h || DEFAULT_H)) / 1e6;
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Source size scaled down to `capMp` megapixels, multiples of 16, never below 256. */
export function editSize(w?: number, h?: number, capMp = 2) {
  const width = w || DEFAULT_W;
  const height = h || DEFAULT_H;
  const scale = Math.min(1, Math.sqrt((capMp * 1e6) / (width * height)));
  return {
    width: Math.max(256, Math.floor((width * scale) / 16) * 16),
    height: Math.max(256, Math.floor((height * scale) / 16) * 16),
  };
}

const FLAT_USD: Record<string, number> = {
  "openai/gpt-image-2.5/flare/edit": 0.055,
  "openai/gpt-image-2.5/sunburst/edit": 0.055,
  "openai/gpt-image-2.5-flare/image-to-image": 0.049,
  "openai/gpt-image-2.5-sunburst/image-to-image": 0.049,
  "google/gemini-nano-banana-2.1/image-to-image": 0.045,
  "fal-ai/flux-pro/kontext/max": 0.08,
};

/** USD estimate for one take on one endpoint. */
export function estimateEditUsd(endpoint: string, w?: number, h?: number, refs = 0) {
  if (endpoint === "krea/v3/edit") {
    // $0.025 per MP of output plus each input image, inputs capped at the output size.
    const out = editSize(w, h);
    const outMp = megapixels(out.width, out.height);
    return round4(0.025 * (outMp + (1 + refs) * Math.min(megapixels(w, h), outMp)));
  }
  // Pika 1.5K: the first image is free, $0.00255 per extra.
  if (endpoint === "bytedance/seedream-5.0-pro/image-to-image") return round4(0.0383 + 0.00255 * refs);
  // fal up to 1536×1536 output, $0.0045 per extra input.
  if (endpoint === "bytedance/seedream/v5/pro/edit") return round4(0.0675 + 0.0045 * refs);
  return FLAT_USD[endpoint] ?? 0.1;
}

const ASPECTS: Record<string, number> = {
  "21:9": 21 / 9, "16:9": 16 / 9, "3:2": 1.5, "4:3": 4 / 3, "1:1": 1, "3:4": 0.75, "2:3": 2 / 3, "9:16": 9 / 16,
};

export function aspectOf(w?: number, h?: number) {
  const ratio = (w || 16) / (h || 9);
  let best = "16:9";
  for (const [name, value] of Object.entries(ASPECTS)) {
    if (Math.abs(value - ratio) < Math.abs(ASPECTS[best]! - ratio)) best = name;
  }
  return best;
}

/** The request body for one endpoint. `urls[0]` is the frame (<image-1>), the rest are references. */
export function buildEditInput(endpoint: string, prompt: string, urls: string[], w?: number, h?: number): Record<string, unknown> {
  if (endpoint === "krea/v3/edit") {
    const size = editSize(w, h);
    return { prompt, image_urls: urls, image_size: size, reasoning_level: "medium", output_format: "png" };
  }
  if (endpoint === "bytedance/seedream/v5/pro/edit") {
    return { prompt, image_urls: urls, image_size: editSize(w, h, (1536 * 1536) / 1e6) };
  }
  if (endpoint === "bytedance/seedream-5.0-pro/image-to-image") {
    return { prompt, image_urls: urls, size: "1.5K", aspect_ratio: aspectOf(w, h) };
  }
  if (endpoint.startsWith("openai/gpt-image-2.5/")) return { prompt, image_urls: urls, quality: "high" };
  if (endpoint.startsWith("openai/gpt-image-2.5-")) {
    return { prompt, image_urls: urls, aspect_ratio: aspectOf(w, h), resolution: "1K" };
  }
  if (endpoint === "google/gemini-nano-banana-2.1/image-to-image") {
    return { prompt, image_urls: urls, aspect_ratio: aspectOf(w, h) };
  }
  if (endpoint === "fal-ai/flux-pro/kontext/max") return { prompt, image_url: urls[0], aspect_ratio: aspectOf(w, h) };
  return { prompt, image_urls: urls };
}

/**
 * Pika keys a request by its Idempotency-Key: the same key with a new body is
 * a 409. A retry is a new request, so the key carries the retry count; a route
 * fall-through is a new request too.
 */
export const editIdempotencyKey = (jobId: string, retries: number, routeIndex: number) =>
  `edit-${jobId}-r${retries}-${routeIndex}`;

const OUT_OF_CREDIT = /balance|locked|credit|insufficient/i;

/**
 * Whether a provider refusal is a billing or auth block (try the next route)
 * and whether it means out of credit. Mirrors the kit's `blocked()` and the
 * fal/Pika submit checks.
 */
export function classifyProviderRefusal(provider: EditProvider, status: number, body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
  const authOrBilling = status === 401 || status === 402 || status === 403;
  const mentionsCredit = OUT_OF_CREDIT.test(text);
  const blocked = authOrBilling || (status >= 400 && mentionsCredit);
  const outOfCredit = blocked && mentionsCredit;
  const message = outOfCredit
    ? `${provider}: out of credits (${status})`
    : `${provider} ${status}: ${text.slice(0, 160)}`;
  return { blocked, outOfCredit, message };
}

export type EditPollResult =
  | { state: "running" }
  | { state: "error"; error: string }
  | { state: "done"; url: string; usd?: number; pendingBill?: boolean };

/** fal queue status → our state. `result` is the response body once COMPLETED. */
export function readFalStatus(status: number, body: unknown): "running" | "completed" | { error: string } {
  const value = (body && typeof body === "object" ? (body as { status?: string }).status : undefined) ?? "";
  if (value === "IN_QUEUE" || value === "IN_PROGRESS") return "running";
  if (value === "COMPLETED") return "completed";
  if (status >= 500) return "running";
  return { error: `fal status ${status}: ${JSON.stringify(body ?? "").slice(0, 300)}` };
}

export function readFalResult(status: number, body: unknown): EditPollResult {
  if (status >= 300) return { state: "error", error: `fal result ${status}: ${JSON.stringify(body ?? "").slice(0, 300)}` };
  const images = (body as { images?: { url?: string }[] } | null)?.images ?? [];
  const url = images[0]?.url;
  if (!url) return { state: "error", error: "fal returned no image (safety filter?)" };
  return { state: "done", url };
}

type PikaJob = {
  status?: string;
  error?: { message?: string } | string | null;
  output?: { images?: { url?: string }[] } | null;
  billing?: { state?: string; charge_micro_usd?: number } | null;
};

/** Pika job → our state; a settled bill is the exact charge. */
export function readPikaJob(status: number, body: unknown): EditPollResult {
  if (status >= 300 || !body || typeof body !== "object") {
    return status >= 500 ? { state: "running" } : { state: "error", error: `pika ${status}: ${JSON.stringify(body ?? "").slice(0, 300)}` };
  }
  const job = body as PikaJob;
  if (job.status === "queued" || job.status === "running") return { state: "running" };
  if (job.status === "failed") {
    const reason = typeof job.error === "string" ? job.error : job.error?.message ?? JSON.stringify(job.error ?? "");
    return { state: "error", error: `pika: ${String(reason).slice(0, 300)}` };
  }
  const url = job.output?.images?.[0]?.url;
  if (!url) return { state: "error", error: "pika returned no image" };
  return { state: "done", url, usd: pikaCharge(job), pendingBill: job.billing?.state === "pending" };
}

export const pikaCharge = (job: PikaJob) =>
  job.billing?.state === "settled" && typeof job.billing.charge_micro_usd === "number"
    ? job.billing.charge_micro_usd / 1e6
    : undefined;

export type PlannedTake = {
  model: EditModel;
  take: number;
  of: number;
  refs: number;
  refsDropped: number;
  estimateUsd: number;
};

/**
 * One job per model per take, priced on each model's first route. Refuses a
 * send the gallery must not run: no prompt or model, too many takes, a total
 * at or over $30.
 */
export function planEditSend(input: {
  prompt: string; modelIds: string[]; takes: number; refs: number; width?: number; height?: number;
  /** The ask-first line; MAX_SEND_USD unless a test moves it. */
  limitUsd?: number;
}): { ok: true; takes: PlannedTake[]; totalUsd: number } | { ok: false; error: string } {
  const prompt = input.prompt.trim();
  if (!prompt) return { ok: false, error: "Write what to change." };
  if (prompt.length > MAX_EDIT_PROMPT) return { ok: false, error: `A prompt is limited to ${MAX_EDIT_PROMPT} characters.` };
  const ids = [...new Set(input.modelIds)];
  const unknown = ids.filter((id) => !editModelById(id));
  if (unknown.length) return { ok: false, error: `Unknown model: ${unknown.join(", ")}.` };
  if (!ids.length) return { ok: false, error: "Pick a model." };
  if (ids.length > MAX_MODELS_PER_SEND) return { ok: false, error: `Up to ${MAX_MODELS_PER_SEND} models per send.` };
  const takes = Math.floor(input.takes || 1);
  if (takes < 1 || takes > MAX_TAKES) return { ok: false, error: `Takes run from 1 to ${MAX_TAKES}.` };
  if (ids.length * takes > MAX_JOBS_PER_SEND) return { ok: false, error: `Up to ${MAX_JOBS_PER_SEND} takes per send.` };
  if (input.refs > MAX_EDIT_REFS) return { ok: false, error: `Up to ${MAX_EDIT_REFS} references.` };
  const planned: PlannedTake[] = [];
  for (const id of ids) {
    const model = editModelById(id)!;
    const refs = Math.min(input.refs, model.maxRefs);
    const estimateUsd = estimateEditUsd(model.routes[0]!.endpoint, input.width, input.height, refs);
    for (let take = 1; take <= takes; take += 1) {
      planned.push({ model, take, of: takes, refs, refsDropped: input.refs - refs, estimateUsd });
    }
  }
  const totalUsd = round4(planned.reduce((sum, take) => sum + take.estimateUsd, 0));
  const limit = input.limitUsd ?? MAX_SEND_USD;
  if (totalUsd >= limit) {
    return { ok: false, error: `≈$${totalUsd.toFixed(2)} is over the $${limit} ask-first line.` };
  }
  return { ok: true, takes: planned, totalUsd };
}

export type ProviderState = Record<EditProvider, { key: boolean; blocked?: string }>;

/** The route a model would take now: the first whose provider has a key and is not blocked. */
export function liveRoute(model: EditModel, providers?: Partial<ProviderState>) {
  const usable = (route: EditRoute) => {
    const state = providers?.[route.provider];
    return !state || (state.key && !state.blocked);
  };
  const route = model.routes.find(usable);
  return { route: route ?? model.routes[0]!, blocked: !route };
}

export const formatUsd = (n: number | undefined) =>
  `$${(n ?? 0).toFixed(n !== undefined && n > 0 && n < 0.1 ? 3 : 2)}`;
