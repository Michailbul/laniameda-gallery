import { NextRequest, NextResponse } from "next/server";

const TELEGRAM_API = "https://api.telegram.org/bot";

function getBotToken(): string | null {
  return (
    process.env.TELEGRAM_LOGIN_BOT_TOKEN?.trim() ||
    process.env.TELEGRAM_BOT_TOKEN?.trim() ||
    null
  );
}

function getWebhookSecret(): string | null {
  return process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null;
}

function getLoginUrl(): string {
  const host =
    process.env.APP_CANONICAL_HOST?.trim() ||
    "laniameda-galery.vercel.app";
  return `https://${host}/api/auth/telegram?returnTo=/`;
}

async function sendLoginButton(chatId: number, botToken: string) {
  const url = `${TELEGRAM_API}${botToken}/sendMessage`;
  const body = {
    chat_id: chatId,
    text: "Tap the button below to log in to your gallery vault.",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Open Gallery",
            login_url: { url: getLoginUrl() },
          },
        ],
      ],
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "unknown");
    console.error("[telegram-webhook] sendMessage failed:", err);
  }
}

export async function POST(request: NextRequest) {
  // Validate secret token header
  const secret = getWebhookSecret();
  if (secret) {
    const headerSecret = request.headers.get("x-telegram-bot-api-secret-token");
    if (headerSecret !== secret) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const botToken = getBotToken();
  if (!botToken) {
    console.error("[telegram-webhook] No bot token configured");
    return NextResponse.json({ ok: true });
  }

  let update: Record<string, unknown>;
  try {
    update = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Handle /start and /login commands
  const message = update.message as
    | { chat?: { id?: number }; text?: string }
    | undefined;

  if (message?.chat?.id && typeof message.text === "string") {
    const text = message.text.trim().toLowerCase();
    if (
      text === "/start" ||
      text.startsWith("/start ") ||
      text === "/login"
    ) {
      await sendLoginButton(message.chat.id, botToken);
    }
  }

  // Telegram expects 200 OK for all webhook updates
  return NextResponse.json({ ok: true });
}
