import { NextResponse } from "next/server";
import {
  verifyTelegramAuth,
  isAuthDateFresh,
  createSessionCookie,
  type TelegramWidgetData,
} from "@/lib/telegram-auth";

export async function POST(request: Request) {
  const data: TelegramWidgetData = await request.json();

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json(
      { error: "Server misconfigured: missing bot token." },
      { status: 500 },
    );
  }

  if (!verifyTelegramAuth(data, botToken)) {
    return NextResponse.json({ error: "Invalid auth hash." }, { status: 401 });
  }

  if (!isAuthDateFresh(data.auth_date)) {
    return NextResponse.json(
      { error: "Auth data expired. Please try again." },
      { status: 401 },
    );
  }

  const user = {
    telegramId: String(data.id),
    firstName: data.first_name,
    lastName: data.last_name,
    username: data.username,
    photoUrl: data.photo_url,
  };

  await createSessionCookie(user);

  return NextResponse.json({ user });
}
