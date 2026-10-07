import { z } from "zod";
import { makeFunctionReference } from "convex/server";
import { AgentAuthError, requireAgentAuth } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { resolveUploadedPoster } from "@/lib/server/agent-uploads";

const setPoster = makeFunctionReference<"action">("thumbnails:setVideoPosterFromApi");
const getAsset = makeFunctionReference<"query">("assets:getAsset");
const inputSchema = z.object({ assetId: z.string().min(1), posterUploadId: z.string().min(1) });

export async function POST(request: Request) {
  try {
    const auth = await requireAgentAuth(request, "gallery:write");
    const input = inputSchema.parse(await request.json());
    const assetId = input.assetId.replace(/^asset:/, "");
    const client = getServerConvexClient(auth.ownerUserId);
    const asset = await client.query(getAsset, { ownerUserId: auth.ownerUserId, id: assetId });
    if (!asset || asset.kind !== "video") return Response.json({ error: "An owned video asset is required." }, { status: 400 });
    const poster = await resolveUploadedPoster(auth.ownerUserId, input.posterUploadId);
    await client.action(setPoster, { ownerUserId: auth.ownerUserId, assetId, posterBase64: poster.base64 });
    return Response.json({ ok: true, assetId, posterOnly: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AgentAuthError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: error instanceof Error ? error.message : "Invalid poster request." }, { status: 400 });
  }
}
