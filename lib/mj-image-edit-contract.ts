import { z } from "zod";
import { WRITER_MODEL_KEYS, WRITER_PROVIDERS } from "./writer-models";

// The most one agent answer may spend running an edit by itself, and the
// limit a thread starts with (Michael, 25 Nov 2026: "Run under a cap").
export const AGENT_CAP_MAX_USD = 2;
export const DEFAULT_AGENT_CAP_USD = 0.2;
export const agentCapOf = (thread: { agentCapUsd?: number }) => thread.agentCapUsd ?? DEFAULT_AGENT_CAP_USD;

export const imageEditFrameSchema = z.object({ url: z.string().url().max(2000).refine(s => s.startsWith("https://")),
  r2Key: z.string().max(500).optional(), pageUrl: z.string().max(2000).optional(), mjJobId: z.string().max(80).optional(),
  mjIndex: z.number().int().min(0).max(15).optional(), prompt: z.string().max(6000).optional(), width: z.number().positive().optional(), height: z.number().positive().optional(),
  parentRunId: z.string().max(80).optional(), parentIndex: z.number().int().min(0).max(3).optional() });
export const takeRefSchema = z.object({ runId: z.string().min(1).max(80), index: z.number().int().min(0).max(3) });
export const imageEditUpdateSchema = z.object({ id: z.string().max(80), draft: z.string().max(2000).optional(), model: z.string().max(40).optional(),
  count: z.number().int().min(1).max(3).optional(), galleryEnabled: z.boolean().optional(), world: z.string().max(120).optional(), activeSource: imageEditFrameSchema.optional(),
  agentCapUsd: z.number().min(0).max(AGENT_CAP_MAX_USD).optional(),
  message: z.object({ id: z.string().min(1).max(100), role: z.enum(["michael", "agent"]), text: z.string().min(1).max(6000), prompt: z.string().max(2000).optional(),
    reads: z.array(z.string().max(160)).max(24).optional(), take: takeRefSchema.optional() }).optional() });
export const imageEditDraftSchema = z.object({ id: z.string().max(80), messageId: z.string().max(100), model: z.enum(WRITER_MODEL_KEYS).optional(), provider: z.enum(WRITER_PROVIDERS).optional(), rules: z.string().max(12000).optional(),
  results: z.array(z.object({ name: z.string().max(100), result: z.string().max(40000) })).max(9).default([]),
  local: z.object({ stage: z.enum(["messages", "finish"]), raw: z.string().max(24000).optional(), model: z.string().max(60).optional(), ms: z.number().nonnegative().optional() }).optional() });

// What the agent may offer under an answer (see convex/mjImageEditValidators editAction).
export const editActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run"), prompt: z.string().min(1).max(2000), model: z.string().max(40).optional(), count: z.number().int().min(1).max(3).optional(), take: takeRefSchema.optional() }),
  z.object({ type: z.literal("queue"), prompt: z.string().min(1).max(4000), title: z.string().max(120).optional(), take: takeRefSchema.optional(),
    profileCodes: z.array(z.string().min(1).max(40)).max(12).optional(), params: z.string().max(400).optional() }),
  z.object({ type: z.literal("save"), take: takeRefSchema, section: z.enum(["character", "location", "scene", "inspiration"]).optional() }),
]);
export type EditAction = z.infer<typeof editActionSchema>;
