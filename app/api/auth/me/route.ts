import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/server/app-user";
import { renewSessionCookieIfStale } from "@/lib/telegram-auth";

export async function GET() {
  try {
    const user = await getAppUser();
    if (user) {
      await renewSessionCookieIfStale();
    }
    return NextResponse.json({ user });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to resolve user.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
