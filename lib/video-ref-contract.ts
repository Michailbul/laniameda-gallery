import { z } from "zod";

const text = z.string().trim().min(1);
const timestamp = z.union([z.number().finite().nonnegative(), text.transform((value, ctx) => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) { ctx.addIssue({ code: "custom", message: "publishedAfter must be an epoch timestamp or a valid date." }); return z.NEVER; }
  return parsed;
})]);

export const videoRefsPageInputSchema = z.object({
  cursor: z.string().min(1).nullable().optional(),
  pageSize: z.number().int().min(1).max(200).optional(),
  collection: text.optional(), topic: text.optional(), styleFamily: text.optional(), productionStyle: text.optional(),
  language: text.optional(), tagNames: z.array(text).max(100).optional(), channelHandle: text.optional(), search: text.optional(),
  onlyLiked: z.boolean().optional(), onlyChannelBest: z.boolean().optional(), minViews: z.number().finite().nonnegative().optional(),
  publishedAfter: timestamp.optional(),
}).strict();
