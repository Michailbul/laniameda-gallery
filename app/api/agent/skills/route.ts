import { NextResponse } from "next/server";
import { z } from "zod";
import { AgentAuthError, requireAgentAuth } from "@/lib/server/agent-auth";
import { createSkillForAgent, resolveSkillForOwner } from "@/lib/server/agent-skills";
import { createSkillInputSchema } from "@/lib/skill-contract";
import { makeFunctionReference } from "convex/server";
import { getServerConvexClient } from "@/lib/server/convex";

const deleteSkillMutation = makeFunctionReference<"mutation">("skills:deleteSkill");
const getSkillQuery = makeFunctionReference<"query">("skills:getSkill");

export async function POST(request: Request) {
  try {
    const body = z.record(z.string(), z.unknown()).parse(await request.json());
    const { action, ...data } = body;
    z.enum(["create", "delete"]).parse(action);
    const agent = await requireAgentAuth(request, action === "delete" ? "gallery:delete" : "gallery:write");
    if (action === "delete") {
      const { id } = z.object({ id: z.string().trim().min(1) }).strict().parse(data);
      const client = getServerConvexClient(agent.ownerUserId);
      const rawId = await resolveSkillForOwner(client, agent.ownerUserId, id);
      if (!rawId) return NextResponse.json({ error: "Skill not found." }, { status: 404 });
      await client.mutation(deleteSkillMutation, { ownerUserId: agent.ownerUserId, id: rawId });
      const skill = await client.query(getSkillQuery, { ownerUserId: agent.ownerUserId, id: rawId });
      if (skill) throw new Error("The Skill deletion could not be verified.");
      return NextResponse.json({ ok: true, id: `skill:${rawId}`, removed: true, mediaPreserved: true });
    }
    return NextResponse.json(await createSkillForAgent(agent, createSkillInputSchema.parse(data)));
  } catch (error) {
    if (error instanceof AgentAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error && typeof error === "object" && "data" in error && error.data && typeof error.data === "object" && "partial" in error.data) {
      return NextResponse.json({ ok: false, ...error.data }, { status: 207 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid Skill request." }, { status: 400 });
  }
}
