import { z } from "zod";
import { AgentAuthError, requireAgentAuth } from "@/lib/server/agent-auth";
import { gallerySkillAuthError, gallerySkillOwnerDenial, privateSkillHeaders } from "@/lib/server/gallery-skill-auth";
import { gallerySkillResourceResponse } from "@/lib/server/gallery-skill-resources";
import { galleryInstructionSource } from "@/lib/server/gallery-private-instructions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({ resource: z.string().min(1).max(160).default("SKILL.md") });

export async function POST(request: Request) {
  try {
    const auth = await requireAgentAuth(request, "gallery:read");
    const input = inputSchema.parse(await request.json());
    const headers = new Headers(request.headers);
    // MCP calls need the actual instructions, even if a client sends an ETag.
    headers.delete("if-none-match");
    const response = await gallerySkillResourceResponse(new Request(request.url, { headers }), input.resource.split("/"), {
      authorizeOwner: async () => gallerySkillOwnerDenial(auth.ownerUserId),
      readSource: galleryInstructionSource(auth.ownerUserId),
    });
    if (!response.ok) return response;
    return Response.json({
      resource: input.resource,
      version: response.headers.get("x-gallery-skill-version"),
      sha256: response.headers.get("x-gallery-resource-sha256"),
      contentType: response.headers.get("content-type"),
      content: await response.text(),
    }, { headers: privateSkillHeaders });
  } catch (error) {
    if (error instanceof AgentAuthError) return gallerySkillAuthError(error);
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json({ error: "Invalid instruction resource request." }, { status: 400, headers: privateSkillHeaders });
    }
    return Response.json({ error: "Gallery skill source is unavailable." }, { status: 503, headers: privateSkillHeaders });
  }
}
