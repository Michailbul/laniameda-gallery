import { galleryLlmsResponse } from "@/lib/server/gallery-skill-resources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return galleryLlmsResponse();
}
