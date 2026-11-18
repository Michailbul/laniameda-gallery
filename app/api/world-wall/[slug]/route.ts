import { NextResponse } from "next/server";
import { loadWorldWall } from "@/lib/server/world-wall";

// The public wall of a world, every frame, for the page to shuffle. Cached at
// the edge for five minutes; the data is the public page's own.
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const side = new URL(request.url).searchParams.get("side") ?? undefined;
  const tiles = await loadWorldWall(slug, side);
  return NextResponse.json(
    { tiles },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
  );
}
