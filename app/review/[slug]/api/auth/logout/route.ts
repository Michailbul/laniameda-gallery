import { NextResponse } from "next/server";
import { REVIEW_COOKIE, reviewCookieOptions } from "@/lib/server/review-auth";

export const runtime = "nodejs";

// Ends the Google review session (the gallery's own session is untouched).
export async function POST() {
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(REVIEW_COOKIE, "", { ...reviewCookieOptions(), maxAge: 0 });
  return response;
}
