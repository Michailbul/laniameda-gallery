import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { requireAgentAuth, AgentAuthError, type AgentTokenScope } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { clientErrorMessage } from "@/lib/server/route-error";
import { mjQueueAddSchema, mjQueueItemRef, mjQueueListSchema, mjQueueUpdateSchema } from "@/lib/mj-queue-contract";
import { MJ_THREAD_ID, threadIdOf } from "@/lib/mj-queue";
import { mjQueueUrl } from "@/lib/gallery-routes";

// Midjourney prompt queue for agents: queue prompts with every reference set,
// read the queue back with the composed commands, edit, reorder or skip.
// Sending stays Michael's own click in the extension's Queue panel.

const actions = ["list", "queue", "update"] as const;
const scopes: Record<(typeof actions)[number], AgentTokenScope> = {
  list: "gallery:read", queue: "gallery:write", update: "gallery:write",
};

// `url` is the thread's page on the gallery website (the world's Queue tab, or
// /queue without a world), where Michael copies prompts or marks them sent.
const threadUrl = (batchKey: string, worldKey?: string) => mjQueueUrl({ world: worldKey, thread: threadIdOf(batchKey) });
const withRef = <T extends { id: string; batchKey?: string; worldKey?: string }>(row: T) => ({
  ...row, ref: mjQueueItemRef(row.id),
  ...(row.batchKey ? { threadId: threadIdOf(row.batchKey), url: threadUrl(row.batchKey, row.worldKey) } : {}),
});
const withThreadId = <T extends { batchKey: string; worldKey?: string }>(batch: T) => ({
  ...batch, threadId: threadIdOf(batch.batchKey), url: threadUrl(batch.batchKey, batch.worldKey),
});

type Client = ReturnType<typeof getServerConvexClient>;

// A thread id (thr-xxxxxxxx, copied from the extension) stands for its batch label.
async function resolveThread(client: Client, ownerUserId: string, batch: string | undefined) {
  const value = batch?.trim();
  if (!value || !MJ_THREAD_ID.test(value.toLowerCase())) return batch;
  const { batches } = await client.query(api.mjQueue.listQueue, { ownerUserId });
  const found = batches.find((entry) => threadIdOf(entry.batchKey) === value.toLowerCase());
  if (!found) throw new Error(`No Midjourney queue thread ${value}. list_mj_queue shows each thread's threadId.`);
  return found.batch;
}

export async function POST(request: Request) {
  try {
    const body = z.record(z.string(), z.unknown()).parse(await request.json().catch(() => null));
    const action = z.enum(actions).parse(body.action);
    const agent = await requireAgentAuth(request, scopes[action]);
    const ownerUserId = agent.ownerUserId;
    const client = getServerConvexClient(ownerUserId);

    if (action === "list") {
      const input = mjQueueListSchema.parse(body);
      const batch = await resolveThread(client, ownerUserId, input.batch);
      const result = await client.query(api.mjQueue.listQueue, { ownerUserId, ...input, batch });
      return NextResponse.json({
        ...result, batches: result.batches.map(withThreadId), count: result.items.length, items: result.items.map(withRef),
      });
    }
    if (action === "queue") {
      const input = mjQueueAddSchema.parse(body);
      const createdBy = `agent:${agent.label || agent.tokenPrefix}`.slice(0, 80);
      const batch = (await resolveThread(client, ownerUserId, input.batch)) ?? input.batch;
      const result = await client.mutation(api.mjQueue.queueItems, { ownerUserId, createdBy, ...input, batch });
      return NextResponse.json({
        ...result,
        threadId: threadIdOf(batch),
        url: threadUrl(result.batchKey, result.worldKey),
        created: result.items.filter((item) => item.created).length,
        items: result.items.map(withRef),
      });
    }
    const input = mjQueueUpdateSchema.parse(body);
    const item = await client.mutation(api.mjQueue.updateItem, { ownerUserId, ...input });
    return NextResponse.json({ item: withRef(item) });
  } catch (error) {
    if (error instanceof AgentAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: clientErrorMessage(error, "Midjourney queue request failed.") }, { status: 400 });
  }
}
