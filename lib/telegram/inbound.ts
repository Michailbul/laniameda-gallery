export type TelegramEnvelopeChatType = "direct" | "group" | "supergroup" | "channel";

export type TelegramInboundMedia = {
  mediaId: string;
  kind: "image" | "video" | "audio" | "voice" | "document";
  mimeType?: string;
  fileName?: string;
  sizeBytes?: number;
};

export type TelegramInboundEnvelope = {
  provider: "telegram";
  updateId?: number;
  chatId: string;
  threadId?: string;
  messageId: string;
  fromUserId?: string;
  fromUsername?: string;
  fromDisplayName?: string;
  chatType: TelegramEnvelopeChatType;
  text?: string;
  links?: string[];
  media?: TelegramInboundMedia[];
  receivedAt: number;
};

type TelegramPhotoSize = {
  file_id: string;
  file_size?: number;
};

type TelegramMediaFile = {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

type TelegramMessage = {
  message_id: number;
  message_thread_id?: number;
  text?: string;
  caption?: string;
  chat?: {
    id: number | string;
    type?: "private" | "group" | "supergroup" | "channel";
  };
  from?: {
    id: number | string;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  photo?: TelegramPhotoSize[];
  video?: TelegramMediaFile;
  audio?: TelegramMediaFile;
  voice?: TelegramMediaFile;
  document?: TelegramMediaFile;
};

type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
};

const LINK_REGEX = /https?:\/\/[^\s<>"']+/gi;

const getMessageFromUpdate = (update: TelegramUpdate) => {
  return (
    update.message ??
    update.edited_message ??
    update.channel_post ??
    update.edited_channel_post ??
    null
  );
};

const mapChatType = (chatType?: string): TelegramEnvelopeChatType => {
  if (chatType === "private") return "direct";
  if (chatType === "group") return "group";
  if (chatType === "supergroup") return "supergroup";
  return "channel";
};

const parseLinks = (text?: string) => {
  if (!text) return undefined;
  const matches = text.match(LINK_REGEX);
  if (!matches || matches.length === 0) return undefined;
  return Array.from(new Set(matches));
};

const chooseLargestPhoto = (photos: TelegramPhotoSize[]) => {
  return photos.reduce((largest, current) => {
    const largestSize = largest.file_size ?? 0;
    const currentSize = current.file_size ?? 0;
    return currentSize > largestSize ? current : largest;
  }, photos[0]);
};

const collectMedia = (message: TelegramMessage) => {
  const media: TelegramInboundMedia[] = [];

  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const photo = chooseLargestPhoto(message.photo);
    media.push({
      mediaId: photo.file_id,
      kind: "image",
      sizeBytes: photo.file_size,
      mimeType: "image/jpeg",
    });
  }

  if (message.video?.file_id) {
    media.push({
      mediaId: message.video.file_id,
      kind: "video",
      sizeBytes: message.video.file_size,
      mimeType: message.video.mime_type,
      fileName: message.video.file_name,
    });
  }

  if (message.audio?.file_id) {
    media.push({
      mediaId: message.audio.file_id,
      kind: "audio",
      sizeBytes: message.audio.file_size,
      mimeType: message.audio.mime_type,
      fileName: message.audio.file_name,
    });
  }

  if (message.voice?.file_id) {
    media.push({
      mediaId: message.voice.file_id,
      kind: "voice",
      sizeBytes: message.voice.file_size,
      mimeType: message.voice.mime_type ?? "audio/ogg",
      fileName: message.voice.file_name,
    });
  }

  if (message.document?.file_id) {
    media.push({
      mediaId: message.document.file_id,
      kind: "document",
      sizeBytes: message.document.file_size,
      mimeType: message.document.mime_type,
      fileName: message.document.file_name,
    });
  }

  return media.length > 0 ? media : undefined;
};

export const normalizeTelegramUpdate = (
  update: TelegramUpdate,
  receivedAt: number = Date.now(),
): TelegramInboundEnvelope | null => {
  const message = getMessageFromUpdate(update);
  if (!message?.chat || typeof message.message_id !== "number") {
    return null;
  }

  const chatId = `${message.chat.id}`;
  if (!chatId.trim()) {
    return null;
  }

  const text = message.text?.trim() || message.caption?.trim() || undefined;
  const fromDisplayName = [message.from?.first_name, message.from?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    provider: "telegram",
    updateId: typeof update.update_id === "number" ? update.update_id : undefined,
    chatId,
    threadId:
      typeof message.message_thread_id === "number"
        ? `${message.message_thread_id}`
        : undefined,
    messageId: `${message.message_id}`,
    fromUserId: message.from?.id !== undefined ? `${message.from.id}` : undefined,
    fromUsername: message.from?.username,
    fromDisplayName: fromDisplayName || undefined,
    chatType: mapChatType(message.chat.type),
    text,
    links: parseLinks(text),
    media: collectMedia(message),
    receivedAt,
  };
};

export const buildTelegramRunUserId = (envelope: TelegramInboundEnvelope) => {
  return `telegram:${envelope.fromUserId ?? envelope.chatId}`;
};

export const buildTelegramUpdateIdempotencyKey = (updateId: number) => {
  return `telegram:update:${updateId}`;
};

export const buildTelegramMessageIdempotencyKey = (chatId: string, messageId: string) => {
  return `telegram:message:${chatId}:${messageId}`;
};

export const buildTelegramInboundIdempotencyKey = (envelope: TelegramInboundEnvelope) => {
  if (typeof envelope.updateId === "number") {
    return buildTelegramUpdateIdempotencyKey(envelope.updateId);
  }
  return buildTelegramMessageIdempotencyKey(envelope.chatId, envelope.messageId);
};
