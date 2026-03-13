import { NextResponse } from "next/server";
import {
  verifyTelegramAuth,
  isAuthDateFresh,
  createSessionCookie,
  parseTelegramWidgetData,
} from "@/lib/telegram-auth";

const TELEGRAM_AUTH_MAX_AGE_SECONDS = 5 * 60;

const resolveTelegramLoginBotToken = () => {
  const explicitLoginToken = process.env.TELEGRAM_LOGIN_BOT_TOKEN?.trim();
  if (explicitLoginToken) {
    return explicitLoginToken;
  }

  // Backward-compatible fallback while migrating existing environments.
  const legacyToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return legacyToken || null;
};

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const data = parseTelegramWidgetData(payload);
  if (!data) {
    return NextResponse.json({ error: "Invalid Telegram auth payload." }, { status: 400 });
  }

  const botToken = resolveTelegramLoginBotToken();
  if (!botToken) {
    return NextResponse.json(
      {
        error:
          "Server misconfigured: missing Telegram login bot token (TELEGRAM_LOGIN_BOT_TOKEN).",
      },
      { status: 500 },
    );
  }

  if (!verifyTelegramAuth(data, botToken)) {
    return NextResponse.json({ error: "Invalid auth hash." }, { status: 401 });
  }

  if (!isAuthDateFresh(data.auth_date, TELEGRAM_AUTH_MAX_AGE_SECONDS)) {
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
