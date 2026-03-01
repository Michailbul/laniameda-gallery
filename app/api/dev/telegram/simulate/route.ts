import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/server-auth";
import { convexRuns } from "@/lib/ai/convex-runs";
import { dispatchRunToWorker } from "@/lib/ai/worker-dispatch";
import {
  buildDevTelegramEnvelope,
  buildDevTelegramIdempotencyKey,
  inferMediaKindFromMimeOrName,
  isDevTelegramSimRequestAllowed,
  parseLinksField,
  type DevTelegramSimMediaFile,
} from "@/lib/dev-telegram-sim";
import { createLogger, createRequestId } from "@/lib/observability/logger";
import { buildTelegramRunUserId, type TelegramInboundMedia } from "@/lib/telegram/inbound";

export const runtime = "nodejs";

const logger = createLogger({ service: "next-api-dev-telegram-sim" });

const parsePositiveInteger = (value: FormDataEntryValue | null) => {
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    return undefined;
  }
  return parsed;
};

const parseOptionalString = (value: FormDataEntryValue | null) => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
};

const parseMediaFromFormData = async (formData: FormData) => {
  const media: TelegramInboundMedia[] = [];
  const devMediaFiles: DevTelegramSimMediaFile[] = [];

  const mediaFiles = formData.getAll("mediaFiles");
  for (const [index, entry] of mediaFiles.entries()) {
    if (!(entry instanceof File)) {
      continue;
    }
    if (entry.size <= 0) {
      continue;
    }

    const fileName = entry.name?.trim() || `file-${index + 1}`;
    const mimeType = entry.type?.trim() || undefined;
    const kind = inferMediaKindFromMimeOrName({
      mimeType,
      fileName,
    });
    const mediaId = `dev-media-${index + 1}-${Date.now()}`;
    const buffer = Buffer.from(await entry.arrayBuffer());

    media.push({
      mediaId,
      kind,
      mimeType,
      fileName,
      sizeBytes: buffer.byteLength,
    });
    devMediaFiles.push({
      mediaId,
      kind,
      mimeType,
      fileName,
      sizeBytes: buffer.byteLength,
      base64: buffer.toString("base64"),
    });
  }

  return {
    media,
    devMediaFiles,
  };
};

const parseSessionUserId = async () => {
  try {
    const user = await getAuthUser();
    return user?.id || undefined;
  } catch {
    return undefined;
  }
};

const isAuthBypassEnabled = () => {
  const value = (process.env.DEV_TELEGRAM_SIM_AUTH_BYPASS || "").trim().toLowerCase();
  if (!value) {
    return true;
  }
  return value === "true" || value === "1" || value === "yes";
};

export async function POST(request: Request) {
  const requestId = createRequestId();
  const requestLogger = logger.withContext({
    requestId,
    phase: "dev_telegram_ingress",
  });

  if (!isDevTelegramSimRequestAllowed(request)) {
    requestLogger.warn({}, "dev_telegram_sim_request_rejected");
    return NextResponse.json(
      {
        error: "Dev Telegram simulator is disabled or not allowed for this host.",
      },
      { status: 403 },
    );
  }

  try {
    const formData = await request.formData();
    const chatId = parseOptionalString(formData.get("chatId"));
    if (!chatId) {
      return NextResponse.json({ error: "chatId is required." }, { status: 400 });
    }

    const providedMessageId = parseOptionalString(formData.get("messageId"));
    const messageId = providedMessageId || `${Date.now()}`;
    const text = parseOptionalString(formData.get("text"));
    const links = parseLinksField(parseOptionalString(formData.get("links")));

    const { media, devMediaFiles } = await parseMediaFromFormData(formData);

    const envelope = buildDevTelegramEnvelope({
      chatId,
      threadId: parseOptionalString(formData.get("threadId")),
      messageId,
      fromUserId: parseOptionalString(formData.get("fromUserId")),
      fromDisplayName: parseOptionalString(formData.get("fromDisplayName")),
      chatType: parseOptionalString(formData.get("chatType")),
      text,
      links,
      media,
      updateId: parsePositiveInteger(formData.get("updateId")),
    });

    const sessionUserId = await parseSessionUserId();
    if (!sessionUserId && !isAuthBypassEnabled()) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const userId = sessionUserId || buildTelegramRunUserId(envelope);
    const idempotencyKey = buildDevTelegramIdempotencyKey({
      chatId: envelope.chatId,
      messageId: providedMessageId,
      text: envelope.text,
      mediaIds: media.map((entry) => entry.mediaId),
    });

    const { result: createdRun } = await requestLogger.time(
      "create_run",
      () =>
        convexRuns.createRun({
          userId,
          intent: "ingest",
          source: "dev_telegram",
          input: {
            provider: "dev_telegram",
            envelope,
            routing: {
              chatId: envelope.chatId,
              threadId: envelope.threadId,
              chatType: envelope.chatType,
              replyToMessageId: envelope.messageId,
            },
            devMediaFiles,
          },
          idempotencyKey,
          runtime: "agent_worker",
          provider: "provider_direct",
          mode: "prompt_package",
          sourceChatId: envelope.chatId,
          sourceThreadId: envelope.threadId,
          sourceMessageId: envelope.messageId,
          sourceUpdateId: envelope.updateId,
        }),
      {
        source: "dev_telegram",
        chatId: envelope.chatId,
        threadId: envelope.threadId,
      },
    );

    await convexRuns.appendRunEvent({
      runId: createdRun.runId,
      type: "system",
      payload: {
        phase: "dev_telegram_ingress_normalized",
        requestId,
        chatId: envelope.chatId,
        messageId: envelope.messageId,
        mediaCount: envelope.media?.length ?? 0,
      },
    });

    if (createdRun.created) {
      const { result: dispatched } = await requestLogger.time(
        "dispatch_run",
        () =>
          dispatchRunToWorker({
            runId: createdRun.runId,
            userId,
            intent: "ingest",
            source: "dev_telegram",
          }),
        {
          runId: createdRun.runId,
          source: "dev_telegram",
        },
      );

      if (!dispatched.ok) {
        await convexRuns.failRun({
          runId: createdRun.runId,
          workerId: "dev-telegram-sim",
          error: dispatched.error,
        });
        requestLogger.error(
          {
            runId: createdRun.runId,
            error: dispatched.error,
          },
          "dev_telegram_dispatch_failed",
        );
        return NextResponse.json(
          {
            ok: true,
            runId: createdRun.runId,
            dispatched: false,
            error: dispatched.error,
            requestId,
          },
          { status: 200 },
        );
      }
    }

    requestLogger.info(
      {
        runId: createdRun.runId,
        source: "dev_telegram",
        duplicate: !createdRun.created,
      },
      "dev_telegram_run_created",
    );

    return NextResponse.json(
      {
        ok: true,
        runId: createdRun.runId,
        status: createdRun.status,
        duplicate: !createdRun.created,
        requestId,
      },
      { status: 200 },
    );
  } catch (error) {
    requestLogger.error(
      {
        error,
      },
      "dev_telegram_ingress_failed",
    );
    const message = error instanceof Error ? error.message : "Invalid simulator payload.";
    return NextResponse.json({ error: message, requestId }, { status: 400 });
  }
}
