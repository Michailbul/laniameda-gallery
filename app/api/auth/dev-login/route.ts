import { NextResponse } from "next/server";
import { createSessionCookie } from "@/lib/telegram-auth";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    telegramId?: string;
    firstName?: string;
    username?: string;
  } | null;

  const telegramId =
    body?.telegramId ||
    process.env.KB_OWNER_USER_ID ||
    "278674008";

  const firstName = body?.firstName || "Michael";
  const username = body?.username || "michael_dev";

  await createSessionCookie({
    telegramId,
    firstName,
    username,
  });

  return NextResponse.json({
    user: { telegramId, firstName, username },
  });
}
