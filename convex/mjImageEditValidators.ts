import { v } from "convex/values";

export const editFrame = v.object({
  url: v.string(), r2Key: v.optional(v.string()), pageUrl: v.optional(v.string()),
  mjJobId: v.optional(v.string()), mjIndex: v.optional(v.number()), prompt: v.optional(v.string()),
  width: v.optional(v.number()), height: v.optional(v.number()),
  parentRunId: v.optional(v.string()), parentIndex: v.optional(v.number()),
});
// A take in the conversation: Michael's note on it, or what an action works on.
export const takeRef = v.object({ runId: v.string(), index: v.number() });
// What the agent offers under its answer. A run within the thread's cap starts
// by itself (the message's `ran`); queue and save are always Michael's click.
export const editAction = v.union(
  v.object({ type: v.literal("run"), prompt: v.string(), model: v.optional(v.string()), count: v.optional(v.number()), take: v.optional(takeRef) }),
  v.object({ type: v.literal("queue"), prompt: v.string(), title: v.optional(v.string()), take: v.optional(takeRef),
    profileCodes: v.optional(v.array(v.string())), params: v.optional(v.string()) }),
  v.object({ type: v.literal("save"), take: takeRef, section: v.optional(v.string()) }),
);
export const editMessage = {
  id: v.string(), role: v.union(v.literal("michael"), v.literal("agent")), text: v.string(), prompt: v.optional(v.string()),
  reads: v.optional(v.array(v.string())), take: v.optional(takeRef), actions: v.optional(v.array(editAction)),
  ran: v.optional(v.object({ runId: v.string(), estimateUsd: v.number() })), skipped: v.optional(v.string()),
};
export const imageEditFields = {
  ownerUserId: v.string(), key: v.string(), title: v.string(), source: editFrame, activeSource: editFrame,
  model: v.string(), count: v.number(), draft: v.string(), galleryEnabled: v.boolean(),
  world: v.optional(v.string()),
  // The most one agent answer may spend by running an edit itself; 0 = suggest only.
  agentCapUsd: v.optional(v.number()),
  messages: v.array(v.object({ ...editMessage, createdAt: v.number() })),
  runIds: v.array(v.id("mjQuickRuns")), createdAt: v.number(), updatedAt: v.number(),
};
