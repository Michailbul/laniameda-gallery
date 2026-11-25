import { makeFunctionReference } from "convex/server";
import { getServerConvexClient } from "@/lib/server/convex";
import { resolveExtensionOwnerUserId, validateExtensionToken } from "@/lib/server/extension-auth";
import { clientErrorMessage } from "@/lib/server/route-error";
import { agentCapOf, imageEditDraftSchema } from "@/lib/mj-image-edit-contract";
import { imageEditGallery } from "@/lib/server/image-edit-gallery";
import { resolveActions, runForAgent, threadRuns } from "@/lib/server/image-edit-run";

const read = makeFunctionReference<"query">("mjImageEdits:read");
const update = makeFunctionReference<"mutation">("mjImageEdits:update");
const answer = makeFunctionReference<"action">("mjImageEditWriter:answer");
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Token", "Cache-Control": "no-store" };
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!validateExtensionToken(request)) return Response.json({ error: "Unauthorized extension request." }, { status: 401, headers });
  try {
    const input = imageEditDraftSchema.parse(await request.json());
    const ownerUserId = resolveExtensionOwnerUserId(); const client = getServerConvexClient(ownerUserId);
    const thread = await client.query(read, { ownerUserId, id: input.id });
    if (thread.world && !thread.galleryEnabled) throw new Error("Enable Gallery access so the agent can read this world's style lock.");
    const message = thread.messages.find((m: { id: string; role: string }) => m.id === input.messageId && m.role === "michael");
    if (!message) throw new Error("Save your message before asking the writer.");
    const prior = thread.messages.find((m: { id: string }) => m.id === `${input.messageId}:answer`);
    if (prior) return Response.json({ ok: true, ...prior, thread }, { headers });
    const runs = await threadRuns(client, ownerUserId, thread.runIds);
    const tools = thread.galleryEnabled ? await imageEditGallery(request) : [];
    const result = await client.action(answer, { ownerUserId, context: { ...thread, runs, agentLimitUsd: agentCapOf(thread) }, tools,
      results: thread.galleryEnabled ? input.results : [], model: input.model, provider: input.provider, rules: input.rules, local: input.local });
    if (result.tools?.length && !thread.galleryEnabled) throw new Error("Gallery access is off. Enable it to read the gallery.");
    if (!result.local && !result.tools?.length) {
      const actions = resolveActions(result.actions || [], runs);
      // One run per answer starts by itself when it fits the limit; the rest wait for a click.
      const firstRun = actions.find(a => a.type === "run");
      const started = firstRun?.type === "run"
        ? await runForAgent(client, ownerUserId, thread, runs, firstRun, `agent:${input.messageId.slice(0, 90)}`) : undefined;
      const saved = await client.mutation(update, { ownerUserId, id: input.id, ...(result.prompt !== undefined ? { draft: result.prompt } : {}),
        message: { id: `${input.messageId}:answer`, role: "agent", text: result.reply, ...(result.prompt ? { prompt: result.prompt } : {}),
          reads: input.results.map(r => r.name), ...(actions.length ? { actions } : {}),
          ...(started && "runId" in started ? { ran: started } : {}), ...(started && "skipped" in started ? { skipped: started.skipped } : {}) } });
      return Response.json({ ok: true, ...result, actions, thread: saved, ...(started && "runId" in started ? { ran: started } : {}) }, { headers });
    }
    return Response.json({ ok: true, ...result }, { headers });
  } catch (error) { return Response.json({ error: clientErrorMessage(error, "The edit writer could not answer.") }, { status: 400, headers }); }
}
export function OPTIONS() { return new Response(null, { status: 204, headers }); }
