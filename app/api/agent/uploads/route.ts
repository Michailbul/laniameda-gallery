import { NextResponse } from "next/server";
import { requireAgentAuth, AgentAuthError } from "@/lib/server/agent-auth";
import { MAX_UPLOADS_PER_REQUEST, prepareUploads } from "@/lib/server/agent-uploads";

// Reserve direct-to-R2 upload slots. See lib/server/agent-uploads.ts.
export async function POST(request: Request) {
  try {
    const agent = await requireAgentAuth(request, "gallery:write");
    const data = (await request.json().catch(() => ({}))) as { count?: unknown };
    const count = typeof data.count === "number" ? data.count : 1;
    if (count > MAX_UPLOADS_PER_REQUEST) {
      return NextResponse.json(
        { error: `At most ${MAX_UPLOADS_PER_REQUEST} uploads per request.` },
        { status: 400 },
      );
    }
    const uploads = await prepareUploads(agent.ownerUserId, count);
    return NextResponse.json({ ok: true, uploads });
  } catch (error) {
    if (error instanceof AgentAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
