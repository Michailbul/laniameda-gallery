import { makeFunctionReference } from "convex/server";
import { z } from "zod";
import { getServerConvexClient } from "@/lib/server/convex";
import { resolveExtensionOwnerUserId, validateExtensionToken } from "@/lib/server/extension-auth";
import { clientErrorMessage } from "@/lib/server/route-error";

// The extension's Recent lists, shared by every browser it runs in:
//   GET  ?kind=grow|describe                → { rows: [{ key, at, rev, entry }] }
//   POST { kind, rows: [{ key, at, entry, baseRev? }] } → { rows: [{ key, rev, stale, entry?, at? }] }
const list = makeFunctionReference<"query">("extensionHistory:list");
const put = makeFunctionReference<"mutation">("extensionHistory:put");
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Token", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const kind = z.enum(["grow", "describe"]);
const body = z.object({
  kind,
  rows: z.array(z.object({ key: z.string().min(1).max(2000), at: z.number().finite(), entry: z.string().max(200_000), baseRev: z.number().finite().optional() })).max(60),
});

export async function GET(request: Request) {
  if (!validateExtensionToken(request)) return json({ error: "Unauthorized extension request." }, 401);
  try {
    const which = kind.parse(new URL(request.url).searchParams.get("kind"));
    const ownerUserId = resolveExtensionOwnerUserId();
    return json({ ok: true, rows: await getServerConvexClient(ownerUserId).query(list, { ownerUserId, kind: which }) });
  } catch (error) { return json({ error: clientErrorMessage(error, "Could not read the history.") }, 400); }
}

export async function POST(request: Request) {
  if (!validateExtensionToken(request)) return json({ error: "Unauthorized extension request." }, 401);
  try {
    const input = body.parse(await request.json());
    const ownerUserId = resolveExtensionOwnerUserId();
    return json({ ok: true, rows: await getServerConvexClient(ownerUserId).mutation(put, { ownerUserId, ...input }) });
  } catch (error) { return json({ error: clientErrorMessage(error, "Could not save the history.") }, 400); }
}

export function OPTIONS() { return new Response(null, { status: 204, headers }); }
