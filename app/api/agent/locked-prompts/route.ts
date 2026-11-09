import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { AgentAuthError, requireAgentAuth, type AgentTokenScope } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { clientErrorMessage } from "@/lib/server/route-error";
import { GALLERY_ORIGIN } from "@/lib/gallery-routes";
import { lockedGetSchema, lockedListSchema, lockedRestyleSchema, lockedResultsSchema, lockedSaveSchema } from "@/lib/locked-prompt-contract";

// Locked location prompts for agents: list, read with revisions and takes,
// save (versioned), restyle into world styles as one MJ Queue thread, and file
// the frames that came back. Michael sends every queued job himself; nothing
// here submits to Midjourney. Art-director scope: never reaches the review.

const actions = ["list", "get", "save", "restyle", "results"] as const;
const scopeFor = (action: (typeof actions)[number], body: Record<string, unknown>): AgentTokenScope =>
  action === "list" || action === "get" || (action === "restyle" && body.dryRun === true) ? "gallery:read" : "gallery:write";
const queueUrl = (worldKey: string, threadId: string) => `${GALLERY_ORIGIN}/w/${worldKey}/queue?thread=${threadId}`;

export async function POST(request: Request) {
  try {
    const body = z.record(z.string(), z.unknown()).parse(await request.json().catch(() => null));
    const action = z.enum(actions).parse(body.action);
    const agent = await requireAgentAuth(request, scopeFor(action, body));
    const ownerUserId = agent.ownerUserId;
    const client = getServerConvexClient(ownerUserId);
    const actor = `agent:${agent.label || agent.tokenPrefix}`.slice(0, 80);
    const card = <T extends { id: string }>(row: T) => ({ ...row, id: `lp:${row.id}` });

    if (action === "list") {
      const input = lockedListSchema.parse(body);
      const result = await client.query(api.lockedPrompts.listLockedPrompts, { ownerUserId, ...input });
      return NextResponse.json({ world: result.world.key, count: result.prompts.length, prompts: result.prompts.map(card), projectUrl: `${GALLERY_ORIGIN}/w/${result.world.key}/project` });
    }
    if (action === "get") {
      const input = lockedGetSchema.parse(body);
      const result = await client.query(api.lockedPrompts.getLockedPrompt, { ownerUserId, prompt: input.prompt });
      return NextResponse.json({ ...result, prompt: card(result.prompt) });
    }
    if (action === "save") {
      const input = lockedSaveSchema.parse(body);
      const result = await client.mutation(api.lockedPrompts.saveLockedPrompt, { ownerUserId, ...input, actor });
      return NextResponse.json({ ...result, promptId: `lp:${result.promptId}` });
    }
    if (action === "restyle") {
      const input = lockedRestyleSchema.parse(body);
      const result = await client.mutation(api.lockedPrompts.restyleLockedPrompts, { ownerUserId, ...input, createdBy: actor });
      return NextResponse.json({
        ...result, url: queueUrl(result.worldKey, result.threadId),
        next: result.dryRun ? "Nothing was written. Call again without dryRun to queue." : "Queued for Michael: he sends each job himself from the MJ Queue panel, one per click. After he sends and saves frames, call file_restyle_results.",
      });
    }
    const input = lockedResultsSchema.parse(body);
    return NextResponse.json(await client.mutation(api.lockedPrompts.fileRestyleResults, { ownerUserId, ...input }));
  } catch (error) {
    if (error instanceof AgentAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") }, { status: 400 });
    return NextResponse.json({ error: clientErrorMessage(error, "Could not do that.") }, { status: 400 });
  }
}
