import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import {
  REVIEW_COOKIE,
  convexTokenFor,
  mintReviewerConvexToken,
  readReviewInvite,
  resolveReviewViewer,
  reviewCookieOptions,
  reviewInviteUrl,
  signReviewSession,
} from "@/lib/server/review-auth";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

const convexClient = () => {
  const url = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("Convex is not configured.");
  return new ConvexHttpClient(url);
};

// GET ?token=… : open a private invite link. Sets rv_session for the invited
// email (when it is still on the project's reviewers) and goes to the review.
// The redirect is relative ("../../"), so it lands on whichever address the
// link was opened at (/cassandra on the public site, /review/<slug> here).
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const token = new URL(request.url).searchParams.get("token");
  const invite = await readReviewInvite(token);
  const back = (status: number, query = "") =>
    new Response(null, { status, headers: { Location: `../../${query}`, ...noStore } });
  if (!invite || invite.slug !== slug.toLowerCase()) return back(303, "?invite=invalid");

  const client = convexClient();
  client.setAuth(mintReviewerConvexToken(invite.email));
  const access = await client.query(api.review.access, { slug });
  if (!access) return back(303, "?invite=revoked");
  if (access.role !== "owner") {
    await client.mutation(api.review.recordVisit, { slug, name: invite.name }).catch(() => null);
  }
  const response = back(303);
  const cookie = await signReviewSession({ email: invite.email, name: invite.name });
  const options = reviewCookieOptions();
  response.headers.append(
    "Set-Cookie",
    [
      `${REVIEW_COOKIE}=${cookie}`,
      `Path=${options.path}`,
      `Max-Age=${options.maxAge}`,
      "HttpOnly",
      `SameSite=Lax`,
      ...(options.secure ? ["Secure"] : []),
    ].join("; "),
  );
  return response;
}

// POST { email, base } (owner only): make an invite link for a reviewer.
// `base` is the review address the owner is looking at (origin + path); the
// link is built under it so it works on the public site too.
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const viewer = await resolveReviewViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in first." }, { status: 401, headers: noStore });
  const client = convexClient();
  const token = convexTokenFor(viewer);
  if (token) client.setAuth(token);
  const access = await client.query(api.review.access, { slug });
  if (access?.role !== "owner") return NextResponse.json({ error: "Only the owner can invite." }, { status: 403, headers: noStore });

  const body = (await request.json().catch(() => null)) as { email?: unknown; base?: unknown; name?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const base = typeof body?.base === "string" ? body.base : "";
  if (!email || !/^https?:\/\//.test(base)) {
    return NextResponse.json({ error: "Give the reviewer's email and the page address." }, { status: 400, headers: noStore });
  }
  const url = await reviewInviteUrl(base, slug, email, typeof body?.name === "string" ? body.name : undefined);
  return NextResponse.json({ url, expiresInDays: 30 }, { headers: noStore });
}
