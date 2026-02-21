import { generateImage, Output, streamText, type LanguageModelUsage } from "ai";
import { gateway } from "@ai-sdk/gateway";
import type { RunIntent } from "@/lib/run-contract";
import { getDefaultTextModel } from "@/lib/ai/models";
import type { CompactUsage } from "@/lib/ai/schemas";
import { promptPackageSchema } from "@/lib/ai/schemas";

const buildPromptPackageSystem = () => {
  return [
    "You are an expert UGC/influencer image prompt engineer.",
    "Return concise, production-ready prompt packages.",
    "Always optimize for speed-to-result with minimal user effort.",
    "Keep outputs aligned with influencer photography aesthetics.",
  ].join(" ");
};

const buildPromptPackagePrompt = ({
  intent,
  referenceAssetId,
  userInput,
}: {
  intent: RunIntent;
  referenceAssetId: string;
  userInput?: unknown;
}) => {
  return [
    `Task intent: ${intent}`,
    `Reference asset id: ${referenceAssetId}`,
    "Generate a complete prompt package with:",
    "- finalPrompt",
    "- negativePrompt",
    "- generationNotes (array of concise bullet strings)",
    "- suggestedTags (array)",
    "- safetyChecks (array)",
    `User input JSON: ${JSON.stringify(userInput ?? {}, null, 2)}`,
  ].join("\n");
};

export const createPromptPackageStream = ({
  intent,
  referenceAssetId,
  userInput,
  signal,
}: {
  intent: RunIntent;
  referenceAssetId: string;
  userInput?: unknown;
  signal?: AbortSignal;
}) => {
  return streamText({
    model: gateway(getDefaultTextModel()),
    system: buildPromptPackageSystem(),
    prompt: buildPromptPackagePrompt({ intent, referenceAssetId, userInput }),
    output: Output.object({ schema: promptPackageSchema }),
    abortSignal: signal,
    maxRetries: 1,
  });
};

export const toCompactUsage = (usage: LanguageModelUsage | undefined): CompactUsage => {
  if (!usage) {
    return {};
  }

  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    estimatedCostUsd: undefined,
  };
};

export const generateImageFromPrompt = async ({
  modelId,
  prompt,
  signal,
}: {
  modelId: string;
  prompt: string;
  signal?: AbortSignal;
}) => {
  const result = await generateImage({
    model: gateway.image(modelId),
    prompt,
    abortSignal: signal,
    n: 1,
    maxRetries: 1,
  });

  const image = result.image;
  const mediaType = image.mediaType || "image/png";
  const dataUrl = `data:${mediaType};base64,${image.base64}`;

  return {
    dataUrl,
    mediaType,
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
      estimatedCostUsd: undefined,
    } satisfies CompactUsage,
    imagesCount: result.images.length,
  };
};
