import { z } from "zod";
import { MJ_QUEUE_LIMITS, MJ_QUEUE_STATUSES } from "./mj-queue";
import { MJ_THREAD_LIMITS } from "./mj-thread";

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
  omniRef: ref.optional().describe("Not used: V8.2 has no --oref (the Edit model replaced it). The item keeps it and warns; attach the picture as an edit reference instead."),
  characterRef: ref.optional().describe("Not used in V8.2: --cref is added only with --niji 6. Otherwise the item warns; attach the picture as an edit reference instead."),
  profileCodes: z.array(z.string().trim().min(1).max(40)).max(MJ_QUEUE_LIMITS.profileCodes).optional()
    .describe("Personalization codes for --profile (moodboard or profile codes, m<id> for a moodboard id)."),
  params: z.string().max(MJ_QUEUE_LIMITS.params).optional()
    .describe("Every other flag as typed, e.g. --ar 3:1 --draft --relax --stylize 250. --draft and --relax are valid V8.2 prompt params. Every job is V8.2: leave --v out or write --v 8.2. --v 8.1, --v 7 and older are rewritten to --v 8.2 and the item warns."),
  note: z.string().max(MJ_QUEUE_LIMITS.note).optional().describe("Plain words for Michael: what to look for in this one."),
  order: z.number().optional().describe("Place in the batch; default after the last item."),
  describe: z.object({
    sourceUrl: z.string().max(MJ_QUEUE_LIMITS.url).optional(),
    pageUrl: z.string().max(MJ_QUEUE_LIMITS.url).optional(),
    descriptions: z.array(z.string().max(1500)).max(4),
    mode: z.enum(["keep", "ours"]),
  }).optional().describe("Set by the extension's describer: the source picture and Midjourney's Describe lines (lineage)."),
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
  archived: z.boolean().optional().describe("true: only archived threads (ones Michael deleted from the panel; history kept). Default: only live threads."),
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

export const mjQueueRequeueSchema = z.object({
  itemIds: z.array(z.string().trim().min(1)).min(1).max(MJ_QUEUE_LIMITS.itemsPerCall)
    .describe("Prompts to queue again (mjq:<id> or bare ids), usually sent ones. Each becomes a new queued copy at the end of its thread; the original keeps its job."),
});

export const mjQueueForkSchema = z.object({
  itemId: z.string().trim().min(1).describe("The prompt to copy (mjq:<id> or the bare id)."),
  batch: z.string().trim().min(1).max(MJ_QUEUE_LIMITS.batch).describe("The new thread's name; a taken name gets · 2, · 3 …"),
  createdBy: z.string().trim().max(80).optional(),
  variants: z.array(z.object({
    title: z.string().trim().max(MJ_QUEUE_LIMITS.title),
    profileCodes: z.array(z.string().trim().min(1).max(40)).max(MJ_QUEUE_LIMITS.profileCodes),
    params: z.string().max(MJ_QUEUE_LIMITS.params).optional(),
  })).min(1).max(MJ_QUEUE_LIMITS.itemsPerCall),
});

export const mjQueueParamsSchema = z.object({
  items: z.array(z.object({
    itemId: z.string().trim().min(1),
    params: z.string().max(MJ_QUEUE_LIMITS.params),
  })).min(1).max(MJ_QUEUE_LIMITS.itemsPerBatch),
});

export const mjQueueDeleteThreadSchema = z.object({
  batch: z.string().trim().min(1).max(MJ_QUEUE_LIMITS.batch).describe("The thread's label, batch key or id thr-xxxxxxxx."),
});

export const mjQueueArchiveSchema = z.object({
  batch: z.string().trim().min(1).max(MJ_QUEUE_LIMITS.batch).describe("The thread's label or id thr-xxxxxxxx."),
  restore: z.boolean().optional().describe("true brings an archived thread back into the queue."),
});

// ── A thread's runs and chat (convex/mjThreads.ts, 23 Nov 2026) ──

const threadRef = z.string().trim().min(1).max(MJ_QUEUE_LIMITS.batch).describe("The thread: its label or its id thr-xxxxxxxx.");
const codeList = z.array(z.string().trim().min(1).max(40)).max(MJ_QUEUE_LIMITS.profileCodes);
const clearNumber = (min: number, max: number) => z.number().min(min).max(max).nullable().optional();

export const mjRecipeSchema = z.object({
  profileCodes: codeList.optional().describe("Replaces each prompt's --profile list (moodboard and profile codes; m<id> for a moodboard id). [] removes every profile."),
  addProfileCodes: codeList.optional().describe("Codes added to each prompt's own list."),
  removeProfileCodes: codeList.optional().describe("Codes taken out of each prompt's own list."),
  srefs: z.array(z.string().trim().min(1).max(MJ_QUEUE_LIMITS.url)).max(MJ_QUEUE_LIMITS.styleRefs).optional()
    .describe("Replaces the --sref list: numeric codes (code::weight allowed) or public image URLs. [] removes every sref."),
  params: z.string().max(MJ_QUEUE_LIMITS.params).optional().describe("Replaces the whole params line; the fields below apply on top."),
  stylize: clearNumber(0, 1000).describe("--stylize; null removes it."),
  chaos: clearNumber(0, 100).describe("--chaos; null removes it."),
  weird: clearNumber(0, 3000).describe("--weird; null removes it."),
  ar: z.string().regex(/^\d{1,3}:\d{1,3}$/).nullable().optional().describe("--ar like 16:9; null removes it."),
  raw: z.boolean().optional().describe("true adds --raw, false leaves it out (Standard)."),
  hd: z.boolean().optional().describe("true adds --hd, false leaves it out."),
  opening: z.string().max(MJ_THREAD_LIMITS.opening).optional()
    .describe("The keyword opening every prompt starts with, e.g. Painted storybook animation frame. Swaps the thread's shared first sentence (or is put in front); \"\" removes it."),
}).describe("Only what changes. Everything left out stays as each prompt has it.");

export const mjThreadReadSchema = z.object({
  batch: threadRef,
});

export const mjThreadMessageSchema = z.object({
  batch: threadRef,
  text: z.string().trim().min(1).max(MJ_THREAD_LIMITS.reply).describe("Your reply to Michael in plain words: what you changed, or your question."),
  replyTo: z.string().trim().min(1).optional().describe("The id of Michael's message you answer (from read_mj_thread). Left out, the reply closes every waiting message."),
  changes: z.array(z.string().trim().min(1).max(MJ_THREAD_LIMITS.change)).max(MJ_THREAD_LIMITS.changes).optional()
    .describe("What you changed in the thread, one plain line each (Edited #3; Run 2 queued: 39 prompts · stylize 750)."),
  run: z.number().int().min(1).optional().describe("The run your change queued, when it was a rerun."),
});

const itemRefs = z.array(z.string().trim().min(1)).min(1).max(MJ_QUEUE_LIMITS.itemsPerBatch);

export const mjThreadRerunSchema = z.object({
  batch: threadRef,
  fromRun: z.number().int().min(1).optional().describe("Rerun every prompt of this run (default: the latest run), skipped ones left out."),
  items: itemRefs.optional().describe("Instead: only these prompts (mjq:<id> or bare ids), from any run."),
  recipe: mjRecipeSchema.optional(),
  prompts: z.array(z.object({
    itemId: z.string().trim().min(1),
    prompt: z.string().min(1).max(MJ_QUEUE_LIMITS.prompt).describe("The new prose for this prompt's copy."),
  })).max(MJ_QUEUE_LIMITS.itemsPerBatch).optional().describe("New words for some of the copies; the originals keep theirs."),
  note: z.string().max(MJ_THREAD_LIMITS.note).optional().describe("Why this run, in plain words, shown with the run."),
});

export const mjThreadEditSchema = z.object({
  batch: threadRef,
  recipe: mjRecipeSchema,
  items: itemRefs.optional().describe("Only these prompts (mjq:<id> or bare ids); default every prompt still to send. Sent ones keep theirs: rerun them instead."),
});

export const mjThreadChatAskSchema = z.object({
  batch: threadRef,
  text: z.string().trim().min(1).max(MJ_THREAD_LIMITS.message),
});

export type MjQueueUpdateInput = z.infer<typeof mjQueueUpdateSchema>;

/** Refs as the Convex mutation takes them: asset ids bare-or-prefixed, as given. */
export const mjQueueItemRef = (id: string) => `mjq:${id}`;
