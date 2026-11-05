import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { requireAgentAuth, AgentAuthError } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { clientErrorMessage } from "@/lib/server/route-error";

// Cached complete inventory (convex/inventoryExport.ts). "status" returns the
// snapshot's metadata plus assets saved since it was built, rebuilding it when
// it is older than maxAgeMinutes (default 24 h) or on refresh. "part" streams
// one JSON part of that snapshot; the R2 location never leaves the server.
export const maxDuration = 300;

const input = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("status"),
    refresh: z.boolean().optional(),
    maxAgeMinutes: z.number().int().min(1).max(7 * 24 * 60).optional(),
  }).strict(),
  z.object({
    action: z.literal("part"),
    generatedAt: z.number().int().positive(),
    index: z.number().int().min(0),
  }).strict(),
]);

const PRIVATE = { "cache-control": "private, no-store" };

export async function POST(request: Request) {
  try {
    const agent = await requireAgentAuth(request, "gallery:read");
    const parsed = input.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Supply action status (refresh, maxAgeMinutes) or part (generatedAt, index)." }, { status: 400 });
    }
    const client = getServerConvexClient(agent.ownerUserId);
    if (parsed.data.action === "status") {
      const { action: _action, ...options } = parsed.data;
      const status = await client.action(api.inventoryExport.getInventoryExport, {
        ownerUserId: agent.ownerUserId, ...options,
      });
      return NextResponse.json(status, { headers: PRIVATE });
    }
    let part: { url: string };
    try {
      part = await client.action(api.inventoryExport.getInventoryExportPartUrl, {
        ownerUserId: agent.ownerUserId, generatedAt: parsed.data.generatedAt, index: parsed.data.index,
      });
    } catch (error) {
      // A rebuilt snapshot: the caller restarts from status so parts never mix builds.
      return NextResponse.json({ error: clientErrorMessage(error, "Inventory part unavailable.") }, { status: 409, headers: PRIVATE });
    }
    const object = await fetch(part.url, { signal: AbortSignal.timeout(60_000) });
    if (!object.ok || !object.body) {
      return NextResponse.json({ error: `Inventory part could not be read (${object.status}).` }, { status: 502, headers: PRIVATE });
    }
    return new Response(object.body, { headers: { ...PRIVATE, "content-type": "application/json" } });
  } catch (error) {
    if (error instanceof AgentAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: clientErrorMessage(error, "Inventory request failed.") }, { status: 400, headers: PRIVATE });
  }
}
