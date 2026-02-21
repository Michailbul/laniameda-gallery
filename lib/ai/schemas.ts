import { z } from "zod";

export const promptPackageSchema = z.object({
  finalPrompt: z.string().min(1),
  negativePrompt: z.string().min(1),
  generationNotes: z.array(z.string()).min(1),
  suggestedTags: z.array(z.string()).default([]),
  safetyChecks: z.array(z.string()).default([]),
});

export type PromptPackage = z.infer<typeof promptPackageSchema>;

export type CompactUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
};
