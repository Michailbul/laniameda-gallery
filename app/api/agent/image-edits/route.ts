import { makeFunctionReference } from "convex/server";
import { z } from "zod";
import { requireAgentReader, requireAgentAuth } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { clientErrorMessage } from "@/lib/server/route-error";
import { agentCapOf } from "@/lib/mj-image-edit-contract";
import { editTimeline, runNames } from "@/lib/mj-image-edit-chat";
import { runForAgent, threadRuns } from "@/lib/server/image-edit-run";

const read = makeFunctionReference<"query">("mjImageEdits:read");
const update = makeFunctionReference<"mutation">("mjImageEdits:update");

export async function POST(request: Request) {
  try {
    const body = z.object({ action: z.enum(["list", "read", "reply", "run"]), id: z.string().max(80).optional(),
      text: z.string().min(1).max(6000).optional(), prompt: z.string().max(2000).optional(), key: z.string().min(1).max(80).optional(),
      model: z.string().max(40).optional(), count: z.number().int().min(1).max(3).optional(), take: z.string().regex(/^r\d{1,3}t[1-3]$/).optional() }).parse(await request.json());
    const writes = body.action === "reply" || body.action === "run";
    const auth = writes ? await requireAgentAuth(request, "gallery:write") : await requireAgentReader(request);
    if (!auth.scopes.includes("gallery:read") && !writes) return Response.json({ error: "Owner reading access required." }, { status: 403 });
    const ownerUserId = auth.ownerUserId; const client = getServerConvexClient(ownerUserId);
    if (body.action === "list") return Response.json({ threads: await client.query(makeFunctionReference<"query">("mjImageEdits:list"), { ownerUserId }) });
    if (!body.id) throw new Error("Choose an edit thread.");
    if (body.action === "reply") {
      if (!body.text || !body.key) throw new Error("A reply needs text and a stable retry key.");
      return Response.json({ thread: await client.mutation(update, { ownerUserId, id: body.id,
        ...(body.prompt !== undefined ? { draft: body.prompt } : {}), message: { id: `agent:${body.key}`, role: "agent", text: body.text, ...(body.prompt !== undefined ? { prompt: body.prompt } : {}) } }) });
    }
    const thread = await client.query(read, { ownerUserId, id: body.id });
    const runs = await threadRuns(client, ownerUserId, thread.runIds);
    if (body.action === "run") {
      // An agent's edit, within the limit Michael set on the thread; the reply in
      // the conversation says what ran, so he sees it next to the takes.
      if (!body.prompt || !body.key || !body.text) throw new Error("A run needs the edit prompt, a line for Michael (text) and a stable retry key.");
      const take = body.take ? runNames(runs).resolve(body.take) : undefined;
      if (body.take && !take) throw new Error("That take is not in this thread.");
      const started = await runForAgent(client, ownerUserId, thread, runs, { prompt: body.prompt, model: body.model, count: body.count, take }, `agent:${body.key}`);
      const saved = await client.mutation(update, { ownerUserId, id: body.id, draft: body.prompt, message: { id: `agent:${body.key}`, role: "agent", text: body.text, prompt: body.prompt,
        actions: [{ type: "run", prompt: body.prompt, ...(body.model ? { model: body.model } : {}), ...(body.count ? { count: body.count } : {}), ...(take ? { take } : {}) }],
        ...("runId" in started ? { ran: started } : { skipped: started.skipped }) } });
      return Response.json({ ...started, limitUsd: agentCapOf(thread), thread: saved });
    }
    return Response.json({ thread, runs, timeline: editTimeline(thread.messages, runs), limitUsd: agentCapOf(thread),
      takeNames: runNames(runs).ordered.flatMap((run, i) => run.takes.map(t => ({ take: `r${i + 1}t${t.index + 1}`, runId: run._id, index: t.index, status: t.status, review: t.review, url: t.url }))) });
  } catch (error) { return Response.json({ error: clientErrorMessage(error, "Could not read the edit conversation.") }, { status: 400 }); }
}
