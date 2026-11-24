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
]);
export async function GET(request: Request) {
  if (!validateExtensionToken(request)) return json({ error: "Unauthorized extension request." }, 401);
  try {
    const ownerUserId = resolveExtensionOwnerUserId(); const client = getServerConvexClient(ownerUserId);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return json({ ok: true, threads: await client.query(list, { ownerUserId }) });
    if (new URL(request.url).searchParams.has("head")) return json({ ok: true, ...await client.query(makeFunctionReference<"query">("mjImageEdits:head"), { ownerUserId, id }) });
    const thread = await client.query(read, { ownerUserId, id });
    const ids: string[] = thread.runIds;
    const pages = await Promise.all(Array.from({ length: Math.ceil(ids.length / 30) }, (_, i) => client.query(runs, { ownerUserId, ids: ids.slice(i * 30, i * 30 + 30) })));
    return json({ ok: true, thread, runs: pages.flat().reverse() });
  } catch (error) { return json({ error: clientErrorMessage(error, "Could not read the edit thread.") }, 400); }
}
export async function POST(request: Request) {
  if (!validateExtensionToken(request)) return json({ error: "Unauthorized extension request." }, 401);
  try {
    const ownerUserId = resolveExtensionOwnerUserId(); const client = getServerConvexClient(ownerUserId);
    const { action, ...args } = input.parse(await request.json());
    const thread = await client.mutation(action === "create" ? create : update, { ownerUserId, ...args });
    return json({ ok: true, thread });
  } catch (error) { return json({ error: clientErrorMessage(error, "Could not save the edit thread.") }, 400); }
}
export function OPTIONS() { return new Response(null, { status: 204, headers }); }
