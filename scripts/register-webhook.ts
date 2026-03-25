/**
 * Register the Telegram bot webhook.
 *
 * Usage:
 *   bun run scripts/register-webhook.ts
 *
 * Reads from .env / .env.local:
 *   TELEGRAM_LOGIN_BOT_TOKEN (or TELEGRAM_BOT_TOKEN)
 *   TELEGRAM_WEBHOOK_SECRET
 *   APP_CANONICAL_HOST (optional, defaults to laniameda-galery.vercel.app)
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

const botToken =
  process.env.TELEGRAM_LOGIN_BOT_TOKEN?.trim() ||
  process.env.TELEGRAM_BOT_TOKEN?.trim();

if (!botToken) {
  console.error("Missing TELEGRAM_LOGIN_BOT_TOKEN or TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

const host =
  process.env.APP_CANONICAL_HOST?.trim() || "laniameda-galery.vercel.app";
const webhookUrl = `https://${host}/api/telegram/webhook`;
const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();

console.log(`Setting webhook to: ${webhookUrl}`);
if (secretToken) {
  console.log("Secret token: configured");
} else {
  console.log("Secret token: NOT SET (webhook will accept unsigned requests)");
}

const body: Record<string, unknown> = {
  url: webhookUrl,
  allowed_updates: ["message"],
};
if (secretToken) {
  body.secret_token = secretToken;
}

const res = await fetch(
  `https://api.telegram.org/bot${botToken}/setWebhook`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  },
);

const data = await res.json();
console.log("Response:", JSON.stringify(data, null, 2));

if (!data.ok) {
  console.error("setWebhook failed");
  process.exit(1);
}

console.log("Webhook registered successfully.");
