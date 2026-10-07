import { z } from "zod";

const text = z.string().trim().min(1);
const mediaSchema = z.object({
  url: z.string().url().optional(),
  uploadId: text.optional(),
  posterUploadId: text.optional(),
  fileBase64: text.optional(),
  fileName: text.optional(),
  contentType: text.optional(),
  description: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  agentDescription: text.max(400).optional(),
}).strict().refine((media) => [media.url, media.uploadId, media.fileBase64].filter(Boolean).length === 1, {
  message: "Each Skill media item needs exactly one url, uploadId or fileBase64.",
});

export const createSkillInputSchema = z.object({
  ingestKey: text.max(300),
  title: text.max(500),
  description: z.string().max(4000).optional(),
  body: z.string().max(100000).optional(),
  agentInstructions: z.string().max(100000).optional(),
  tagNames: z.array(text).max(100).optional(),
  folderIds: z.array(text).max(30).optional(),
  steps: z.array(z.object({
    stepLabel: text.optional(),
    promptText: text,
    promptSections: z.object({
      finalPrompt: text,
      negativePrompt: z.string().optional(),
      generationNotes: z.string().optional(),
    }).optional(),
    modelName: text.optional(),
    modelProvider: z.enum(["openai", "anthropic", "google", "xai", "meta", "flux", "midjourney", "runway", "other"]).optional(),
    tagNames: z.array(text).max(100).optional(),
    media: z.array(mediaSchema).max(12).optional(),
  }).strict()).max(50).optional(),
}).strict().refine((skill) => Boolean(skill.steps?.length || skill.body?.trim() || skill.agentInstructions?.trim()), {
  message: "A Skill needs a markdown body, how-to instructions or at least one step.",
});

export type CreateSkillInput = z.infer<typeof createSkillInputSchema>;
