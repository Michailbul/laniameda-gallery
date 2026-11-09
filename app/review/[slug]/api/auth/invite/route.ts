import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { convexTokenFor, readReviewInvite, resolveReviewViewer } from "@/lib/server/review-auth";
import { newInviteCode } from "@/lib/server/review-invite";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

const convexClient = () => {
  const url = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("Convex is not configured.");
  return new ConvexHttpClient(url);
};

// GET ?token=… : an old long invite link. It no longer signs anyone in
// directly (that skipped Google, so anyone holding it could be that person):
// it goes to the sign-in card, where the person signs in with Google.
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const token = new URL(request.url).searchParams.get("token");
  const invite = await readReviewInvite(token);
  const query = invite && invite.slug === slug.toLowerCase() ? "" : "?invite=invalid";
  return new Response(null, { status: 303, headers: { Location: `../../${query}`, ...noStore } });
}

// POST { email, base, fresh? } (owner only): a reviewer's short invite link.
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
  // The short personal link (<base>/i/<code>). The code stays the same until
  // a new one is asked for (fresh: true), so links already sent keep working.
  const name = typeof body?.name === "string" ? body.name : undefined;
  const fresh = (body as { fresh?: unknown } | null)?.fresh === true;
  const code = await client.mutation(api.review.setInviteCode, { slug, email, code: newInviteCode(name), fresh });
  const url = `${base.replace(/\/+$/, "")}/i/${code}`;
  return NextResponse.json({ url }, { headers: noStore });
}
