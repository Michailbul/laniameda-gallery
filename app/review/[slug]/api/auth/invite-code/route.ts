import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { REVIEW_COOKIE, mintReviewerConvexToken, reviewCookieOptions, signReviewSession } from "@/lib/server/review-auth";
import { redeemReviewInvite } from "@/lib/server/review-invite";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

// POST { code }: "No Google account? Continue" on a person's tailored
// sign-in card. Their own short link signs them in without Google, the same
// session a Google sign-in sets.
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.trim().toLowerCase() : "";
  const invitee = code ? await redeemReviewInvite(slug, code) : null;
  if (!invitee) return NextResponse.json({ error: "This link does not work any more. Ask Michael for a new one." }, { status: 403, headers: noStore });
  const url = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  if (url) {
    const client = new ConvexHttpClient(url);
    client.setAuth(mintReviewerConvexToken(invitee.email));
    await client.mutation(api.review.recordVisit, { slug, name: invitee.name }).catch(() => null);
  }
  const response = NextResponse.json({ ok: true }, { headers: noStore });
  response.cookies.set(REVIEW_COOKIE, await signReviewSession({ email: invitee.email, name: invitee.name }), reviewCookieOptions());
  return response;
}
