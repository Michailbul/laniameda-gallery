import { NextResponse } from "next/server";
import { REVIEW_DEV_AS_COOKIE, REVIEW_DEV_AS_EMAILS, reviewDevAsAllowed } from "@/lib/server/review-auth";

export const runtime = "nodejs";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// Local development only: POST { as: "director" | "producer" | "owner" } switches the review
// page between the test reviewer and the gallery owner. 404 in production and
// on any host that is not this machine.
export async function POST(request: Request) {
  if (!reviewDevAsAllowed() || !LOCAL_HOSTS.has(new URL(request.url).hostname)) {
    return new NextResponse(null, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as { as?: unknown } | null;
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  const email = body?.as === "director" ? REVIEW_DEV_AS_EMAILS[0] : body?.as === "producer" ? REVIEW_DEV_AS_EMAILS[1] : undefined;
  if (email) {
    response.cookies.set(REVIEW_DEV_AS_COOKIE, email, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 8 });
  } else {
    response.cookies.set(REVIEW_DEV_AS_COOKIE, "", { path: "/", maxAge: 0 });
  }
  return response;
}
