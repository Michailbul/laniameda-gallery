import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";
import { requireAgentAuth, AgentAuthError } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";

const deleteAction = makeFunctionReference<"action">("ingest:deleteFromApi");

const readJson = async (request: Request) => {
  try {
    const data = await request.json();
    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

export async function POST(request: Request) {
  try {
    const agent = await requireAgentAuth(request, "gallery:delete");
    const data = await readJson(request);
    if (!data) {
      return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
    }

    const { ownerUserId: _ignoredOwnerUserId, ...rest } = data;
    const client = getServerConvexClient();
    const result = await client.action(deleteAction, {
      ...rest,
      ownerUserId: agent.ownerUserId,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof AgentAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
