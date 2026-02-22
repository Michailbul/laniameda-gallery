import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { convexRuns } from "@/lib/ai/convex-runs";
import { dispatchRunToWorker } from "@/lib/ai/worker-dispatch";
import {
  buildTelegramInboundIdempotencyKey,
  buildTelegramRunUserId,
  normalizeTelegramUpdate,
} from "@/lib/telegram/inbound";
import { createLogger, createRequestId } from "@/lib/observability/logger";

export const runtime = "nodejs";
const logger = createLogger({ service: "next-api-telegram-webhook" });

const DEFAULT_MAX_BODY_BYTES = 1_000_000;
const DEFAULT_BODY_TIMEOUT_MS = 30_000;

const parsePositiveInt = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const getMaxBodyBytes = () => {
  return parsePositiveInt(process.env.TELEGRAM_WEBHOOK_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES);
};

const getBodyTimeoutMs = () => {
  return parsePositiveInt(process.env.TELEGRAM_WEBHOOK_BODY_TIMEOUT_MS, DEFAULT_BODY_TIMEOUT_MS);
};

const verifyWebhookSecret = (providedToken: string | null) => {
  const configured = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!configured) {
    return {
      ok: false as const,
      status: 503,
      error: "TELEGRAM_WEBHOOK_SECRET is not configured.",
    };
  }

  if (!providedToken) {
    return {
      ok: false as const,
      status: 401,
      error: "Missing Telegram webhook secret token.",
    };
  }

  const expected = Buffer.from(configured);
  const provided = Buffer.from(providedToken);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return {
      ok: false as const,
      status: 401,
      error: "Invalid Telegram webhook secret token.",
    };
  }

  return { ok: true as const };
};

const readBodyWithinLimit = async (request: Request) => {
  const maxBytes = getMaxBodyBytes();
  const timeoutMs = getBodyTimeoutMs();
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declaredLength = Number(contentLength);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      return {
        ok: false as const,
        status: 413,
        error: `Payload too large. Max ${maxBytes} bytes.`,
      };
    }
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<string>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Request body read timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });
  const body = await Promise.race([request.text(), timeoutPromise]);
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }
  const actualBytes = Buffer.byteLength(body, "utf8");
  if (actualBytes > maxBytes) {
    return {
      ok: false as const,
      status: 413,
      error: `Payload too large. Max ${maxBytes} bytes.`,
    };
  }

  return {
    ok: true as const,
    body,
  };
};

export async function POST(request: Request) {
  const requestId = createRequestId();
  const requestLogger = logger.withContext({
    requestId,
    phase: "telegram_ingress",
  });

  const secret = verifyWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"));
  if (!secret.ok) {
    requestLogger.warn(
      {
        phase: "telegram_secret_invalid",
        status: secret.status,
      },
      "telegram_secret_invalid",
    );
    return NextResponse.json({ error: secret.error }, { status: secret.status });
  }

  const bodyResult = await readBodyWithinLimit(request);
  if (!bodyResult.ok) {
    requestLogger.warn(
      {
        phase: "telegram_body_rejected",
        status: bodyResult.status,
      },
      "telegram_body_rejected",
    );
    return NextResponse.json({ error: bodyResult.error }, { status: bodyResult.status });
  }

  try {
    const update = JSON.parse(bodyResult.body);
    const envelope = normalizeTelegramUpdate(update);

    if (!envelope) {
      requestLogger.info(
        {
          phase: "telegram_payload_ignored",
        },
        "telegram_payload_ignored",
      );
      return NextResponse.json(
        {
          ok: true,
          ignored: true,
          reason: "Unsupported Telegram update payload.",
        },
        { status: 200 },
      );
    }

    const userId = buildTelegramRunUserId(envelope);
    const idempotencyKey = buildTelegramInboundIdempotencyKey(envelope);

    const createdRun = await convexRuns.createRun({
      userId,
      intent: "ingest",
      source: "telegram",
      input: {
        provider: "telegram",
        envelope,
        routing: {
          chatId: envelope.chatId,
          threadId: envelope.threadId,
          chatType: envelope.chatType,
          replyToMessageId: envelope.messageId,
        },
      },
      idempotencyKey,
      runtime: "agent_worker",
      provider: "provider_direct",
      mode: "prompt_package",
      sourceChatId: envelope.chatId,
      sourceThreadId: envelope.threadId,
      sourceMessageId: envelope.messageId,
      sourceUpdateId: envelope.updateId,
    });

    await convexRuns.appendRunEvent({
      runId: createdRun.runId,
      type: "system",
      payload: {
        phase: "telegram_ingress_normalized",
        requestId,
        updateId: envelope.updateId,
        chatId: envelope.chatId,
        messageId: envelope.messageId,
      },
    });

    if (createdRun.created) {
      const dispatched = await dispatchRunToWorker({
        runId: createdRun.runId,
        userId,
        intent: "ingest",
        source: "telegram",
      });

      if (!dispatched.ok) {
        await convexRuns.failRun({
          runId: createdRun.runId,
          workerId: "telegram-webhook",
          error: dispatched.error,
        });
        requestLogger.error(
          {
            phase: "telegram_dispatch_failed",
            runId: createdRun.runId,
            error: dispatched.error,
          },
          "telegram_dispatch_failed",
        );
        return NextResponse.json(
          {
            ok: true,
            runId: createdRun.runId,
            dispatched: false,
            error: dispatched.error,
          },
          { status: 200 },
        );
      }
    }

    requestLogger.info(
      {
        phase: "telegram_run_created",
        runId: createdRun.runId,
        duplicate: !createdRun.created,
        chatId: envelope.chatId,
        source: "telegram",
      },
      "telegram_run_created",
    );

    return NextResponse.json(
      {
        ok: true,
        runId: createdRun.runId,
        status: createdRun.status,
        duplicate: !createdRun.created,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid Telegram webhook payload.";
    requestLogger.error(
      {
        phase: "telegram_ingress_failed",
        error,
      },
      "telegram_ingress_failed",
    );
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
