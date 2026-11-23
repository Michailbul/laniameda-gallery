import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getServerConvexClient } from "@/lib/server/convex";
import { resolveExtensionOwnerUserId, validateExtensionToken } from "@/lib/server/extension-auth";
import { clientErrorMessage } from "@/lib/server/route-error";
import { etagJson } from "@/lib/server/etag-json";
import {
  mjQueueAddSchema, mjQueueDeleteThreadSchema, mjQueueForkSchema, mjQueueListSchema, mjQueueParamsSchema,
  mjQueueRequeueSchema, mjQueueUpdateSchema, mjThreadChatAskSchema, mjThreadEditSchema, mjThreadRerunSchema,
} from "@/lib/mj-queue-contract";

// The extension's MJ Queue tab (side panel): GET reads the batches and
// their prompts with the composed commands; POST saves an edit, a skip, a
// reorder or the record of a send Michael made himself, or (action "queue")
// adds the describer's prompt as a new item, or (action "requeue") queues
// sent prompts again as new copies, (action "fork") copies one prompt into a
// new Test or Random thread once per profile mix, (action "params") sets the
// params of many prompts still to send at once, and (action "deleteThread")
// deletes every prompt of a thread. A thread's own read (?batch=) also brings
// its runs and chat (thread); (action "rerun") copies prompts into the next
// run with a new recipe, (action "editThread") sets a recipe on the prompts
// still to send, (action "chat") puts Michael's message in the thread's chat
// for the writer (/api/extension/mj-thread-chat) or an agent to answer.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Token",
};

const corsJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: CORS_HEADERS });

export async function GET(request: Request) {
  try {
    if (!validateExtensionToken(request)) return corsJson({ error: "Unauthorized extension request." }, 401);
    const ownerUserId = resolveExtensionOwnerUserId();
    const params = new URL(request.url).searchParams;
    const input = mjQueueListSchema.parse({
      batch: params.get("batch") || undefined,
      world: params.get("world") || undefined,
      includeDone: params.get("includeDone") === "false" ? false : undefined,
      archived: params.get("archived") === "true" ? true : undefined,
    });
    const client = getServerConvexClient(ownerUserId);
    const [result, thread] = await Promise.all([
      client.query(api.mjQueue.listQueue, { ownerUserId, ...input }),
      // An older backend, or a thread that is gone, costs only the chat.
      input.batch && !input.archived
        ? client.query(api.mjThreads.threadState, { ownerUserId, batch: input.batch }).catch(() => null)
        : Promise.resolve(null),
    ]);
    return etagJson(request, { ok: true, ...result, ...(thread ? { thread } : {}) }, CORS_HEADERS);
  } catch (error) {
    return corsJson({ error: clientErrorMessage(error, "Could not load the Midjourney queue.") }, 400);
  }
}

export async function POST(request: Request) {
  try {
    if (!validateExtensionToken(request)) return corsJson({ error: "Unauthorized extension request." }, 401);
    const ownerUserId = resolveExtensionOwnerUserId();
    const body = await request.json().catch(() => null);
    // {action: "queue"} adds prompts (the describer's "Queue"); anything else is an update.
    const action = body && typeof body === "object" ? (body as { action?: unknown }).action : undefined;
    if (action === "queue") {
      const { action: _action, fresh, createdBy, ...rest } = body as Record<string, unknown>;
      void _action;
      const add = mjQueueAddSchema.parse(rest);
      const result = await getServerConvexClient(ownerUserId).mutation(api.mjQueue.queueItems, {
        ownerUserId,
        createdBy: typeof createdBy === "string" && createdBy.trim() ? createdBy.trim().slice(0, 80) : "extension describer",
        fresh: fresh === true ? true : undefined,
        ...add,
      });
      return corsJson({ ok: true, ...result });
    }
    if (action === "fork") {
      const input = mjQueueForkSchema.parse(body);
      const result = await getServerConvexClient(ownerUserId).mutation(api.mjQueue.forkItem, { ownerUserId, ...input });
      return corsJson({ ok: true, ...result });
    }
    if (action === "params") {
      const { items } = mjQueueParamsSchema.parse(body);
      const result = await getServerConvexClient(ownerUserId).mutation(api.mjQueue.setItemsParams, { ownerUserId, items });
      return corsJson({ ok: true, ...result });
    }
    // Delete in the panel archives the thread (20 Nov 2026): it leaves the
    // queue with its history kept, and the panel's Archive (or an agent) can
    // bring it back with {action: "restoreThread"}.
    if (action === "deleteThread" || action === "archiveThread" || action === "restoreThread") {
      const { batch } = mjQueueDeleteThreadSchema.parse(body);
      const restore = action === "restoreThread";
      const result = await getServerConvexClient(ownerUserId).mutation(api.mjQueue.archiveThread, { ownerUserId, batch, restore });
      return corsJson({ ok: true, ...result, deleted: restore ? 0 : result.changed, archived: !restore });
    }
    if (action === "rerun") {
      const input = mjThreadRerunSchema.parse(body);
      const result = await getServerConvexClient(ownerUserId).mutation(api.mjThreads.rerunThread, {
        ownerUserId, batch: input.batch, fromRun: input.fromRun, itemIds: input.items, recipe: input.recipe,
        prompts: input.prompts, note: input.note, createdBy: "extension · rerun",
      });
      return corsJson({ ok: true, ...result });
    }
    if (action === "editThread") {
      const input = mjThreadEditSchema.parse(body);
      const result = await getServerConvexClient(ownerUserId).mutation(api.mjThreads.editThread, {
        ownerUserId, batch: input.batch, recipe: input.recipe, itemIds: input.items,
      });
      return corsJson({ ok: true, ...result });
    }
    if (action === "chat") {
      const input = mjThreadChatAskSchema.parse(body);
      const message = await getServerConvexClient(ownerUserId).mutation(api.mjThreads.postMessage, {
        ownerUserId, batch: input.batch, role: "michael", author: "Michael", text: input.text,
      });
      return corsJson({ ok: true, message });
    }
    if (action === "chatFailed") {
      const { messageId, error } = body as { messageId?: unknown; error?: unknown };
      if (typeof messageId !== "string" || !messageId) throw new Error("messageId is required.");
      await getServerConvexClient(ownerUserId).mutation(api.mjThreads.markWriterFailed, {
        ownerUserId, messageId, error: typeof error === "string" ? error : "The writer failed.",
      });
      return corsJson({ ok: true });
    }
    // {action: "requeue", itemIds}: sent prompts queued again as new copies.
    if (action === "requeue") {
      const { itemIds } = mjQueueRequeueSchema.parse(body);
      const result = await getServerConvexClient(ownerUserId).mutation(api.mjQueue.requeueItems, { ownerUserId, itemIds });
      return corsJson({ ok: true, ...result });
    }
    const input = mjQueueUpdateSchema.parse(body);
    const item = await getServerConvexClient(ownerUserId).mutation(api.mjQueue.updateItem, { ownerUserId, ...input });
    return corsJson({ ok: true, item });
  } catch (error) {
    return corsJson({ error: clientErrorMessage(error, "Could not save the queued prompt.") }, 400);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
