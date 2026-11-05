import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireAgentAuth, AgentAuthError } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { clientErrorMessage } from "@/lib/server/route-error";

const common = { folderId: z.string().min(1) };
const srefSaveInput = z.object({
  ...common, parameters: z.string().min(1).max(2000), title: z.string().max(200).optional(),
  note: z.string().max(2000).optional(), sourceUrl: z.url().optional(),
});
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), ...common, search: z.string().optional() }),
  srefSaveInput.extend({ action: z.literal("save") }),
]);

export async function POST(request: Request) {
  try {
    const parsed = input.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Supply action list/save, a collection folderId, and valid sref fields." }, { status: 400 });
    const { action, folderId, ...fields } = parsed.data;
    const agent = await requireAgentAuth(request, action === "list" ? "gallery:read" : "gallery:write");
    const client = getServerConvexClient(agent.ownerUserId);
    const args = { ownerUserId: agent.ownerUserId, folderId: folderId as Id<"folders"> };
    if (action === "list") {
      const srefs = await client.query(api.midjourneySrefs.list, { ...args, search: "search" in fields ? fields.search : undefined });
      return NextResponse.json({ count: srefs.length, srefs });
    }
    const saved = await client.mutation(api.midjourneySrefs.save, { ...args, ...srefSaveInput.omit({ folderId: true }).parse(fields) });
    return NextResponse.json({ ...saved, id: `prompt:${saved.promptId}` });
  } catch (error) {
    if (error instanceof AgentAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: clientErrorMessage(error, "Sref request failed.") }, { status: 400 });
  }
}
