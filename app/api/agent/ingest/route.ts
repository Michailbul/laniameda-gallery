import { NextResponse } from "next/server";
import { requireAgentAuth, AgentAuthError } from "@/lib/server/agent-auth";
import { ingestForAgent, PartialAgentSaveError } from "@/lib/server/agent-ingest";

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
    const agent = await requireAgentAuth(request, "gallery:write");
    const data = await readJson(request);
    if (!data) {
      return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
    }

    const { result, collections } = await ingestForAgent(agent, data);
    return NextResponse.json({ ok: true, result, collections });
  } catch (error) {
    if (error instanceof PartialAgentSaveError) return NextResponse.json(error.toResult(), { status: 207 });
    if (error instanceof AgentAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
