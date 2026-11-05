import { z } from "zod";
import { NEWSPAPER_LIMITS, absoluteUrl, isDateKey, newspaperUrl } from "./newspaper";

// The newspaper's facts (compiled by convex/newspaper.ts, stored as JSON on the
// edition) and the agent input for the MCP tools / /api/agent/newspaper.

const id = () => z.string().min(1);
const dateKey = z.string().refine(isDateKey, "Expected a date as YYYY-MM-DD (Europe/Prague).");

export const newspaperTaskItemSchema = z.object({
  taskId: id(),
  title: z.string(),
  worldFolderId: id().optional(),
  worldName: z.string(),
  status: z.enum(["open", "claimed", "done", "blocked", "archived"]),
  priority: z.number(),
  // Done: what changed. Blocked: the question for Michael.
  result: z.string().optional(),
  claimedBy: z.string().optional(),
  updatedAt: z.number(),
  path: z.string(),
});
export type NewspaperTaskItem = z.infer<typeof newspaperTaskItemSchema>;

export const newspaperStackItemSchema = z.object({
  stackId: id(),
  worldFolderId: id(),
  worldName: z.string(),
  title: z.string(),
  agent: z.string().optional(),
  cards: z.number(),
  decided: z.number(),
  createdAt: z.number(),
  path: z.string(),
});
export type NewspaperStackItem = z.infer<typeof newspaperStackItemSchema>;

export const newspaperAssetItemSchema = z.object({
  assetId: id(),
  kind: z.enum(["image", "video"]),
  thumbUrl: z.string().optional(),
  url: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  createdAt: z.number(),
  path: z.string(),
});
export type NewspaperAssetItem = z.infer<typeof newspaperAssetItemSchema>;

export const newspaperChangeItemSchema = z.object({
  changeId: id(),
  op: z.string(),
  summary: z.string(),
  actor: z.string(),
  session: z.string().optional(),
  createdAt: z.number(),
});

export const newspaperMoodboardItemSchema = z.object({
  moodboardId: id(),
  name: z.string(),
  status: z.enum(["draft", "in-midjourney", "archived"]),
  itemCount: z.number(),
  // What Midjourney last saw; drift = items added or removed since.
  syncedItemCount: z.number().optional(),
  drift: z.number(),
  mjCode: z.string().optional(),
  isNew: z.boolean(),
  updatedAt: z.number(),
});

export const newspaperTaskCountsSchema = z.object({
  done: z.number(), created: z.number(), blocked: z.number(), open: z.number(),
});

export const newspaperWorldSchema = z.object({
  worldFolderId: id(),
  key: z.string(),
  name: z.string(),
  changes: z.object({
    total: z.number(),
    byOp: z.array(z.object({ op: z.string(), count: z.number() })),
    summaries: z.array(newspaperChangeItemSchema),
  }),
  assets: z.object({ count: z.number(), items: z.array(newspaperAssetItemSchema) }),
  storybooks: z.array(z.object({ folderId: id(), name: z.string(), isNew: z.boolean(), updatedAt: z.number() })),
  moodboards: z.array(newspaperMoodboardItemSchema),
  characters: z.array(z.object({ characterId: id(), code: z.string(), name: z.string(), isNew: z.boolean(), updatedAt: z.number() })),
  tasks: newspaperTaskCountsSchema,
  openStacks: z.number(),
});
export type NewspaperWorld = z.infer<typeof newspaperWorldSchema>;

export const newspaperNeedSchema = z.object({
  kind: z.enum(["stack", "task", "moodboard"]),
  id: id(),
  title: z.string(),
  worldName: z.string(),
  // One line: "3 of 8 cards decided", "Needs your answer", "7 images, not in Midjourney yet".
  detail: z.string(),
  // Where it opens; a moodboard has no page of its own and carries none.
  path: z.string().optional(),
});
export type NewspaperNeed = z.infer<typeof newspaperNeedSchema>;

export const newspaperFactsSchema = z.object({
  version: z.literal(1),
  since: z.number(),
  until: z.number(),
  totals: z.object({
    done: z.number(), created: z.number(), blocked: z.number(), open: z.number(),
    changes: z.number(), assets: z.number(), openStacks: z.number(), needsYou: z.number(),
  }),
  worlds: z.array(newspaperWorldSchema),
  // Assets and tasks that belong to no world.
  studio: z.object({
    assets: z.object({ count: z.number(), items: z.array(newspaperAssetItemSchema) }),
    tasks: newspaperTaskCountsSchema,
  }),
  tasks: z.object({
    done: z.array(newspaperTaskItemSchema),
    created: z.array(newspaperTaskItemSchema),
    blocked: z.array(newspaperTaskItemSchema),
  }),
  stacks: z.array(newspaperStackItemSchema),
  needsYou: z.array(newspaperNeedSchema),
});
export type NewspaperFacts = z.infer<typeof newspaperFactsSchema>;

/** Parse stored facts; null when the JSON is not an edition this UI understands. */
export const parseNewspaperFacts = (json: string): NewspaperFacts | null => {
  try {
    const result = newspaperFactsSchema.safeParse(JSON.parse(json));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
};

/* ── Agent input ─────────────────────────────────────────────────────────── */

export const newspaperGetSchema = z.object({
  date: dateKey.optional().describe("The edition's date, YYYY-MM-DD in Europe/Prague. Omit for the latest edition."),
});

export const newspaperWriteSchema = z.object({
  date: dateKey.describe("The edition to write into (YYYY-MM-DD, Europe/Prague); it must be compiled already."),
  prose: z.string().min(1).max(NEWSPAPER_LIMITS.prose)
    .describe("Markdown: the editorial. What mattered since yesterday, what you propose, at most three questions. Name asset:/task:/stack: ids. Replaces any earlier prose."),
});

export const newspaperCompileSchema = z.object({
  date: dateKey.optional().describe("The edition's date (default today, Europe/Prague). Recompiling a date replaces its facts and keeps its prose."),
});

/* ── What agents get back ────────────────────────────────────────────────── */

const withUrls = <T extends { path?: string }>(row: T) => ({ ...row, ...(row.path ? { url: absoluteUrl(row.path) } : {}) });

/** The stored edition with its facts parsed and every path made absolute. */
export const presentNewspaper = (paper: {
  _id: string; date: string; compiledAt: number; since: number; until: number; facts: string; done: number; needsYou: number; saved: number;
  prose?: string; writtenAt?: number; writtenBy?: string; status: string; compiledBy: string;
}) => {
  const facts = parseNewspaperFacts(paper.facts);
  return {
    id: `newspaper:${paper._id}`,
    date: paper.date,
    url: newspaperUrl(paper.date),
    status: paper.status,
    compiledAt: paper.compiledAt,
    compiledBy: paper.compiledBy,
    window: { since: paper.since, until: paper.until },
    counts: { done: paper.done, needsYou: paper.needsYou, saved: paper.saved },
    prose: paper.prose,
    writtenAt: paper.writtenAt,
    writtenBy: paper.writtenBy,
    facts: facts
      ? {
        ...facts,
        worlds: facts.worlds.map((world) => ({ ...world, assets: { ...world.assets, items: world.assets.items.map(withUrls) } })),
        studio: { ...facts.studio, assets: { ...facts.studio.assets, items: facts.studio.assets.items.map(withUrls) } },
        tasks: { done: facts.tasks.done.map(withUrls), created: facts.tasks.created.map(withUrls), blocked: facts.tasks.blocked.map(withUrls) },
        stacks: facts.stacks.map(withUrls),
        needsYou: facts.needsYou.map(withUrls),
      }
      : null,
  };
};
