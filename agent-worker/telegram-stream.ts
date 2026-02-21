import { buildTelegramThreadParams, sendTelegramRunReply, type TelegramRunRouting } from "./telegram";

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

type SendMessageResult = {
  message_id: number;
};

const TELEGRAM_TEXT_LIMIT = 4096;
const DEFAULT_FLUSH_INTERVAL_MS = 800;
const DEFAULT_TYPING_INTERVAL_MS = 4_000;

const toTelegramPreviewText = (text: string) => {
  const trimmed = text.trim();
  if (trimmed.length <= TELEGRAM_TEXT_LIMIT) {
    return trimmed;
  }
  return `${trimmed.slice(0, TELEGRAM_TEXT_LIMIT - 1)}…`;
};

const isDraftUnsupportedError = (error: unknown) => {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("sendmessagedraft") || message.includes("method not found");
};

const runTelegramApi = async <T>({
  botToken,
  method,
  payload,
  fetchImpl = fetch,
}: {
  botToken: string;
  method: string;
  payload: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}) => {
  const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = (await response.json().catch(() => null)) as TelegramApiResponse<T> | null;

  if (!response.ok || !body?.ok || body.result === undefined) {
    const detail =
      body?.description ||
      (typeof body?.error_code === "number" ? `error_code=${body.error_code}` : `status ${response.status}`);
    throw new Error(`Telegram ${method} failed: ${detail}.`);
  }

  return body.result;
};

export type TelegramStreamSender = {
  appendTextDelta: (delta: string) => void;
  flush: () => Promise<void>;
  complete: (finalText: string) => Promise<void>;
  fail: (fallbackText: string) => Promise<void>;
};

export const createTelegramStreamSender = ({
  botToken,
  routing,
  flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
  typingIntervalMs = DEFAULT_TYPING_INTERVAL_MS,
}: {
  botToken: string;
  routing: TelegramRunRouting;
  flushIntervalMs?: number;
  typingIntervalMs?: number;
}): TelegramStreamSender => {
  const threadParams = buildTelegramThreadParams(routing);
  const draftId = Date.now();
  const flushDelay = Math.max(250, flushIntervalMs);
  const typingDelay = Math.max(2_000, typingIntervalMs);

  let accumulatedText = "";
  let lastSentPreview = "";
  let streamMessageId: number | undefined;
  let draftSupported = true;
  let usingDraft = false;
  let transportFailed = false;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let typingTimer: ReturnType<typeof setInterval> | undefined;

  const sendTyping = async () => {
    try {
      await runTelegramApi({
        botToken,
        method: "sendChatAction",
        payload: {
          chat_id: routing.chatId,
          action: "typing",
          ...(threadParams ?? {}),
        },
      });
    } catch {
      // Typing is best-effort only.
    }
  };

  const stopTimers = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    if (typingTimer) {
      clearInterval(typingTimer);
      typingTimer = undefined;
    }
  };

  const sendDraft = async (text: string) => {
    await runTelegramApi({
      botToken,
      method: "sendMessageDraft",
      payload: {
        chat_id: routing.chatId,
        draft_id: draftId,
        text,
        disable_web_page_preview: true,
        ...(threadParams ?? {}),
      },
    });
    usingDraft = true;
  };

  const sendOrEditMessage = async (text: string) => {
    if (typeof streamMessageId === "number") {
      await runTelegramApi({
        botToken,
        method: "editMessageText",
        payload: {
          chat_id: routing.chatId,
          message_id: streamMessageId,
          text,
          disable_web_page_preview: true,
          ...(threadParams ?? {}),
        },
      });
      return;
    }

    const sent = await runTelegramApi<SendMessageResult>({
      botToken,
      method: "sendMessage",
      payload: {
        chat_id: routing.chatId,
        text,
        disable_web_page_preview: true,
        ...(threadParams ?? {}),
      },
    });
    streamMessageId = sent.message_id;
  };

  const flush = async () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    if (transportFailed) {
      return;
    }

    const preview = toTelegramPreviewText(accumulatedText);
    if (!preview || preview === lastSentPreview) {
      return;
    }

    try {
      if (draftSupported && !streamMessageId) {
        try {
          await sendDraft(preview);
          lastSentPreview = preview;
          return;
        } catch (error) {
          draftSupported = false;
          usingDraft = false;
          if (!isDraftUnsupportedError(error)) {
            throw error;
          }
        }
      }

      await sendOrEditMessage(preview);
      lastSentPreview = preview;
    } catch {
      transportFailed = true;
    }
  };

  const scheduleFlush = () => {
    if (transportFailed || flushTimer) {
      return;
    }
    flushTimer = setTimeout(() => {
      void flush();
    }, flushDelay);
  };

  typingTimer = setInterval(() => {
    void sendTyping();
  }, typingDelay);
  void sendTyping();

  return {
    appendTextDelta: (delta: string) => {
      if (transportFailed || !delta) {
        return;
      }
      accumulatedText += delta;
      scheduleFlush();
    },
    flush,
    complete: async (finalText: string) => {
      accumulatedText = finalText;
      await flush();
      stopTimers();

      if (!finalText.trim()) {
        return;
      }

      if (transportFailed || usingDraft || finalText.trim().length > TELEGRAM_TEXT_LIMIT) {
        await sendTelegramRunReply({
          botToken,
          routing,
          text: finalText,
        });
      }
    },
    fail: async (fallbackText: string) => {
      stopTimers();
      if (!fallbackText.trim()) {
        return;
      }
      await sendTelegramRunReply({
        botToken,
        routing,
        text: fallbackText,
      });
    },
  };
};
