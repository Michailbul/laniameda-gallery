import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { REVIEW_COOKIE, mintReviewerConvexToken, reviewCookieOptions, signReviewSession } from "@/lib/server/review-auth";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };
const GUEST_KEY = "guest";

// POST: the sign-in card's Guest door. No Google account: a guest session
// that looks only (role viewer), while the owner keeps guests allowed.
export async function POST(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const url = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return NextResponse.json({ error: "Convex is not configured." }, { status: 500, headers: noStore });
  const client = new ConvexHttpClient(url);
  client.setAuth(mintReviewerConvexToken(GUEST_KEY));
  const access = await client.query(api.review.access, { slug });
  if (!access) return NextResponse.json({ error: "This review is for invited people only." }, { status: 403, headers: noStore });
  const response = NextResponse.json({ ok: true, role: access.role }, { headers: noStore });
  response.cookies.set(REVIEW_COOKIE, await signReviewSession({ email: GUEST_KEY, name: "Guest" }), reviewCookieOptions());
  return response;
}
