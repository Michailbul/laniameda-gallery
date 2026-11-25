import { makeFunctionReference } from "convex/server";
import type { getServerConvexClient } from "@/lib/server/convex";
import { fastModelById, planFastRun } from "@/lib/mj-fast-helper";
import { agentCapOf, type EditAction } from "@/lib/mj-image-edit-contract";
import { runNames, type ImageEditAnswer } from "@/lib/mj-image-edit-chat";

type Client = ReturnType<typeof getServerConvexClient>;
type Frame = { url: string; r2Key?: string; pageUrl?: string; mjJobId?: string; mjIndex?: number; prompt?: string; width?: number; height?: number; parentRunId?: string; parentIndex?: number };
type Thread = { _id: string; model: string; count: number; world?: string; agentCapUsd?: number; activeSource: Frame };
type Run = { _id: string; takes: Array<{ index: number; status: string; url?: string; width?: number; height?: number }> };

const startRun = makeFunctionReference<"mutation">("mjQuickRuns:startRun");
const update = makeFunctionReference<"mutation">("mjImageEdits:update");
const getRuns = makeFunctionReference<"query">("mjQuickRuns:getRuns");

// The thread's runs, newest last (getRuns takes 30 ids at a time).
export async function threadRuns(client: Client, ownerUserId: string, ids: string[]) {
  const recent = ids.slice(-30);
  return recent.length ? await client.query(getRuns, { ownerUserId, ids: recent }) : [];
}

// The agent's take names (r3t2) back to {runId, index}; unknown ones are dropped.
export function resolveActions(actions: ImageEditAnswer["actions"], runs: Parameters<typeof runNames>[0]): EditAction[] {
  const { resolve } = runNames(runs);
  const out: EditAction[] = [];
  for (const action of actions) {
    const take = "take" in action && action.take ? resolve(action.take) : undefined;
    if (action.type === "save") { if (take) out.push({ ...action, take }); continue; }
    const { take: _name, ...rest } = action; void _name;
    out.push({ ...rest, ...(take ? { take } : {}) } as EditAction);
  }
  return out;
}


/**
 * An edit the agent runs by itself, inside the thread's limit. The request key
 * makes a retried answer return the same run, never a second one.
 */
export async function runForAgent(client: Client, ownerUserId: string, thread: Thread, runs: Run[],
  action: { prompt: string; model?: string; count?: number; take?: { runId: string; index: number } }, requestKey: string,
  capUsd = agentCapOf(thread)): Promise<{ runId: string; estimateUsd: number } | { skipped: string }> {
  if (capUsd <= 0) return { skipped: "Agent runs are off for this edit." };
  const model = action.model && fastModelById(action.model) ? action.model : thread.model;
  const count = Math.min(3, Math.max(1, Math.floor(action.count || 1)));
  let source: Frame = thread.activeSource;
  if (action.take) {
    const run = runs.find(r => r._id === action.take!.runId);
    const take = run?.takes.find(t => t.index === action.take!.index);
    if (!take || take.status !== "done" || !take.url) return { skipped: "That take is not ready." };
    source = { url: take.url, width: take.width, height: take.height, parentRunId: run!._id, parentIndex: take.index };
  }
  const plan = planFastRun({ modelId: model, instruction: action.prompt, count, refs: 0, width: source.width, height: source.height });
  if (!plan.ok) return { skipped: plan.error };
  if (plan.totalUsd > capUsd + 1e-9) return { skipped: `About $${plan.totalUsd.toFixed(2)}, over the agent's $${capUsd.toFixed(2)} limit.` };
  if (action.take) await client.mutation(update, { ownerUserId, id: thread._id, activeSource: source });
  const result = await client.mutation(startRun, {
    ownerUserId, threadId: thread._id, requestKey, model, instruction: plan.instruction, count,
    source: {
      ...(source.r2Key ? { r2Key: source.r2Key } : { url: source.url }),
      ...(source.mjJobId ? { mjJobId: source.mjJobId, mjIndex: source.mjIndex } : {}),
      ...(source.pageUrl ? { pageUrl: source.pageUrl } : {}),
      ...(source.prompt ? { prompt: source.prompt.slice(0, 6000) } : {}),
      ...(source.parentRunId ? { parentRunId: source.parentRunId, parentIndex: source.parentIndex } : {}),
      ...(source.width ? { width: source.width } : {}),
      ...(source.height ? { height: source.height } : {}),
    },
    refs: [],
    ...(thread.world ? { world: { key: thread.world } } : {}),
  }) as { runId: string; estimateUsd: number };
  return { runId: result.runId, estimateUsd: result.estimateUsd };
}
