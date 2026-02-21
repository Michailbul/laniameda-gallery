const TELEGRAM_API_BASE = "https://api.telegram.org";

type WebhookAction = "set" | "info" | "delete";

const parseAction = (value: string | undefined): WebhookAction => {
  if (value === "set" || value === "info" || value === "delete") {
    return value;
  }
  return "info";
};

const getRequiredEnv = (name: string) => {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value.trim();
};

const callTelegram = async ({
  token,
  method,
  payload,
}: {
  token: string;
  method: string;
  payload?: Record<string, unknown>;
}) => {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  const body = (await response.json().catch(() => null)) as
    | {
        ok?: boolean;
        description?: string;
        result?: unknown;
      }
    | null;

  if (!response.ok || !body?.ok) {
    const description = body?.description || `HTTP ${response.status}`;
    throw new Error(`Telegram API ${method} failed: ${description}`);
  }

  return body.result;
};

const setWebhook = async (token: string) => {
  const webhookBase = getRequiredEnv("TELEGRAM_WEBHOOK_PUBLIC_URL").replace(/\/$/, "");
  const secretToken = getRequiredEnv("TELEGRAM_WEBHOOK_SECRET");
  const url = `${webhookBase}/api/telegram/webhook`;

  const result = await callTelegram({
    token,
    method: "setWebhook",
    payload: {
      url,
      secret_token: secretToken,
      allowed_updates: ["message", "edited_message", "channel_post", "edited_channel_post"],
      drop_pending_updates: false,
    },
  });

  console.log("Webhook set successfully.");
  console.log(JSON.stringify({ url, result }, null, 2));
};

const getWebhookInfo = async (token: string) => {
  const result = await callTelegram({
    token,
    method: "getWebhookInfo",
  });
  console.log("Current webhook info:");
  console.log(JSON.stringify(result, null, 2));
};

const deleteWebhook = async (token: string) => {
  const result = await callTelegram({
    token,
    method: "deleteWebhook",
    payload: {
      drop_pending_updates: false,
    },
  });

  console.log("Webhook deleted successfully.");
  console.log(JSON.stringify(result, null, 2));
};

const main = async () => {
  const action = parseAction(process.argv[2]);
  const token = getRequiredEnv("TELEGRAM_BOT_TOKEN");

  if (action === "set") {
    await setWebhook(token);
    return;
  }
  if (action === "delete") {
    await deleteWebhook(token);
    return;
  }
  await getWebhookInfo(token);
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
