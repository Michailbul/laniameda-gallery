import { z } from "zod";
import { TASK_LIMITS, TASK_LINK_KINDS, TASK_SOURCES, TASK_STATUSES } from "./tasks";

// Agent input for the task queue (MCP tools and /api/agent/tasks).

const ref = (description: string) => z.string().min(1).max(200).describe(description);
const world = z.string().min(1).max(200).describe("A world: its key (dear-annete), name or collection id. Omit for a studio-wide task.");
export const taskStatusSchema = z.enum(TASK_STATUSES);
export const taskPrioritySchema = z.union([z.literal(1), z.literal(2), z.literal(3)]).describe("1 = now, 2 = next (default), 3 = later.");

export const taskLinkSchema = z.object({
  kind: z.enum(TASK_LINK_KINDS).describe("asset, story, stack, moodboard, character, collection, doc (a world doc path) or url."),
  id: z.string().min(1).max(600).describe("The bare id (asset:<id> is accepted), doc path or URL."),
  label: z.string().min(1).max(TASK_LIMITS.linkLabel).optional().describe("What this link is, e.g. 'repaired version'."),
});

export const taskListSchema = z.object({
  world: world.optional().describe("Only this world's tasks. Omit for every task, studio-wide ones included."),
  status: z.union([taskStatusSchema, z.literal("active"), z.literal("all")]).optional()
    .describe("active (default) = open + claimed + blocked; or one status; or all."),
  assignee: z.string().min(1).max(TASK_LIMITS.assignee).optional().describe("Only tasks assigned to or claimed by this actor (agent:<name>)."),
  source: z.enum(TASK_SOURCES).optional().describe("manual, comment (from Michael's asset comments), inbox (from his Inbox answers), newspaper, or feedback (a note he left from any page with the Feedback button)."),
  limit: z.number().int().min(1).max(TASK_LIMITS.list).optional().describe(`Default ${TASK_LIMITS.listDefault}.`),
});

export const taskRefSchema = z.object({ taskId: ref("task:<id> or a bare id, from list_tasks, create_task or open_world.") });

export const taskCreateSchema = z.object({
  world: world.optional(),
  title: z.string().min(1).max(TASK_LIMITS.humanTitle).describe(`What Michael reads on the wall, in his words, under ${TASK_LIMITS.humanTitle} characters: "Run the bigger prompt test", "Make Mila's character sheet". No ids, file paths, tool names, flags or experiment codes; those go in the brief.`),
  summary: z.string().min(1).max(TASK_LIMITS.summary).describe("One plain line under the title for Michael: why it matters or what he will get. Required."),
  brief: z.string().min(1).max(TASK_LIMITS.brief).optional().describe("Markdown for the agent who takes it: the whole instruction, with the asset:/story: ids it concerns. Only the Agent view shows it."),
  priority: taskPrioritySchema.optional(),
  assignee: z.string().min(1).max(TASK_LIMITS.assignee).optional().describe("Who should take it (agent:<name>); anyone may claim an unassigned task."),
  links: z.array(taskLinkSchema).max(TASK_LIMITS.links).optional().describe("Typed handles to what the task is about."),
  dueAt: z.number().int().nonnegative().optional().describe("Due time, ms since epoch."),
  ingestKey: z.string().min(1).max(TASK_LIMITS.ingestKey).optional().describe("Stable key: creating again with it returns the existing task instead of a second one."),
  session: z.string().min(1).max(80).optional().describe("Journal session label, when the task belongs to a world."),
});

export const taskClaimSchema = taskRefSchema.extend({
  assignee: z.string().min(1).max(TASK_LIMITS.assignee).optional().describe("Who claims it; default this token's agent label."),
  leaseMinutes: z.number().int().min(1).max(TASK_LIMITS.leaseMinutesMax).optional().describe(`How long the claim holds before others may take over (default ${TASK_LIMITS.leaseMinutesDefault}). Comments renew it.`),
});

export const taskReleaseSchema = taskRefSchema.extend({
  note: z.string().min(1).max(TASK_LIMITS.comment).optional().describe("Why it goes back to the queue."),
  assignee: z.string().min(1).max(TASK_LIMITS.assignee).optional().describe("Act as this label when the task was claimed under one that is not this token's own (the claim_task assignee); default this token's agent label."),
});

const askAssetIds = (max: number, what: string) => z.array(z.string().min(1).max(200)).max(max).optional().describe(what);

export const taskAskSchema = z.object({
  question: z.string().min(1).max(TASK_LIMITS.askQuestion)
    .describe(`One line, plain words, an art-direction call he can make by looking: "Which street look is better?", "Keep the gold coat or the black?". Under ${TASK_LIMITS.askQuestion} characters. No experiment names, settings or numbers.`),
  assetIds: askAssetIds(TASK_LIMITS.askAssets, "Context frames shown above the options (asset:<id> or bare), when the options themselves carry none."),
  options: z.array(z.object({
    label: z.string().min(1).max(TASK_LIMITS.askLabel).describe("A few words he can pick: 'Place first (our way)', 'Run the big test'."),
    assetIds: askAssetIds(TASK_LIMITS.askOptionAssets, "The frames that show this option, same order in every option so rows line up (street, close-up, object)."),
    recommended: z.boolean().optional().describe("Your pick; one option at most."),
  })).min(TASK_LIMITS.askOptionsMin).max(TASK_LIMITS.askOptionsMax).describe("2–4 options; he picks one with a click."),
});

export const taskCompleteSchema = taskRefSchema.extend({
  result: z.string().min(1).max(TASK_LIMITS.result).optional().describe("Markdown for agents. Done: what was done and the asset:/story:/stack: ids produced (required). Blocked: the reasoning behind the ask. Only the Agent view shows it."),
  summary: z.string().min(1).max(TASK_LIMITS.summary).optional().describe("Done: one plain line for Michael, what he will see now ('Mila's sheet is ready: front, side and back'). Required when done; put the frames in links."),
  blocked: z.boolean().optional().describe("true = you need Michael (status blocked, shown under Needs you): pass ask. false/omitted = done."),
  ask: taskAskSchema.optional().describe("Required with blocked: true. The question as pictures and one-click options; at least one frame. A text-only question is refused."),
  links: z.array(taskLinkSchema).max(TASK_LIMITS.links).optional().describe("What the work produced, added to the task's links."),
  session: z.string().min(1).max(80).optional().describe("Journal session label of the work, so the journal shows it next to the task."),
  assignee: z.string().min(1).max(TASK_LIMITS.assignee).optional().describe("Act as this label when the task was claimed under one that is not this token's own (the claim_task assignee); default this token's agent label."),
});

export const taskEditSchema = taskRefSchema.extend({
  title: z.string().min(1).max(TASK_LIMITS.humanTitle).optional().describe("A plainer title for the wall."),
  summary: z.string().min(1).max(TASK_LIMITS.summary).optional().describe("A plainer one-line summary for the wall."),
  brief: z.string().min(1).max(TASK_LIMITS.brief).optional().describe("Replace the agent brief."),
});

/** Done needs a result; blocked needs an ask. Checked in the route, so the MCP input schema stays a plain object. */
export const completeInputProblem = (input: z.infer<typeof taskCompleteSchema>) =>
  input.blocked ? (input.ask ? null : "blocked: true needs ask {question, options: 2–4 {label, assetIds}}: Michael answers pictures, not prose.")
    : !input.result ? "Say what was done in result and name the asset:/story:/stack: ids produced."
      : input.summary ? null : "Add summary: one plain line for Michael, what he will see now.";

export const taskCommentSchema = taskRefSchema.extend({
  body: z.string().min(1).max(TASK_LIMITS.comment).describe("Plain text or markdown. A progress note renews your claim."),
  assignee: z.string().min(1).max(TASK_LIMITS.assignee).optional().describe("Act as this label when the task was claimed under one that is not this token's own (the claim_task assignee); default this token's agent label."),
});
