import { NextResponse } from "next/server";
import { createSessionCookie } from "@/lib/telegram-auth";
import { isLocalHostname } from "@/lib/dev-telegram-sim";

export const runtime = "nodejs";
const DEFAULT_DEV_TELEGRAM_ID = "278674008";

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
};

const isDevAuthBypassEnabled = () => {
  if (process.env.NODE_ENV === "production") {
    return false;
  }
  return parseBoolean(process.env.DEV_AUTH_BYPASS_ENABLED, false);
};

const isRequestAllowed = (request: Request) => {
  if (!isDevAuthBypassEnabled()) {
    return false;
  }
  if (parseBoolean(process.env.DEV_AUTH_BYPASS_ALLOW_NON_LOCAL, false)) {
    return true;
  }
  return isLocalHostname(new URL(request.url).hostname);
};

const resolveDevTelegramId = () => {
  const candidate = (
    process.env.DEV_AUTH_TELEGRAM_ID ||
    process.env.KB_OWNER_USER_ID ||
    process.env.NEXT_PUBLIC_DEV_OWNER_USER_ID
  )?.trim();
  return candidate || DEFAULT_DEV_TELEGRAM_ID;
};

export async function POST(request: Request) {
  if (!isRequestAllowed(request)) {
    return NextResponse.json(
      { error: "Dev auth bypass is disabled or not allowed for this host." },
      { status: 403 },
    );
  }

  const telegramId = resolveDevTelegramId();

  const firstName = (process.env.DEV_AUTH_FIRST_NAME || "Dev").trim() || "Dev";
  const username = (process.env.DEV_AUTH_USERNAME || "").trim() || undefined;

  try {
    await createSessionCookie({
      telegramId,
      firstName,
      username,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create dev session.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    user: {
      telegramId,
      firstName,
      username,
      source: "dev-bypass",
    },
  });
}
