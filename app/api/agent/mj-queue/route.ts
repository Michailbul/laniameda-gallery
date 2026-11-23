import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { requireAgentAuth, AgentAuthError, type AgentTokenScope } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { clientErrorMessage } from "@/lib/server/route-error";
import {
  mjQueueAddSchema, mjQueueArchiveSchema, mjQueueItemRef, mjQueueListSchema, mjQueueUpdateSchema,
  mjThreadEditSchema, mjThreadMessageSchema, mjThreadReadSchema, mjThreadRerunSchema,
} from "@/lib/mj-queue-contract";
import { MJ_THREAD_ID, threadIdOf } from "@/lib/mj-queue";
import { mjQueueUrl } from "@/lib/gallery-routes";

// Midjourney prompt queue for agents: queue prompts with every reference set,
// read the queue back with the composed commands, edit, reorder or skip.
// Sending stays Michael's own click in the extension's Queue panel.

// thread: a thread's runs and chat; reply: an agent's answer in the chat;
// rerun: chosen prompts copied into the next run with a new recipe; edit: a
// recipe on the prompts still to send (23 Nov 2026).
const actions = ["list", "queue", "update", "archive", "thread", "reply", "rerun", "edit"] as const;
const scopes: Record<(typeof actions)[number], AgentTokenScope> = {
  list: "gallery:read", queue: "gallery:write", update: "gallery:write", archive: "gallery:write",
  thread: "gallery:read", reply: "gallery:write", rerun: "gallery:write", edit: "gallery:write",
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
  const [live, archived] = await Promise.all([
    client.query(api.mjQueue.listQueue, { ownerUserId }),
    client.query(api.mjQueue.listQueue, { ownerUserId, archived: true }),
  ]);
  const found = [...live.batches, ...archived.batches].find((entry) => threadIdOf(entry.batchKey) === value.toLowerCase());
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
    if (action === "archive") {
      const input = mjQueueArchiveSchema.parse(body);
      const result = await client.mutation(api.mjQueue.archiveThread, { ownerUserId, batch: input.batch, restore: input.restore });
      return NextResponse.json({ ...result, threadId: threadIdOf(result.batchKey) });
    }
    if (action === "thread") {
      const { batch } = mjThreadReadSchema.parse(body);
      const [state, list, look] = await Promise.all([
        client.query(api.mjThreads.threadState, { ownerUserId, batch }),
        client.query(api.mjQueue.listQueue, { ownerUserId, batch: await resolveThread(client, ownerUserId, batch) }),
        client.query(api.mjThreads.threadLook, { ownerUserId, batch }).catch(() => null),
      ]);
      return NextResponse.json({
        ...state, url: threadUrl(state.batchKey, state.worldKey),
        // The thread's codes by name (used: in its prompts) and the world's other moodboards and profiles.
        look: look?.codes ?? [],
        messages: state.messages.map((message) => ({ ...message, ref: `msg:${message.id}` })),
        items: list.items.filter((item) => item.batchKey === state.batchKey).map((item, index) => ({
          n: index + 1, ref: mjQueueItemRef(item.id), id: item.id, run: item.run ?? 1, status: item.status, title: item.title,
          prompt: item.prompt, profileCodes: item.profileCodes, params: item.params, command: item.command, jobId: item.jobId, sentAt: item.sentAt,
        })),
      });
    }
    if (action === "reply") {
      const input = mjThreadMessageSchema.parse(body);
      const author = `agent:${agent.label || agent.tokenPrefix}`.slice(0, 80);
      const message = await client.mutation(api.mjThreads.postMessage, {
        ownerUserId, batch: input.batch, role: "agent", author, text: input.text, changes: input.changes,
        run: input.run, replyTo: input.replyTo?.replace(/^msg:/, ""),
      });
      return NextResponse.json({ message: { ...message, ref: `msg:${message.id}` } });
    }
    if (action === "rerun") {
      const input = mjThreadRerunSchema.parse(body);
      const createdBy = `agent:${agent.label || agent.tokenPrefix} · rerun`.slice(0, 80);
      const result = await client.mutation(api.mjThreads.rerunThread, {
        ownerUserId, batch: input.batch, fromRun: input.fromRun, itemIds: input.items, recipe: input.recipe,
        prompts: input.prompts, note: input.note, createdBy,
      });
      return NextResponse.json({
        ...result, threadId: threadIdOf(result.batchKey), url: threadUrl(result.batchKey, result.items[0]?.worldKey),
        count: result.items.length, items: result.items.map(withRef),
      });
    }
    if (action === "edit") {
      const input = mjThreadEditSchema.parse(body);
      const result = await client.mutation(api.mjThreads.editThread, { ownerUserId, batch: input.batch, recipe: input.recipe, itemIds: input.items });
      return NextResponse.json({ ...result, threadId: threadIdOf(result.batchKey) });
    }
    const input = mjQueueUpdateSchema.parse(body);
    const item = await client.mutation(api.mjQueue.updateItem, { ownerUserId, ...input });
    return NextResponse.json({ item: withRef(item) });
  } catch (error) {
    if (error instanceof AgentAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: clientErrorMessage(error, "Midjourney queue request failed.") }, { status: 400 });
  }
}
