import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/telegram-auth";

export async function POST() {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
