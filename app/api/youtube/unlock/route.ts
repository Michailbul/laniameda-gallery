import { NextResponse } from "next/server";
import {
  YOUTUBE_COOKIE,
  checkYouTubePassword,
  signYouTubeAccess,
  youTubeCookieOptions,
} from "@/lib/server/youtube-access";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const attempt = typeof body?.password === "string" ? body.password : "";
  if (!attempt || attempt.length > 200 || !checkYouTubePassword(attempt)) {
    // A short pause makes guessing by script slow without costing a person anything.
    await new Promise((resolve) => setTimeout(resolve, 700));
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(YOUTUBE_COOKIE, await signYouTubeAccess(), youTubeCookieOptions());
  return response;
}
