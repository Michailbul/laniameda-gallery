export const AI_RUNTIMES = ["ai_sdk", "agent_worker"] as const;

export type AiRuntime = (typeof AI_RUNTIMES)[number];

export type AiProvider = "gateway" | "provider_direct";

export type AiRunMode = "prompt_package" | "image_generate";

export type ImageModelAlias = "nano_banana_pro" | "nano_banana_fast";

const DEFAULT_TEXT_MODEL = process.env.AI_TEXT_MODEL || "anthropic/claude-sonnet-4.5";
const DEFAULT_IMAGE_MODEL_NANO_BANANA =
  process.env.AI_IMAGE_MODEL_NANO_BANANA || "google/gemini-3-pro-image";
const DEFAULT_IMAGE_MODEL_NANO_BANANA_FAST =
  process.env.AI_IMAGE_MODEL_NANO_BANANA_FAST || "google/gemini-2.5-flash-image";

export const DEFAULT_IMAGE_ALIAS: ImageModelAlias = "nano_banana_pro";

export const isAiRuntime = (value: string): value is AiRuntime => {
  return AI_RUNTIMES.includes(value as AiRuntime);
};

export const isAgentWorkerEnabled = () => {
  return process.env.ENABLE_AGENT_WORKER === "true";
};

export const getDefaultRuntime = (): AiRuntime => {
  const configured = process.env.AI_RUNTIME_DEFAULT;
  if (configured && isAiRuntime(configured)) {
    return configured;
  }
  return "ai_sdk";
};

export const getDefaultTextModel = () => DEFAULT_TEXT_MODEL;

const IMAGE_ALIAS_TO_MODEL: Record<ImageModelAlias, string> = {
  nano_banana_pro: DEFAULT_IMAGE_MODEL_NANO_BANANA,
  nano_banana_fast: DEFAULT_IMAGE_MODEL_NANO_BANANA_FAST,
};

export const resolveImageModelAlias = (alias?: string) => {
  const normalized = (alias || DEFAULT_IMAGE_ALIAS).trim().toLowerCase();
  if (normalized in IMAGE_ALIAS_TO_MODEL) {
    const key = normalized as ImageModelAlias;
    return {
      ok: true as const,
      alias: key,
      modelId: IMAGE_ALIAS_TO_MODEL[key],
      provider: "gateway" as const,
    };
  }

  return {
    ok: false as const,
    error: `Unsupported modelAlias: ${alias || "(empty)"}.`,
    allowedAliases: Object.keys(IMAGE_ALIAS_TO_MODEL),
  };
};
