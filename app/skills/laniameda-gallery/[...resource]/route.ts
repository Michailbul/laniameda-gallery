import { authorizeGallerySkillOwner } from "@/lib/server/gallery-skill-auth";
import { gallerySkillResourceResponse } from "@/lib/server/gallery-skill-resources";
import { galleryInstructionSource } from "@/lib/server/gallery-private-instructions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ resource: string[] }> }) {
  const { resource } = await context.params;
  return gallerySkillResourceResponse(request, resource, { authorizeOwner: authorizeGallerySkillOwner, readSource: galleryInstructionSource(undefined, request) });
}
