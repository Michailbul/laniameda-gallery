import { NextRequest, NextResponse } from "next/server";
import {
  verifyTelegramAuth,
  isAuthDateFresh,
  createSessionCookie,
  parseTelegramWidgetData,
} from "@/lib/telegram-auth";

const TELEGRAM_AUTH_MAX_AGE_SECONDS = 5 * 60;
const AUTH_ERROR_QUERY_KEY = "tgAuthError";

type AuthSuccess = {
  ok: true;
  user: {
    telegramId: string;
    firstName: string;
    lastName?: string;
    username?: string;
    photoUrl?: string;
  };
};

type AuthFailure = {
  ok: false;
  code:
    | "invalid_payload"
    | "missing_bot_token"
    | "invalid_hash"
    | "expired";
  error: string;
  status: number;
};

const resolveTelegramLoginBotToken = () => {
  const explicitLoginToken = process.env.TELEGRAM_LOGIN_BOT_TOKEN?.trim();
  if (explicitLoginToken) {
    return explicitLoginToken;
  }

  // Backward-compatible fallback while migrating existing environments.
  const legacyToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return legacyToken || null;
};

const resolveReturnToUrl = (requestUrl: string, rawReturnTo: string | null) => {
  const fallbackUrl = new URL("/", requestUrl);

  if (!rawReturnTo) {
    return fallbackUrl;
  }

  try {
    const url = new URL(rawReturnTo, requestUrl);
    if (url.origin !== fallbackUrl.origin) {
      return fallbackUrl;
    }
    url.searchParams.delete(AUTH_ERROR_QUERY_KEY);
    return url;
  } catch {
    return fallbackUrl;
  }
};

const buildFailureRedirect = (
  request: NextRequest,
  code: AuthFailure["code"],
) => {
  const redirectUrl = resolveReturnToUrl(
    request.url,
    request.nextUrl.searchParams.get("returnTo"),
  );
  redirectUrl.searchParams.set(AUTH_ERROR_QUERY_KEY, code);
  return NextResponse.redirect(redirectUrl);
};

const authenticateTelegramPayload = async (
  payload: unknown,
): Promise<AuthSuccess | AuthFailure> => {
  const data = parseTelegramWidgetData(payload);
  if (!data) {
    return {
      ok: false,
      code: "invalid_payload",
      error: "Invalid Telegram auth payload.",
      status: 400,
    };
  }

  const botToken = resolveTelegramLoginBotToken();
  if (!botToken) {
    return {
      ok: false,
      code: "missing_bot_token",
      error:
        "Server misconfigured: missing Telegram login bot token (TELEGRAM_LOGIN_BOT_TOKEN).",
      status: 500,
    };
  }

  if (!verifyTelegramAuth(data, botToken)) {
    return {
      ok: false,
      code: "invalid_hash",
      error: "Invalid auth hash.",
      status: 401,
    };
  }

  if (!isAuthDateFresh(data.auth_date, TELEGRAM_AUTH_MAX_AGE_SECONDS)) {
    return {
      ok: false,
      code: "expired",
      error: "Auth data expired. Please try again.",
      status: 401,
    };
  }

  const user = {
    telegramId: String(data.id),
    firstName: data.first_name,
    lastName: data.last_name,
    username: data.username,
    photoUrl: data.photo_url,
  };

  await createSessionCookie(user);

  return { ok: true, user };
};

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const result = await authenticateTelegramPayload(payload);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ user: result.user });
}

export async function GET(request: NextRequest) {
  const payload = Object.fromEntries(request.nextUrl.searchParams.entries());
  const result = await authenticateTelegramPayload(payload);

  if (!result.ok) {
    return buildFailureRedirect(request, result.code);
  }

  const redirectUrl = resolveReturnToUrl(
    request.url,
    request.nextUrl.searchParams.get("returnTo"),
  );
  return NextResponse.redirect(redirectUrl);
}
