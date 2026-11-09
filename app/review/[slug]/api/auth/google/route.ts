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

// POST { credential } from the Google sign-in button. Sets rv_session when
// the Google account may open this review (invited, an alias of an invited
// person, or any account while sign-in is open); otherwise 403 with the
// email so the page can say which account was refused.
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const body = (await request.json().catch(() => null)) as { credential?: unknown; as?: unknown } | null;
  const credential = typeof body?.credential === "string" ? body.credential : "";
  // Which door the person picked on the sign-in card.
  const as = body?.as === "guest" ? "guest" : "director";
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
  let wantsDirector = false;
  if (!access) {
    // An account nobody invited joins as a guest (looks only) unless the
    // owner limited the review to invited people. Picking "Director" flags
    // it so Michael can switch it in one click.
    const joined = await client
      .mutation(api.review.joinReview, { slug, as, name: person.name, pictureUrl: person.picture })
      .catch(() => null);
    if (joined) {
      wantsDirector = joined.wantsDirector;
      access = await client.query(api.review.access, { slug });
    }
  }
  if (!access) {
    return NextResponse.json(
      { error: `${person.email} has no access to this review.`, email: person.email },
      { status: 403, headers: noStore },
    );
  }
  if (access.role !== "owner") {
    await client.mutation(api.review.recordVisit, { slug, name: person.name, pictureUrl: person.picture }).catch(() => null);
  }

  const response = NextResponse.json({ ok: true, role: access.role, email: person.email, wantsDirector }, { headers: noStore });
  response.cookies.set(REVIEW_COOKIE, await signReviewSession(person), reviewCookieOptions());
  return response;
}
