// Telegram delivery shared by the ingest notification (convex/notifications.ts,
// Node runtime) and the newspaper (convex/newspaper.ts, default runtime). The
// owner's chat is their Telegram id; the bot token is TELEGRAM_NOTIFY_BOT_TOKEN
// (TELEGRAM_BOT_TOKEN as the legacy fallback) in the Convex deployment's env.

export const resolveTelegramChatId = (ownerUserId: string) => {
  const normalized = ownerUserId.trim();
  if (!normalized) return null;
  if (normalized.startsWith("telegram:")) {
    const telegramId = normalized.slice("telegram:".length).trim();
    return telegramId || null;
  }
  return normalized;
};

export const resolveTelegramNotificationBotToken = () => {
  const explicitNotifyToken = process.env.TELEGRAM_NOTIFY_BOT_TOKEN?.trim();
  if (explicitNotifyToken) return explicitNotifyToken;
  // Backward-compatible fallback while migrating existing environments.
  const legacyToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return legacyToken || null;
};

/** One sendMessage call; false when Telegram refused it. Never throws. */
export const sendTelegramMessage = async (token: string, chatId: string, text: string, what: string) => {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      console.warn(`Telegram ${what} notification failed`, { status: response.status, bodyText });
      return false;
    }
    return true;
  } catch (error) {
    console.warn(`Failed to send Telegram ${what} notification`, error);
    return false;
  }
};
