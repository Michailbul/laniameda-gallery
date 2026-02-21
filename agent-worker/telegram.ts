import { Buffer } from "node:buffer";
import { basename, dirname, extname } from "node:path";
import type { Sandbox } from "@daytonaio/sdk";
import type { TelegramInboundEnvelope, TelegramInboundMedia } from "@/lib/telegram/inbound";

type RecordValue = Record<string, unknown>;

export type TelegramRunRouting = {
  chatId: string;
  threadId?: number;
  replyToMessageId?: number;
  chatType?: TelegramInboundEnvelope["chatType"];
};

export type TelegramRunContext = {
  provider?: "telegram";
  envelope?: TelegramInboundEnvelope;
  routing?: TelegramRunRouting;
};

type TelegramSendMessageResult = {
  message_id: number;
};

type TelegramGetFileResult = {
  file_id: string;
  file_path?: string;
  file_size?: number;
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

export type StagedTelegramMedia = {
  mediaId: string;
  kind: TelegramInboundMedia["kind"];
  mimeType?: string;
  fileName?: string;
  relativePath?: string;
  directContentBlock?: Record<string, unknown>;
};

export type StagedTelegramMediaFailure = {
  mediaId: string;
  reason: string;
};

export type DownloadedTelegramMedia = {
  mediaId: string;
  kind: TelegramInboundMedia["kind"];
  mimeType?: string;
  fileName?: string;
  sizeBytes: number;
  buffer: Buffer;
};

const TELEGRAM_CHAT_TYPES = new Set(["direct", "group", "supergroup", "channel"]);
const TELEGRAM_TEXT_HARD_LIMIT = 4096;
const TELEGRAM_MEDIA_RETRY_ATTEMPTS = 3;
const TELEGRAM_MEDIA_RETRY_BASE_DELAY_MS = 500;
const TELEGRAM_FILE_TOO_BIG_RE = /file is too big|exceeds \d+ bytes|payload too large/i;

const isRecord = (value: unknown): value is RecordValue => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const toOptionalString = (value: unknown) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${value}`;
  }
  return undefined;
};

const toOptionalPositiveInteger = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
};

const toOptionalNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
};

const parseMediaKind = (value: unknown): TelegramInboundMedia["kind"] | undefined => {
  if (
    value === "image" ||
    value === "video" ||
    value === "audio" ||
    value === "voice" ||
    value === "document"
  ) {
    return value;
  }
  return undefined;
};

const parseEnvelopeMedia = (value: unknown): TelegramInboundMedia[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const media: TelegramInboundMedia[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const mediaId = toOptionalString(item.mediaId);
    const kind = parseMediaKind(item.kind);
    if (!mediaId || !kind) {
      continue;
    }

    media.push({
      mediaId,
      kind,
      mimeType: toOptionalString(item.mimeType),
      fileName: toOptionalString(item.fileName),
      sizeBytes: toOptionalNumber(item.sizeBytes),
    });
  }

  return media.length > 0 ? media : undefined;
};

const parseTelegramEnvelope = (input: unknown): TelegramInboundEnvelope | undefined => {
  if (!isRecord(input) || input.provider !== "telegram") {
    return undefined;
  }

  const updateId = toOptionalNumber(input.updateId);
  const chatId = toOptionalString(input.chatId);
  const messageId = toOptionalString(input.messageId);
  if (
    !chatId ||
    !messageId ||
    !TELEGRAM_CHAT_TYPES.has(toOptionalString(input.chatType) || "")
  ) {
    return undefined;
  }

  const chatType = toOptionalString(input.chatType) as TelegramInboundEnvelope["chatType"];
  return {
    provider: "telegram",
    updateId: typeof updateId === "number" && Number.isInteger(updateId) ? updateId : undefined,
    chatId,
    threadId: toOptionalString(input.threadId),
    messageId,
    fromUserId: toOptionalString(input.fromUserId),
    fromUsername: toOptionalString(input.fromUsername),
    fromDisplayName: toOptionalString(input.fromDisplayName),
    chatType,
    text: toOptionalString(input.text),
    links: Array.isArray(input.links)
      ? input.links.map((entry) => toOptionalString(entry)).filter((entry): entry is string => Boolean(entry))
      : undefined,
    media: parseEnvelopeMedia(input.media),
    receivedAt: toOptionalNumber(input.receivedAt) ?? Date.now(),
  };
};

const parseTelegramRouting = (input: unknown): TelegramRunRouting | undefined => {
  if (!isRecord(input)) {
    return undefined;
  }

  const chatId = toOptionalString(input.chatId);
  if (!chatId) {
    return undefined;
  }

  return {
    chatId,
    threadId: toOptionalPositiveInteger(input.threadId),
    replyToMessageId: toOptionalPositiveInteger(input.replyToMessageId),
    chatType: TELEGRAM_CHAT_TYPES.has(toOptionalString(input.chatType) || "")
      ? (toOptionalString(input.chatType) as TelegramInboundEnvelope["chatType"])
      : undefined,
  };
};

export const extractTelegramContextFromRunInput = (input: unknown): TelegramRunContext => {
  if (!isRecord(input)) {
    return {};
  }

  const envelope = parseTelegramEnvelope(input.envelope);
  const routing = parseTelegramRouting(input.routing);
  const providerValue = toOptionalString(input.provider);
  const isTelegram = providerValue === "telegram" || envelope?.provider === "telegram";

  if (!isTelegram) {
    return {};
  }

  return {
    provider: "telegram",
    envelope,
    routing:
      routing && !routing.chatType && envelope
        ? {
            ...routing,
            chatType: envelope.chatType,
          }
        : routing,
  };
};

const fileNameFromMimeType = (mimeType?: string) => {
  const normalized = mimeType?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "image/jpeg") return "file.jpg";
  if (normalized === "image/png") return "file.png";
  if (normalized === "image/webp") return "file.webp";
  if (normalized === "image/gif") return "file.gif";
  if (normalized === "video/mp4") return "file.mp4";
  if (normalized === "audio/ogg") return "file.ogg";
  if (normalized === "audio/mpeg") return "file.mp3";
  if (normalized === "application/pdf") return "file.pdf";
  if (normalized.startsWith("image/")) return "file.jpg";
  if (normalized.startsWith("video/")) return "file.mp4";
  if (normalized.startsWith("audio/")) return "file.mp3";
  return undefined;
};

const fileNameFromKind = (kind: TelegramInboundMedia["kind"]) => {
  if (kind === "image") return "file.jpg";
  if (kind === "video") return "file.mp4";
  if (kind === "audio") return "file.mp3";
  if (kind === "voice") return "file.ogg";
  return "file.bin";
};

const sanitizeSegment = (value: string) => {
  const cleaned = value
    .trim()
    .replace(/[/\\]+/g, "-")
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/-+/g, "-");
  return cleaned || "unknown";
};

const sanitizeFileName = (value: string) => {
  const cleaned = basename(value.trim())
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/g, "");
  return cleaned || "file";
};

export const buildStagedMediaRelativePath = ({
  messageId,
  index,
  kind,
  fileName,
  mimeType,
}: {
  messageId: string;
  index: number;
  kind: TelegramInboundMedia["kind"];
  fileName?: string;
  mimeType?: string;
}) => {
  const safeMessageId = sanitizeSegment(messageId);
  const sequence = String(index + 1).padStart(2, "0");
  const baseName = sanitizeFileName(fileName || fileNameFromMimeType(mimeType) || fileNameFromKind(kind));
  const hasExtension = Boolean(extname(baseName));
  const withExtension = hasExtension ? baseName : sanitizeFileName(`${baseName}${extname(fileNameFromKind(kind))}`);
  return `media/inbound/${safeMessageId}/${sequence}-${withExtension}`;
};

export const buildDummyPromptPackage = ({
  intent,
  source,
  input,
  mediaNotes = [],
}: {
  intent: string;
  source: string;
  input?: unknown;
  mediaNotes?: string[];
}) => {
  const mediaSection =
    mediaNotes.length > 0 ? mediaNotes.join("\n") : "[media attached: none provided in this run]";

  return [
    "prompt_package:",
    `Intent: ${intent}`,
    `Source: ${source}`,
    "final_prompt: \"Create a production-ready UGC image prompt from the provided context.\"",
    "negative_prompt: \"low quality, blurry, malformed anatomy, unrelated objects\"",
    "generation_notes: \"MVP dummy mode output for Telegram + worker integration validation.\"",
    "media_notes:",
    mediaSection,
    "input_json:",
    JSON.stringify(input ?? {}, null, 2),
  ].join("\n");
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
}): Promise<T> => {
  const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = (await response.json().catch(() => null)) as TelegramApiResponse<T> | null;

  if (!response.ok) {
    const detail =
      body?.description ||
      (typeof body?.error_code === "number" ? `error_code=${body.error_code}` : undefined) ||
      `status ${response.status}`;
    throw new Error(`Telegram ${method} failed: ${detail}.`);
  }

  if (!body?.ok || body.result === undefined) {
    const detail =
      body?.description ||
      (typeof body?.error_code === "number" ? `error_code=${body.error_code}` : "unknown error");
    throw new Error(`Telegram ${method} rejected the request: ${detail}.`);
  }

  return body.result;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const isRetryableTelegramMediaError = (error: unknown) => {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (TELEGRAM_FILE_TOO_BIG_RE.test(message)) {
    return false;
  }
  if (message.includes("status 400")) {
    return false;
  }
  return true;
};

const downloadTelegramMediaAttachment = async ({
  botToken,
  item,
  maxBytes,
}: {
  botToken: string;
  item: TelegramInboundMedia;
  maxBytes: number;
}) => {
  const file = await withMediaRetry(() =>
    runTelegramApi<TelegramGetFileResult>({
      botToken,
      method: "getFile",
      payload: { file_id: item.mediaId },
    }),
  );

  if (!file.file_path) {
    throw new Error("missing file path");
  }

  const expectedSize = item.sizeBytes ?? file.file_size;
  if (typeof expectedSize === "number" && expectedSize > maxBytes) {
    throw new Error(`file exceeds ${maxBytes} bytes`);
  }

  const downloadResponse = await withMediaRetry(() =>
    fetch(`https://api.telegram.org/file/bot${botToken}/${file.file_path}`),
  );
  if (!downloadResponse.ok) {
    throw new Error(`download failed with status ${downloadResponse.status}`);
  }

  const buffer = Buffer.from(await downloadResponse.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    throw new Error(`download exceeded ${maxBytes} bytes`);
  }

  const mimeType =
    item.mimeType || downloadResponse.headers.get("content-type")?.split(";")[0]?.trim() || undefined;
  const fileName = item.fileName || basename(file.file_path);

  return {
    buffer,
    mimeType,
    fileName,
    filePath: file.file_path,
  };
};

export const downloadTelegramMediaForIngest = async ({
  botToken,
  envelope,
  selectedMediaIds,
  maxBytes,
}: {
  botToken: string;
  envelope: TelegramInboundEnvelope;
  selectedMediaIds: string[];
  maxBytes: number;
}) => {
  const mediaById = new Map((envelope.media ?? []).map((entry) => [entry.mediaId, entry]));
  const uniqueSelectedIds = Array.from(
    new Set(selectedMediaIds.map((mediaId) => mediaId.trim()).filter(Boolean)),
  );

  const downloadedMedia: DownloadedTelegramMedia[] = [];
  const failures: StagedTelegramMediaFailure[] = [];
  for (const mediaId of uniqueSelectedIds) {
    const item = mediaById.get(mediaId);
    if (!item) {
      failures.push({
        mediaId,
        reason: "media_not_in_envelope",
      });
      continue;
    }
    try {
      const downloaded = await downloadTelegramMediaAttachment({
        botToken,
        item,
        maxBytes,
      });
      downloadedMedia.push({
        mediaId: item.mediaId,
        kind: item.kind,
        mimeType: downloaded.mimeType,
        fileName: downloaded.fileName,
        sizeBytes: downloaded.buffer.byteLength,
        buffer: downloaded.buffer,
      });
    } catch (error) {
      failures.push({
        mediaId: item.mediaId,
        reason: error instanceof Error ? error.message : "unknown media download error",
      });
    }
  }

  return {
    downloadedMedia,
    failures,
    skippedMediaIds: [] as string[],
  };
};

const withMediaRetry = async <T>(
  fn: () => Promise<T>,
  attempts: number = TELEGRAM_MEDIA_RETRY_ATTEMPTS,
) => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableTelegramMediaError(error)) {
        throw error;
      }
      const delay = TELEGRAM_MEDIA_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      await wait(delay);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

const maybeBuildDirectContentBlock = ({
  kind,
  mimeType,
  fileName,
  buffer,
  maxDirectBytes,
}: {
  kind: TelegramInboundMedia["kind"];
  mimeType?: string;
  fileName?: string;
  buffer: Buffer;
  maxDirectBytes: number;
}) => {
  if (buffer.byteLength > maxDirectBytes) {
    return undefined;
  }

  if (kind === "image" && mimeType?.startsWith("image/")) {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: mimeType,
        data: buffer.toString("base64"),
      },
    } as Record<string, unknown>;
  }

  if (kind === "document" && mimeType === "application/pdf") {
    return {
      type: "document",
      source: {
        type: "base64",
        media_type: mimeType,
        data: buffer.toString("base64"),
      },
      title: fileName || "Attachment",
    } as Record<string, unknown>;
  }

  return undefined;
};

const ensureSandboxFolder = async (sandbox: Sandbox, folderPath: string) => {
  const segments = folderPath.split("/").filter(Boolean);
  let currentPath = "";
  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    try {
      await sandbox.fs.createFolder(currentPath, "755");
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (message.includes("exist") || message.includes("already")) {
        continue;
      }
      throw error;
    }
  }
};

export const resolveSandboxMediaUploadPath = ({
  relativePath,
  workspaceRoot,
}: {
  relativePath: string;
  workspaceRoot?: string;
}) => {
  const normalizedWorkspaceRoot = workspaceRoot?.trim().replace(/^\/+|\/+$/g, "");
  if (!normalizedWorkspaceRoot) {
    return relativePath;
  }
  return `${normalizedWorkspaceRoot}/${relativePath}`.replace(/\/+/g, "/");
};

export const stageTelegramMediaIntoSandbox = async ({
  sandbox,
  botToken,
  envelope,
  maxBytes,
  maxDirectBlockBytes,
  workspaceRoot,
}: {
  sandbox: Sandbox;
  botToken: string;
  envelope: TelegramInboundEnvelope;
  maxBytes: number;
  maxDirectBlockBytes: number;
  workspaceRoot?: string;
}) => {
  const stagedPaths: string[] = [];
  const mediaNotes: string[] = [];
  const stagedMedia: StagedTelegramMedia[] = [];
  const failures: StagedTelegramMediaFailure[] = [];
  const media = envelope.media ?? [];
  if (media.length === 0) {
    return { stagedPaths, mediaNotes, stagedMedia, failures };
  }

  await ensureSandboxFolder(
    sandbox,
    resolveSandboxMediaUploadPath({
      relativePath: `media/inbound/${sanitizeSegment(envelope.messageId)}`,
      workspaceRoot,
    }),
  );

  for (const [index, item] of media.entries()) {
    try {
      const downloaded = await downloadTelegramMediaAttachment({
        botToken,
        item,
        maxBytes,
      });
      const buffer = downloaded.buffer;

      const relativePath = buildStagedMediaRelativePath({
        messageId: envelope.messageId,
        index,
        kind: item.kind,
        fileName: downloaded.fileName,
        mimeType: item.mimeType,
      });
      const sandboxUploadPath = resolveSandboxMediaUploadPath({
        relativePath,
        workspaceRoot,
      });
      await ensureSandboxFolder(sandbox, dirname(sandboxUploadPath));
      await sandbox.fs.uploadFile(buffer, sandboxUploadPath);

      const mimeType = downloaded.mimeType;
      const directContentBlock = maybeBuildDirectContentBlock({
        kind: item.kind,
        mimeType,
        fileName: downloaded.fileName,
        buffer,
        maxDirectBytes: maxDirectBlockBytes,
      });

      stagedPaths.push(relativePath);
      mediaNotes.push(`[media attached: ${relativePath} (${item.mimeType || "application/octet-stream"})]`);
      stagedMedia.push({
        mediaId: item.mediaId,
        kind: item.kind,
        mimeType,
        fileName: downloaded.fileName,
        relativePath,
        directContentBlock,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown media fetch error";
      mediaNotes.push(`[media unavailable: ${item.mediaId} (${message})]`);
      failures.push({
        mediaId: item.mediaId,
        reason: message,
      });
    }
  }

  return { stagedPaths, mediaNotes, stagedMedia, failures };
};

const splitTelegramText = (text: string) => {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  if (normalized.length <= TELEGRAM_TEXT_HARD_LIMIT) {
    return [normalized];
  }

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    const next = cursor + TELEGRAM_TEXT_HARD_LIMIT;
    if (next >= normalized.length) {
      chunks.push(normalized.slice(cursor));
      break;
    }

    const window = normalized.slice(cursor, next);
    const splitAt = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
    if (splitAt > TELEGRAM_TEXT_HARD_LIMIT * 0.6) {
      chunks.push(window.slice(0, splitAt));
      cursor += splitAt + 1;
      continue;
    }

    chunks.push(window);
    cursor = next;
  }

  return chunks.filter(Boolean);
};

export const buildTelegramThreadParams = (routing: TelegramRunRouting) => {
  if (!routing.threadId || routing.threadId <= 0) {
    return undefined;
  }
  if (routing.chatType === "direct") {
    return { message_thread_id: routing.threadId };
  }
  // General forum topic id=1 should not be sent explicitly.
  if (routing.threadId === 1) {
    return undefined;
  }
  return { message_thread_id: routing.threadId };
};

export const sendTelegramRunReply = async ({
  botToken,
  routing,
  text,
}: {
  botToken: string;
  routing: TelegramRunRouting;
  text: string;
}) => {
  const parts = splitTelegramText(text);
  if (parts.length === 0) {
    return;
  }

  let first = true;
  for (const part of parts) {
    const payload: Record<string, unknown> = {
      chat_id: routing.chatId,
      text: part,
      disable_web_page_preview: true,
    };
    const threadParams = buildTelegramThreadParams(routing);
    if (threadParams) {
      payload.message_thread_id = threadParams.message_thread_id;
    }
    if (routing.replyToMessageId && first) {
      payload.reply_to_message_id = routing.replyToMessageId;
      payload.allow_sending_without_reply = true;
    }

    await runTelegramApi<TelegramSendMessageResult>({
      botToken,
      method: "sendMessage",
      payload,
    });
    first = false;
  }
};
