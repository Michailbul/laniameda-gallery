import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { requireAgentAuth, AgentAuthError, type AgentTokenScope } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { clientErrorMessage } from "@/lib/server/route-error";
import { mjQueueAddSchema, mjQueueItemRef, mjQueueListSchema, mjQueueUpdateSchema } from "@/lib/mj-queue-contract";

// Midjourney prompt queue for agents: queue prompts with every reference set,
// read the queue back with the composed commands, edit, reorder or skip.
// Sending stays Michael's own click in the extension's Queue panel.

const actions = ["list", "queue", "update"] as const;
const scopes: Record<(typeof actions)[number], AgentTokenScope> = {
  list: "gallery:read", queue: "gallery:write", update: "gallery:write",
};

const withRef = <T extends { id: string }>(row: T) => ({ ...row, ref: mjQueueItemRef(row.id) });

export async function POST(request: Request) {
  try {
    const body = z.record(z.string(), z.unknown()).parse(await request.json().catch(() => null));
    const action = z.enum(actions).parse(body.action);
    const agent = await requireAgentAuth(request, scopes[action]);
    const ownerUserId = agent.ownerUserId;
    const client = getServerConvexClient(ownerUserId);

    if (action === "list") {
      const input = mjQueueListSchema.parse(body);
      const result = await client.query(api.mjQueue.listQueue, { ownerUserId, ...input });
      return NextResponse.json({ ...result, count: result.items.length, items: result.items.map(withRef) });
    }
    if (action === "queue") {
      const input = mjQueueAddSchema.parse(body);
      const createdBy = `agent:${agent.label || agent.tokenPrefix}`.slice(0, 80);
      const result = await client.mutation(api.mjQueue.queueItems, { ownerUserId, createdBy, ...input });
      return NextResponse.json({
        ...result,
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
