import { z } from "zod";
import { EDIT_MODELS, MAX_EDIT_PROMPT, MAX_EDIT_REFS, MAX_TAKES } from "./edit-models";

// Agent input for in-place edits (MCP tools and /api/agent/edits).
const modelIds = EDIT_MODELS.map((model) => model.id) as [string, ...string[]];

export const editStartSchema = z.object({
  assetId: z.string().min(1).describe("asset:<id> or a bare id of the image to edit. It is <image-1> in the prompt."),
  prompt: z.string().min(1).max(MAX_EDIT_PROMPT).describe("What to change, naming what stays (pose, room, light, framing). References are <image-2>, <image-3>… in the order given."),
  models: z.array(z.enum(modelIds)).min(1).max(6).describe(`Model ids: ${EDIT_MODELS.map((m) => `${m.id} (${m.name})`).join(", ")}. krea-3 is the edit model; gpt-* only for a targeted edit of one thing.`),
  takes: z.number().int().min(1).max(MAX_TAKES).optional().describe("Takes per model, default 1."),
  refs: z.array(z.object({
    assetId: z.string().min(1).describe("asset:<id> of a reference image, e.g. a character's canonical sheet or face."),
    name: z.string().max(60).optional().describe("How the prompt calls it, e.g. 'Dari sheet'."),
  })).max(MAX_EDIT_REFS).optional(),
});

export const editListSchema = z.object({
  assetId: z.string().min(1).optional().describe("asset:<id>: that image's edits (and what it is an edit of). Omit for the newest edits across the vault."),
  limit: z.number().int().min(1).max(80).optional().describe("Vault-wide listing size, default 30."),
});

export const editRetrySchema = z.object({
  jobId: z.string().min(1).describe("The edit job id (editJobs:<id> or bare) of a failed or stalled take."),
});
