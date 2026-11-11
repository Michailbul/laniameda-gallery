// The local writer: the extension can run the writer's one chat call on the
// user's own Mac (a small bridge on 127.0.0.1 that runs `claude -p`) instead of
// a paid provider. The gallery still builds the messages and reads the answer,
// so the rules live in one place: the extension asks for the messages
// (stage "messages"), runs them locally and hands the raw answer back
// (stage "finish").

export const LOCAL_WRITER_LIMITS = { raw: 24_000 } as const;

export const LOCAL_WRITER_MODELS = {
  haiku: { id: "claude-haiku-5-5", label: "Haiku 5.5" },
  sonnet: { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
} as const;
export type LocalWriterModel = keyof typeof LOCAL_WRITER_MODELS;

export type LocalStage =
  | { stage: "messages" }
  | { stage: "finish"; raw: string; model?: string; ms?: number };

export type LocalAnswer = { raw: string; model: string; provider: string; ms: number; notes: string[] };

/** The label shown next to a result: "Haiku 5.5 · local". Unknown names fall back to Haiku. */
export const localModelLabel = (model?: string) => {
  const key = (model ?? "").trim().toLowerCase();
  const found = key in LOCAL_WRITER_MODELS
    ? LOCAL_WRITER_MODELS[key as LocalWriterModel]
    : Object.values(LOCAL_WRITER_MODELS).find((entry) => entry.id === key);
  return `${(found ?? LOCAL_WRITER_MODELS.haiku).label} · local`;
};

/** The answer a local run hands back, in the shape the provider routes return. Throws on an empty answer. */
export const localAnswer = (local: { raw?: string; model?: string; ms?: number }): LocalAnswer => {
  const raw = (local.raw ?? "").slice(0, LOCAL_WRITER_LIMITS.raw);
  if (!raw.trim()) throw new Error("The local writer returned nothing.");
  const ms = Number.isFinite(local.ms) && (local.ms as number) > 0 ? Math.round(local.ms as number) : 0;
  return { raw, model: localModelLabel(local.model), provider: "local", ms, notes: [] };
};
