import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { AgentAuthError, requireAgentAuth } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { clientErrorMessage } from "@/lib/server/route-error";
import { gallerySkillAuthError, gallerySkillOwnerDenial, privateSkillHeaders } from "@/lib/server/gallery-skill-auth";
import { GALLERY_SKILL_RESOURCES, gallerySkillResourceResponse } from "@/lib/server/gallery-skill-resources";
import { galleryInstructionSource } from "@/lib/server/gallery-private-instructions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The owner-data resources (references/worlds.md, references/maintenance.md)
// live in Convex agentInstructions, not in the repository. Reading goes through
// the same allowlist as the public skill files; writing is the owner's alone,
// takes the last-read sha256 and keeps the deployed skill version unless told
// otherwise. The MCP tool update_skill_instructions is the one caller.
const OWNER_RESOURCES = GALLERY_SKILL_RESOURCES.filter((entry) => entry.access === "owner").map((entry) => entry.path) as [string, ...string[]];

const readSchema = z.object({
  action: z.literal("read").optional(),
  resource: z.string().min(1).max(160).default("SKILL.md"),
});

const writeSchema = z.object({
  action: z.literal("write"),
  resource: z.enum(OWNER_RESOURCES),
  content: z.string().min(1).max(200_000),
  expectedSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  version: z.string().trim().min(1).max(40).optional(),
});

const skillVersion = async (ownerUserId: string) =>
  /^version:\s*([^\r\n]+)$/m.exec(await galleryInstructionSource(ownerUserId)("SKILL.md"))?.[1]?.trim() ?? "unversioned";

export async function POST(request: Request) {
  try {
    const body = z.record(z.string(), z.unknown()).parse(await request.json());

    if (body.action === "write") {
      const auth = await requireAgentAuth(request, "gallery:write");
      const denied = gallerySkillOwnerDenial(auth.ownerUserId);
      if (denied) return denied;
      const input = writeSchema.parse(body);
      const version = input.version ?? await skillVersion(auth.ownerUserId);
      const result = await getServerConvexClient(auth.ownerUserId).mutation(api.agentInstructions.saveResource, {
        ownerUserId: auth.ownerUserId, resourcePath: input.resource, content: input.content, version, expectedSha256: input.expectedSha256,
      });
      return Response.json({
        ok: true, resource: input.resource, version, sha256: result.sha256, created: result.created,
        changed: result.created || result.sha256 !== input.expectedSha256, chars: input.content.length,
      }, { headers: privateSkillHeaders });
    }

    const auth = await requireAgentAuth(request, "gallery:read");
    const input = readSchema.parse(body);
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
    if (error instanceof z.ZodError) {
      return Response.json({ error: `Invalid instruction request: ${z.prettifyError(error)}` }, { status: 400, headers: privateSkillHeaders });
    }
    if (error instanceof SyntaxError) {
      return Response.json({ error: "Invalid instruction resource request." }, { status: 400, headers: privateSkillHeaders });
    }
    const message = clientErrorMessage(error, "Gallery skill source is unavailable.");
    // A stale sha256 is the one failure the caller fixes by reading again.
    const status = /Instructions changed/.test(message) ? 409 : message === "Gallery skill source is unavailable." ? 503 : 400;
    return Response.json({ error: message }, { status, headers: privateSkillHeaders });
  }
}
