import { makeFunctionReference } from "convex/server";
import { z } from "zod";
import { getServerConvexClient } from "@/lib/server/convex";
import { resolveExtensionOwnerUserId, validateExtensionToken } from "@/lib/server/extension-auth";
import { imageEditGallery } from "@/lib/server/image-edit-gallery";
import { clientErrorMessage } from "@/lib/server/route-error";
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Extension-Token", "Cache-Control": "no-store" };
export async function POST(request: Request) {
  if (!validateExtensionToken(request)) return Response.json({ error: "Unauthorized extension request." }, { status: 401, headers });
  try {
    const input = z.object({ id: z.string().max(80), name: z.string().max(100), arguments: z.record(z.string(), z.unknown()) }).parse(await request.json());
    const ownerUserId = resolveExtensionOwnerUserId();
    const thread = await getServerConvexClient(ownerUserId).query(makeFunctionReference<"query">("mjImageEdits:read"), { ownerUserId, id: input.id });
    if (!thread.galleryEnabled) return Response.json({ error: "Gallery access is off for this thread." }, { status: 403, headers });
    return Response.json({ ok: true, result: await imageEditGallery(request, { name: input.name, arguments: input.arguments }) }, { headers });
  } catch (error) { return Response.json({ error: clientErrorMessage(error, "Could not read the gallery.") }, { status: 400, headers }); }
}
export function OPTIONS() { return new Response(null, { status: 204, headers }); }
