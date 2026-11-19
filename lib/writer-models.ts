// The models the Midjourney writer can run on (Grow, Describe, quick edit).
// One list for every writer tool: the extension's side panel picks the default
// and every call carries it. Cloud routes are tried in order: fal first (its
// OpenRouter route), Pika when fal is blocked. `local` is the model id the
// writer bridge on the Mac runs (`claude -p --model …`); DeepSeek has none.
// Checked on fal and Pika on 19 Nov 2026.

export type WriterRoute = { provider: "fal" | "pika"; model: string; label: string };
export type WriterModelInfo = {
  label: string;
  short: string;
  /** Reads pictures. Grow and Describe send one, so a text-only model hands them to Haiku. */
  vision: boolean;
  local?: string;
  hint: string;
  routes: WriterRoute[];
};

export const WRITER_MODEL_KEYS = ["haiku", "sonnet", "opus", "fable", "deepseek"] as const;
export type WriterModel = (typeof WRITER_MODEL_KEYS)[number];

export const WRITER_MODELS: Record<WriterModel, WriterModelInfo> = {
  haiku: {
    label: "Haiku 5.5", short: "H", vision: true, local: "claude-haiku-5-5",
    hint: "Fast and cheap. The default.",
    routes: [
      { provider: "fal", model: "anthropic/claude-haiku-5.5", label: "Haiku 5.5" },
      // Pika has no Haiku 5.5 yet: its newest Haiku stands in.
      { provider: "pika", model: "anthropic/claude-haiku-4.5", label: "Haiku 4.5 (Pika)" },
    ],
  },
  sonnet: {
    label: "Sonnet 5.5", short: "S", vision: true, local: "claude-sonnet-5-5",
    hint: "Better taste, a few seconds slower.",
    routes: [
      { provider: "fal", model: "anthropic/claude-sonnet-5.5", label: "Sonnet 5.5" },
      { provider: "pika", model: "anthropic/claude-sonnet-5.5", label: "Sonnet 5.5 (Pika)" },
    ],
  },
  opus: {
    label: "Opus 5.5", short: "O", vision: true, local: "claude-opus-5-5",
    hint: "The strongest writer. Slowest and dearest.",
    routes: [
      { provider: "fal", model: "anthropic/claude-opus-5.5", label: "Opus 5.5" },
      { provider: "pika", model: "anthropic/claude-opus-5.5", label: "Opus 5.5 (Pika)" },
    ],
  },
  fable: {
    label: "Fable 5.2", short: "F", vision: true, local: "claude-fable-5-2",
    hint: "Claude's most capable model.",
    routes: [
      { provider: "fal", model: "anthropic/claude-fable-5.2", label: "Fable 5.2" },
      { provider: "pika", model: "anthropic/claude-fable-5.1", label: "Fable 5.1 (Pika)" },
    ],
  },
  deepseek: {
    label: "DeepSeek V4.1", short: "DS", vision: false,
    hint: "Text only: quick edits. Grow and Describe use Haiku with it.",
    routes: [
      { provider: "fal", model: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1" },
      { provider: "fal", model: "deepseek/deepseek-v4.1", label: "DeepSeek V4.1" },
      { provider: "pika", model: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 (Pika)" },
    ],
  },
};

export const isWriterModel = (value: unknown): value is WriterModel =>
  typeof value === "string" && (WRITER_MODEL_KEYS as readonly string[]).includes(value);

/**
 * The model a call runs on: the one asked for, Haiku when none is given, and
 * Haiku with a note when the call sends a picture to a text-only model.
 */
export function pickWriterModel(asked: unknown, needsVision: boolean): { model: WriterModel; note?: string } {
  const model: WriterModel = isWriterModel(asked) ? asked : "haiku";
  if (needsVision && !WRITER_MODELS[model].vision) {
    return { model: "haiku", note: `${WRITER_MODELS[model].label} cannot see pictures: Haiku 5.5 wrote this` };
  }
  return { model };
}

/** What the extension lists in its model picker. */
export const writerModelList = () => WRITER_MODEL_KEYS.map((key) => {
  const { label, short, vision, local, hint } = WRITER_MODELS[key];
  return { key, label, short, vision, local: Boolean(local), hint };
});

/** Longest custom system prompt the extension may send for one tool. */
export const WRITER_RULES_LIMIT = 60_000;
