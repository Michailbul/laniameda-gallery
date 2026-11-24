import { v } from "convex/values";

export const editFrame = v.object({
  url: v.string(), r2Key: v.optional(v.string()), pageUrl: v.optional(v.string()),
  mjJobId: v.optional(v.string()), mjIndex: v.optional(v.number()), prompt: v.optional(v.string()),
  width: v.optional(v.number()), height: v.optional(v.number()),
  parentRunId: v.optional(v.string()), parentIndex: v.optional(v.number()),
});
export const imageEditFields = {
  ownerUserId: v.string(), key: v.string(), title: v.string(), source: editFrame, activeSource: editFrame,
  model: v.string(), count: v.number(), draft: v.string(), galleryEnabled: v.boolean(),
  world: v.optional(v.string()),
  messages: v.array(v.object({ id: v.string(), role: v.union(v.literal("michael"), v.literal("agent")),
    text: v.string(), prompt: v.optional(v.string()), reads: v.optional(v.array(v.string())), createdAt: v.number() })),
  runIds: v.array(v.id("mjQuickRuns")), createdAt: v.number(), updatedAt: v.number(),
};
