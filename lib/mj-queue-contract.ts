import { z } from "zod";
import { MJ_QUEUE_LIMITS, MJ_QUEUE_STATUSES } from "./mj-queue";

// Agent-facing Midjourney queue payloads, shared by /api/agent/mj-queue,
// /api/extension/mj-queue and the MCP tool schemas.

const ref = z.object({
  url: z.string().trim().min(1).max(MJ_QUEUE_LIMITS.url).optional()
    .describe("A public image URL Midjourney can fetch, or asset:<id> of a gallery image (resolved to its public URL)."),
  assetId: z.string().trim().min(1).optional().describe("asset:<id> of a gallery image, instead of url."),
  code: z.string().trim().min(1).max(40).optional().describe("Style references only: a numeric sref code instead of an image."),
  weight: z.number().min(-1000).max(1000).optional()
    .describe("Style refs: the ::weight after this reference. Image prompts: --iw (one per prompt; the first given counts). Omni: --ow."),
  label: z.string().trim().max(120).optional().describe("A few words naming the reference, shown on its thumbnail."),
}).refine((value) => Boolean(value.url || value.assetId || value.code), { message: "A reference needs url, assetId or code." });

const clearable = (max: number) => z.string().max(max).nullable().optional();

export const mjQueueItemInputSchema = z.object({
  ingestKey: z.string().trim().min(1).max(200).optional().describe("Stable key: repeating it returns the existing item unchanged."),
  title: z.string().trim().max(MJ_QUEUE_LIMITS.title).optional().describe("A few plain words for Michael, e.g. The letter-writer's hand."),
  prompt: z.string().max(MJ_QUEUE_LIMITS.prompt).describe("The prose only. No URLs or flags: those go in the fields below."),
  imagePrompts: z.array(ref).max(MJ_QUEUE_LIMITS.imagePrompts).optional().describe("Image prompts, placed first in the command."),
  styleRefs: z.array(ref).max(MJ_QUEUE_LIMITS.styleRefs).optional().describe("--sref images or codes, in order."),
  omniRef: ref.optional().describe("--oref image. V8.2 has none (Edit model replaced it): added only when params pin --v 7."),
  characterRef: ref.optional().describe("--cref image. Only V6 reads it: added only when params pin --v 6."),
  profileCodes: z.array(z.string().trim().min(1).max(40)).max(MJ_QUEUE_LIMITS.profileCodes).optional()
    .describe("Personalization codes for --profile (moodboard or profile codes, m<id> for a moodboard id)."),
  params: z.string().max(MJ_QUEUE_LIMITS.params).optional()
    .describe("Every other flag as typed, e.g. --ar 3:1 --draft --relax --stylize 250. --draft and --relax are valid V8.2 prompt params."),
  note: z.string().max(MJ_QUEUE_LIMITS.note).optional().describe("Plain words for Michael: what to look for in this one."),
  order: z.number().optional().describe("Place in the batch; default after the last item."),
});

export const mjQueueAddSchema = z.object({
  batch: z.string().trim().min(1).max(MJ_QUEUE_LIMITS.batch).describe("The thread (batch) label Michael sees, e.g. Dear Annete · name lettering studies, or a thread id thr-xxxxxxxx he copied from the Queue panel. Items join an existing thread with the same label or id. One thread per line of work (a direction, a round)."),
  world: z.string().trim().min(1).optional().describe("World key (dear-annete), name or root id."),
  items: z.array(mjQueueItemInputSchema).min(1).max(MJ_QUEUE_LIMITS.itemsPerCall),
});

export const mjQueueListSchema = z.object({
  batch: z.string().trim().min(1).optional().describe("Only this thread: its label or its id thr-xxxxxxxx."),
  world: z.string().trim().min(1).optional(),
  status: z.enum(MJ_QUEUE_STATUSES).optional(),
  includeDone: z.boolean().optional().describe("Default true. false leaves sent and skipped items out."),
});

export const mjQueueUpdateSchema = z.object({
  itemId: z.string().trim().min(1).describe("mjq:<id> or the bare id from list_mj_queue."),
  title: clearable(MJ_QUEUE_LIMITS.title),
  prompt: z.string().max(MJ_QUEUE_LIMITS.prompt).optional(),
  imagePrompts: z.array(ref).max(MJ_QUEUE_LIMITS.imagePrompts).optional().describe("Replaces the whole list."),
  styleRefs: z.array(ref).max(MJ_QUEUE_LIMITS.styleRefs).optional().describe("Replaces the whole list."),
  omniRef: ref.nullable().optional(),
  characterRef: ref.nullable().optional(),
  profileCodes: z.array(z.string().trim().min(1).max(40)).max(MJ_QUEUE_LIMITS.profileCodes).optional(),
  params: clearable(MJ_QUEUE_LIMITS.params),
  note: clearable(MJ_QUEUE_LIMITS.note),
  status: z.enum(MJ_QUEUE_STATUSES).optional().describe("skipped sets an item aside; queued puts it back. sent is recorded by the extension after Michael's own click."),
  jobId: clearable(80),
  sentCommand: z.string().max(MJ_QUEUE_LIMITS.prompt + 2000).optional(),
  position: z.number().int().min(0).optional().describe("0-based place inside its batch; the others shift around it."),
});

export type MjQueueUpdateInput = z.infer<typeof mjQueueUpdateSchema>;

/** Refs as the Convex mutation takes them: asset ids bare-or-prefixed, as given. */
export const mjQueueItemRef = (id: string) => `mjq:${id}`;
