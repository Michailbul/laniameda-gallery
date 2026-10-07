import { AgentAuthError, requireAgentAuth } from "@/lib/server/agent-auth";
import { isMcpAllowedUser } from "@/lib/server/mcp-oauth";
import { isGallerySkillOwner } from "@/lib/server/gallery-skill-resources";

export const privateSkillHeaders = { "Cache-Control": "private, no-store", Vary: "Authorization" };

export const gallerySkillOwnerDenial = (ownerUserId: string): Response | null =>
  isMcpAllowedUser(ownerUserId) && isGallerySkillOwner(ownerUserId, process.env.KB_OWNER_USER_ID)
    ? null
    : Response.json({ error: "This gallery's world and maintenance instructions are private." }, { status: 403, headers: privateSkillHeaders });

export const gallerySkillAuthError = (error: AgentAuthError) =>
  Response.json({ error: error.message }, {
    status: error.status,
    headers: { ...privateSkillHeaders, "WWW-Authenticate": 'Bearer realm="laniameda-gallery", scope="gallery:read"' },
  });

export async function authorizeGallerySkillOwner(request: Request): Promise<Response | null> {
  try {
    const auth = await requireAgentAuth(request, "gallery:read");
    return gallerySkillOwnerDenial(auth.ownerUserId);
  } catch (error) {
    if (error instanceof AgentAuthError) return gallerySkillAuthError(error);
    throw error;
  }
}
