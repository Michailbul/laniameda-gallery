import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import {
  REVIEW_COOKIE,
  mintReviewerConvexToken,
  reviewCookieOptions,
  signReviewSession,
  verifyGoogleCredential,
} from "@/lib/server/review-auth";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

// POST { credential, who } from the Google sign-in button under a person's
// door. Sets rv_session when the Google account is that person (their
// address, an alias, or the first account to claim the name); otherwise 403
// with the reason.
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const body = (await request.json().catch(() => null)) as { credential?: unknown; who?: unknown; invite?: unknown } | null;
  const credential = typeof body?.credential === "string" ? body.credential : "";
  // Whose door was picked on the sign-in card ("r1" = Alejandro …).
  const who = typeof body?.who === "string" ? body.who.slice(0, 20) : "";
  // The person's short link code, when they came through it.
  const invite = typeof body?.invite === "string" ? body.invite.slice(0, 48) : undefined;
  if (!credential) return NextResponse.json({ error: "Missing Google credential." }, { status: 400, headers: noStore });

  let person;
  try {
    person = await verifyGoogleCredential(credential);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google sign-in failed.";
    return NextResponse.json({ error: message }, { status: 401, headers: noStore });
  }

  const url = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return NextResponse.json({ error: "Convex is not configured." }, { status: 500, headers: noStore });
  const client = new ConvexHttpClient(url);
  client.setAuth(mintReviewerConvexToken(person.email));
  let access = await client.query(api.review.access, { slug });
  let refusal: string | undefined;
  if (who) {
    // Through a person's door: their address or alias signs in; an unknown
    // account becomes the alias of a name nobody has claimed yet.
    const claim = await client.mutation(api.review.claimReviewer, { slug, who, ...(invite ? { invite } : {}) }).catch(() => null);
    if (claim?.ok) access = await client.query(api.review.access, { slug });
    else refusal = claim?.reason;
  }
  if (!access) {
    return NextResponse.json(
      { error: refusal ?? `${person.email} has no access to this review.`, email: person.email },
      { status: 403, headers: noStore },
    );
  }
  if (access.role !== "owner") {
    await client.mutation(api.review.recordVisit, { slug, name: person.name, pictureUrl: person.picture }).catch(() => null);
  }

  const response = NextResponse.json({ ok: true, role: access.role, email: person.email }, { headers: noStore });
  response.cookies.set(REVIEW_COOKIE, await signReviewSession(person), reviewCookieOptions());
  return response;
}
