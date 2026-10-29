import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { requireAgentAuth, AgentAuthError, type AgentTokenScope } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { clientErrorMessage } from "@/lib/server/route-error";
import { newspaperCompileSchema, newspaperGetSchema, newspaperWriteSchema, presentNewspaper } from "@/lib/newspaper-contract";
import { agentActor } from "@/lib/tasks";

// The morning newspaper for agents: read an edition's facts (get), add the
// narrative (write), or compile today's edition now (compile). The daily cron
// compiles by itself; the prose is the agent's part.
const actions = ["get", "write", "compile"] as const;
const scopes: Record<(typeof actions)[number], AgentTokenScope> = {
  get: "gallery:read",
  write: "gallery:write",
  compile: "gallery:write",
};

export async function POST(request: Request) {
  try {
    const body = z.record(z.string(), z.unknown()).parse(await request.json().catch(() => null));
    const action = z.enum(actions).parse(body.action);
    const agent = await requireAgentAuth(request, scopes[action]);
    const ownerUserId = agent.ownerUserId;
    const client = getServerConvexClient(ownerUserId);
    const actor = agentActor(agent.label || agent.tokenPrefix);

    if (action === "get") {
      const input = newspaperGetSchema.parse(body);
      const paper = await client.query(api.newspaper.getNewspaper, { ownerUserId, date: input.date });
      if (!paper) {
        return NextResponse.json({
          newspaper: null,
          next: input.date ? `No edition for ${input.date}. compile_newspaper {date} compiles it from the gallery's tables.` : "No edition compiled yet. compile_newspaper compiles today's.",
        });
      }
      return NextResponse.json({
        newspaper: presentNewspaper(paper),
        next: paper.prose
          ? "The prose is written; write_newspaper replaces it."
          : "Read the facts, then write_newspaper {date, prose}: what mattered since yesterday, what you propose, at most three questions for Michael, naming asset:/task:/stack: ids.",
      });
    }
    if (action === "write") {
      const input = newspaperWriteSchema.parse(body);
      const paper = await client.mutation(api.newspaper.writeNewspaper, { ownerUserId, date: input.date, prose: input.prose, writtenBy: actor });
      return NextResponse.json({ ok: true, newspaper: presentNewspaper(paper) });
    }
    const input = newspaperCompileSchema.parse(body);
    const paper = await client.mutation(api.newspaper.compile, { ownerUserId, date: input.date, compiledBy: actor });
    return NextResponse.json({ ok: true, newspaper: presentNewspaper(paper), next: "write_newspaper {date, prose} adds the narrative." });
  } catch (error) {
    if (error instanceof AgentAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: z.prettifyError(error) }, { status: 400 });
    return NextResponse.json({ error: clientErrorMessage(error, "Newspaper request failed.") }, { status: 400 });
  }
}
