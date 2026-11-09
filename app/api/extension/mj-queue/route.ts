import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getServerConvexClient } from "@/lib/server/convex";
import { resolveExtensionOwnerUserId, validateExtensionToken } from "@/lib/server/extension-auth";
import { clientErrorMessage } from "@/lib/server/route-error";
import { mjQueueAddSchema, mjQueueListSchema, mjQueueUpdateSchema } from "@/lib/mj-queue-contract";

// The extension's MJ Queue tab (side panel): GET reads the batches and
// their prompts with the composed commands; POST saves an edit, a skip, a
// reorder or the record of a send Michael made himself, or (action "queue")
// adds the describer's prompt as a new item.

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
    });
    const result = await getServerConvexClient(ownerUserId).query(api.mjQueue.listQueue, { ownerUserId, ...input });
    return corsJson({ ok: true, ...result });
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
    if (body && typeof body === "object" && (body as { action?: unknown }).action === "queue") {
      const { action: _action, ...rest } = body as Record<string, unknown>;
      void _action;
      const add = mjQueueAddSchema.parse(rest);
      const result = await getServerConvexClient(ownerUserId).mutation(api.mjQueue.queueItems, { ownerUserId, createdBy: "extension describer", ...add });
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
