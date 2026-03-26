import { NextRequest, NextResponse } from "next/server";
import { createHmac, createHash } from "crypto";

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

function getHost(): string {
  return (
    process.env.APP_CANONICAL_HOST?.trim() ||
    "laniameda-galery.vercel.app"
  );
}

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

/**
 * Build a pre-signed auth URL. The bot knows the user from the /start message,
 * so we sign the data with the same HMAC that verifyTelegramAuth expects.
 * This bypasses Telegram's login_url (which silently downgrades to a plain URL).
 */
function buildSignedAuthUrl(user: TelegramUser, botToken: string): string {
  const authDate = Math.floor(Date.now() / 1000);

  const pairs: Array<[string, string]> = [
    ["auth_date", String(authDate)],
    ["first_name", user.first_name],
    ["id", String(user.id)],
    ...(user.last_name ? [["last_name", user.last_name] as [string, string]] : []),
    ...(user.photo_url ? [["photo_url", user.photo_url] as [string, string]] : []),
    ...(user.username ? [["username", user.username] as [string, string]] : []),
  ];

  const checkString = pairs
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHash("sha256").update(botToken).digest();
  const hash = createHmac("sha256", secretKey)
    .update(checkString)
    .digest("hex");

  const params = new URLSearchParams();
  for (const [key, value] of pairs) {
    params.set(key, value);
  }
  params.set("hash", hash);
  params.set("returnTo", "/");

  return `https://${getHost()}/api/auth/telegram?${params.toString()}`;
}

async function sendLoginButton(
  user: TelegramUser,
  chatId: number,
  botToken: string,
) {
  const authUrl = buildSignedAuthUrl(user, botToken);

  const body = {
    chat_id: chatId,
    text: "Tap the button below to open your gallery vault.",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Open Gallery",
            url: authUrl,
          },
        ],
      ],
    },
  };

  const res = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
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
    | {
        chat?: { id?: number };
        from?: {
          id?: number;
          first_name?: string;
          last_name?: string;
          username?: string;
        };
        text?: string;
      }
    | undefined;

  if (message?.chat?.id && message?.from?.id && typeof message.text === "string") {
    const text = message.text.trim().toLowerCase();
    if (
      text === "/start" ||
      text.startsWith("/start ") ||
      text === "/login"
    ) {
      const user: TelegramUser = {
        id: message.from.id,
        first_name: message.from.first_name || "User",
        ...(message.from.last_name ? { last_name: message.from.last_name } : {}),
        ...(message.from.username ? { username: message.from.username } : {}),
      };
      await sendLoginButton(user, message.chat.id, botToken);
    }
  }

  // Telegram expects 200 OK for all webhook updates
  return NextResponse.json({ ok: true });
}
