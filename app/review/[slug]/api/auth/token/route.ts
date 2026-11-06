import { NextResponse } from "next/server";
import { convexTokenFor, resolveReviewViewer } from "@/lib/server/review-auth";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

// The review page's Convex client asks here for its identity (an hour-long
// token for the owner or the signed-in reviewer) and again before expiry.
export async function GET() {
  const viewer = await resolveReviewViewer();
  if (!viewer) return NextResponse.json({ token: null }, { status: 401, headers: noStore });
  try {
    return NextResponse.json({ token: convexTokenFor(viewer) ?? null, kind: viewer.kind }, { headers: noStore });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not issue a token.";
    return NextResponse.json({ error: message }, { status: 500, headers: noStore });
  }
}
