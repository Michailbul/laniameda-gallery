import { makeFunctionReference } from "convex/server";
import { z } from "zod";
import { getServerConvexClient } from "@/lib/server/convex";
import { resolveExtensionOwnerUserId, validateExtensionToken } from "@/lib/server/extension-auth";
import { clientErrorMessage } from "@/lib/server/route-error";
import { imageEditFrameSchema, imageEditUpdateSchema } from "@/lib/mj-image-edit-contract";

const read = makeFunctionReference<"query">("mjImageEdits:read");
const list = makeFunctionReference<"query">("mjImageEdits:list");
const create = makeFunctionReference<"mutation">("mjImageEdits:create");
const update = makeFunctionReference<"mutation">("mjImageEdits:update");
const runs = makeFunctionReference<"query">("mjQuickRuns:getRuns");
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Token", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), key: z.string().min(1).max(160), source: imageEditFrameSchema }),
  imageEditUpdateSchema.extend({ action: z.literal("update") }),
  z.object({ action: z.literal("remove"), id: z.string().min(1).max(80) }),
]);
const find = makeFunctionReference<"query">("mjImageEdits:find");
const remove = makeFunctionReference<"mutation">("mjImageEdits:remove");
const withRuns = async (client: ReturnType<typeof getServerConvexClient>, ownerUserId: string, ids: string[]) =>
  (await Promise.all(Array.from({ length: Math.ceil(ids.length / 30) }, (_, i) => client.query(runs, { ownerUserId, ids: ids.slice(i * 30, i * 30 + 30) })))).flat().reverse();
export async function GET(request: Request) {
  if (!validateExtensionToken(request)) return json({ error: "Unauthorized extension request." }, 401);
  try {
    const ownerUserId = resolveExtensionOwnerUserId(); const client = getServerConvexClient(ownerUserId);
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    const key = params.get("key");
    if (key && !id) {
      // The frame's own thread, or none yet (Run or Ask creates it).
      const found = await client.query(find, { ownerUserId, key: key.slice(0, 160) });
      return json({ ok: true, thread: found, runs: found ? await withRuns(client, ownerUserId, found.runIds) : [] });
    }
    if (!id) return json({ ok: true, threads: await client.query(list, { ownerUserId }) });
    if (new URL(request.url).searchParams.has("head")) return json({ ok: true, ...await client.query(makeFunctionReference<"query">("mjImageEdits:head"), { ownerUserId, id }) });
    const thread = await client.query(read, { ownerUserId, id });
    return json({ ok: true, thread, runs: await withRuns(client, ownerUserId, thread.runIds) });
  } catch (error) { return json({ error: clientErrorMessage(error, "Could not read the edit thread.") }, 400); }
}
export async function POST(request: Request) {
  if (!validateExtensionToken(request)) return json({ error: "Unauthorized extension request." }, 401);
  try {
    const ownerUserId = resolveExtensionOwnerUserId(); const client = getServerConvexClient(ownerUserId);
    const parsed = input.parse(await request.json());
    if (parsed.action === "remove") { await client.mutation(remove, { ownerUserId, id: parsed.id }); return json({ ok: true }); }
    const { action, ...args } = parsed;
    const thread = await client.mutation(action === "create" ? create : update, { ownerUserId, ...args });
    return json({ ok: true, thread });
  } catch (error) { return json({ error: clientErrorMessage(error, "Could not save the edit thread.") }, 400); }
}
export function OPTIONS() { return new Response(null, { status: 204, headers }); }
