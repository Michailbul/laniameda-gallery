import { createHash } from "node:crypto";
import type { TelegramInboundEnvelope, TelegramInboundMedia } from "@/lib/telegram/inbound";

export type DevTelegramChatType = TelegramInboundEnvelope["chatType"];

export type DevTelegramSimMediaFile = {
  mediaId: string;
  kind: TelegramInboundMedia["kind"];
  mimeType?: string;
  fileName?: string;
  sizeBytes: number;
  base64: string;
};

const DEFAULT_CHAT_TYPE: DevTelegramChatType = "direct";

const LINK_REGEX = /https?:\/\/[^\s<>"']+/gi;

const TELEGRAM_CHAT_TYPES = new Set<DevTelegramChatType>([
  "direct",
  "group",
  "supergroup",
  "channel",
]);

const parseLinksFromText = (text?: string) => {
  if (!text) {
    return [];
  }
  const matches = text.match(LINK_REGEX);
  if (!matches || matches.length === 0) {
    return [];
  }
  return matches;
};

const normalizeUniqueStrings = (values: string[]) => {
  return Array.from(
    new Set(
      values
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
};

export const isLocalHostname = (hostname: string) => {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".local")
  );
};

export const isDevTelegramSimEnabled = () => {
  return (process.env.DEV_TELEGRAM_SIM_ENABLED || "").trim().toLowerCase() === "true";
};

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
};

export const isDevTelegramSimRequestAllowed = (request: Request) => {
  if (!isDevTelegramSimEnabled()) {
    return false;
  }

  if (parseBoolean(process.env.DEV_TELEGRAM_SIM_ALLOW_NON_LOCAL, false)) {
    return true;
  }

  const hostname = new URL(request.url).hostname;
  return isLocalHostname(hostname);
};

export const inferMediaKindFromMimeOrName = ({
  mimeType,
  fileName,
}: {
  mimeType?: string;
  fileName?: string;
}): TelegramInboundMedia["kind"] => {
  const normalizedMimeType = mimeType?.trim().toLowerCase() || "";
  const normalizedName = fileName?.trim().toLowerCase() || "";

  if (normalizedMimeType.startsWith("image/")) {
    return "image";
  }
  if (normalizedMimeType.startsWith("video/")) {
    return "video";
  }
  if (normalizedMimeType.startsWith("audio/")) {
    return normalizedMimeType.includes("ogg") || normalizedMimeType.includes("opus")
      ? "voice"
      : "audio";
  }
  if (normalizedMimeType === "application/pdf") {
    return "document";
  }

  if (/\.(png|jpe?g|webp|gif|bmp)$/.test(normalizedName)) {
    return "image";
  }
  if (/\.(mp4|mov|webm|m4v|avi)$/.test(normalizedName)) {
    return "video";
  }
  if (/\.(mp3|wav|m4a|flac)$/.test(normalizedName)) {
    return "audio";
  }
  if (/\.(ogg|opus)$/.test(normalizedName)) {
    return "voice";
  }

  return "document";
};

export const buildDevTelegramEnvelope = ({
  chatId,
  threadId,
  messageId,
  fromUserId,
  fromDisplayName,
  chatType,
  text,
  links,
  media,
  updateId,
  receivedAt = Date.now(),
}: {
  chatId: string;
  threadId?: string;
  messageId: string;
  fromUserId?: string;
  fromDisplayName?: string;
  chatType?: string;
  text?: string;
  links?: string[];
  media?: TelegramInboundMedia[];
  updateId?: number;
  receivedAt?: number;
}): TelegramInboundEnvelope => {
  const normalizedChatType = (chatType?.trim().toLowerCase() || DEFAULT_CHAT_TYPE) as DevTelegramChatType;
  const resolvedChatType = TELEGRAM_CHAT_TYPES.has(normalizedChatType)
    ? normalizedChatType
    : DEFAULT_CHAT_TYPE;

  const textValue = text?.trim() || undefined;
  const mergedLinks = normalizeUniqueStrings([
    ...(links ?? []),
    ...parseLinksFromText(textValue),
  ]);

  return {
    provider: "telegram",
    updateId,
    chatId: chatId.trim(),
    threadId: threadId?.trim() || undefined,
    messageId: messageId.trim(),
    fromUserId: fromUserId?.trim() || undefined,
    fromDisplayName: fromDisplayName?.trim() || undefined,
    chatType: resolvedChatType,
    text: textValue,
    links: mergedLinks.length > 0 ? mergedLinks : undefined,
    media: media && media.length > 0 ? media : undefined,
    receivedAt,
  };
};

export const buildDevTelegramIdempotencyKey = ({
  chatId,
  messageId,
  text,
  mediaIds,
}: {
  chatId: string;
  messageId?: string;
  text?: string;
  mediaIds?: string[];
}) => {
  if (messageId && messageId.trim()) {
    return `dev_telegram:${chatId.trim()}:${messageId.trim()}`;
  }

  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        chatId: chatId.trim(),
        text: text?.trim() || "",
        mediaIds: normalizeUniqueStrings(mediaIds ?? []),
      }),
    )
    .digest("hex")
    .slice(0, 16);

  return `dev_telegram:${chatId.trim()}:hash:${hash}`;
};

export const parseLinksField = (input?: string) => {
  if (!input) {
    return [];
  }
  return normalizeUniqueStrings(
    input
      .split(/\n|,/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
};
