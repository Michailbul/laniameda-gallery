import { makeFunctionReference } from "convex/server";
import { z } from "zod";
import { requireAgentReader, requireAgentAuth } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { clientErrorMessage } from "@/lib/server/route-error";

export async function POST(request: Request) {
  try {
    const body = z.object({ action: z.enum(["list", "read", "reply"]), id: z.string().max(80).optional(),
      text: z.string().min(1).max(6000).optional(), prompt: z.string().max(2000).optional(), key: z.string().min(1).max(80).optional() }).parse(await request.json());
    const auth = body.action === "reply" ? await requireAgentAuth(request, "gallery:write") : await requireAgentReader(request);
    if (!auth.scopes.includes("gallery:read") && body.action !== "reply") return Response.json({ error: "Owner reading access required." }, { status: 403 });
    const ownerUserId = auth.ownerUserId; const client = getServerConvexClient(ownerUserId);
    if (body.action === "list") return Response.json({ threads: await client.query(makeFunctionReference<"query">("mjImageEdits:list"), { ownerUserId }) });
    if (!body.id) throw new Error("Choose an edit thread.");
    if (body.action === "reply") {
      if (!body.text || !body.key) throw new Error("A reply needs text and a stable retry key.");
      return Response.json({ thread: await client.mutation(makeFunctionReference<"mutation">("mjImageEdits:update"), { ownerUserId, id: body.id,
        ...(body.prompt !== undefined ? { draft: body.prompt } : {}), message: { id: `agent:${body.key}`, role: "agent", text: body.text, ...(body.prompt !== undefined ? { prompt: body.prompt } : {}) } }) });
    }
    const thread = await client.query(makeFunctionReference<"query">("mjImageEdits:read"), { ownerUserId, id: body.id });
    const ids: string[] = thread.runIds;
    const pages = await Promise.all(Array.from({ length: Math.ceil(ids.length / 30) }, (_, i) => client.query(makeFunctionReference<"query">("mjQuickRuns:getRuns"), { ownerUserId, ids: ids.slice(i * 30, i * 30 + 30) })));
    return Response.json({ thread, runs: pages.flat() });
  } catch (error) { return Response.json({ error: clientErrorMessage(error, "Could not read the edit conversation.") }, { status: 400 }); }
}
