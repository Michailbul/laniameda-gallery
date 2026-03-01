import type { Sandbox } from "@daytonaio/sdk";
import { RUN_EVENT_PHASES } from "../lib/run-phases";
import { createLogger } from "../lib/observability/logger";
import { convexRuns } from "./convex-client";
import { createRunSandbox, safeDeleteSandbox } from "./daytona";
import {
  type AgentIngestPayload,
  SANDBOX_WORKSPACE_ROOT,
  executeClaudeRun,
  executeClaudeRunStreamingInSandbox,
} from "./agent-runtime";
import { workerConfig } from "./config";
import { buildTelegramStreamingMessages } from "./streaming-message-builder";
import {
  createTelegramStreamSender,
  type TelegramStreamSender,
} from "./telegram-stream";
import {
  buildDummyPromptPackage,
  downloadTelegramMediaForIngest,
  extractTelegramContextFromRunInput,
  resolveSimulatedTelegramMediaForIngest,
  sendTelegramRunReply,
  stageSimulatedTelegramMediaIntoSandbox,
  stageTelegramMediaIntoSandbox,
  type DownloadedTelegramMedia,
  type StagedTelegramMedia,
  type TelegramRunContext,
  type TelegramRunRouting,
} from "./telegram";

type ActiveRun = {
  abortController: AbortController;
  sandbox?: Sandbox;
};

type EventType = "stream_text" | "tool_call" | "tool_result" | "status_change" | "error";
type AgentExecutionResult = {
  resultText: string;
  sessionId?: string;
  ingestPayload?: AgentIngestPayload;
  ingestToolCallCount: number;
};

const activeRuns = new Map<string, ActiveRun>();
const logger = createLogger({ service: "agent-worker-orchestrator" });

const getAdditionalDirectories = () => {
  return workerConfig.agentAdditionalDirectories.length > 0
    ? workerConfig.agentAdditionalDirectories
    : undefined;
};

const buildPromptFromRun = ({
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
    mediaNotes.length > 0
      ? ["Media notes:", ...mediaNotes]
      : ["Media notes:", "- none attached"];

  return [
    "You are a UGC influencer image prompt construction agent.",
    "Generate an actionable prompt package for image creation.",
    `Intent: ${intent}`,
    `Source: ${source}`,
    "Return concise output with:",
    "1) final_prompt",
    "2) negative_prompt",
    "3) generation_notes",
    ...mediaSection,
    `Input JSON: ${JSON.stringify(input ?? {}, null, 2)}`,
  ].join("\n");
};

const buildTelegramFailureReply = (runId: string, errorMessage: string) => {
  return `I couldn't complete run ${runId}.\n\nReason: ${errorMessage}`;
};

const buildTelegramCanceledReply = (runId: string, reason: string) => {
  return `Run ${runId} was canceled.\n\nReason: ${reason}`;
};

const appendSystemEvent = async (runId: string, payload: Record<string, unknown>) => {
  await convexRuns.appendRunEvent({
    runId,
    type: "system",
    payload,
  });
};

const appendErrorEvent = async (runId: string, payload: Record<string, unknown>) => {
  await convexRuns.appendRunEvent({
    runId,
    type: "error",
    payload,
  });
};

const createRunEventForwarder = ({
  runId,
  telegramStreamSender,
  logStreamToStdout,
  runLogger,
}: {
  runId: string;
  telegramStreamSender?: TelegramStreamSender;
  logStreamToStdout?: boolean;
  runLogger: ReturnType<typeof logger.withContext>;
}) => {
  return async (type: EventType, payload: Record<string, unknown>) => {
    await convexRuns.appendRunEvent({
      runId,
      type,
      payload,
    });
    if (type === "stream_text" && telegramStreamSender) {
      const textDelta = typeof payload.textDelta === "string" ? payload.textDelta : "";
      if (textDelta) {
        telegramStreamSender.appendTextDelta(textDelta);
      }
    }
    if (type === "stream_text" && logStreamToStdout) {
      const textDelta = typeof payload.textDelta === "string" ? payload.textDelta : "";
      if (textDelta) {
        runLogger.info(
          {
            phase: "dev_telegram_stream_delta",
            eventType: type,
            textDelta,
          },
          "dev_telegram_stream_delta",
        );
      }
    }
  };
};

const resolveIngestOwnerUserId = ({
  runUserId,
  source,
}: {
  runUserId: string;
  source: string;
}) => {
  const normalizedRunUserId = runUserId.trim();
  if (!normalizedRunUserId) {
    return normalizedRunUserId;
  }

  if (source !== "telegram" && source !== "dev_telegram") {
    return normalizedRunUserId;
  }

  if (!normalizedRunUserId.startsWith("telegram:")) {
    return normalizedRunUserId;
  }

  const unprefixed = normalizedRunUserId.slice("telegram:".length).trim();
  return unprefixed || normalizedRunUserId;
};

const createTelegramSender = ({
  runId,
  isTelegramOutboundRun,
  routing,
}: {
  runId: string;
  isTelegramOutboundRun: boolean;
  routing?: TelegramRunRouting;
}) => {
  if (!isTelegramOutboundRun || !routing || !workerConfig.telegramBotToken) {
    return undefined;
  }
  void appendSystemEvent(runId, {
    phase: "telegram_stream_sender_ready",
    chatId: routing.chatId,
    threadId: routing.threadId,
  });
  return createTelegramStreamSender({
    botToken: workerConfig.telegramBotToken,
    routing,
  });
};

const trySendTelegramReply = async ({
  runId,
  routing,
  text,
  phase,
}: {
  runId: string;
  routing?: TelegramRunRouting;
  text: string;
  phase: "telegram_reply_sent" | "telegram_reply_failed" | "telegram_reply_canceled";
}) => {
  if (!routing) {
    await appendSystemEvent(runId, {
      phase: `${phase}_skipped`,
      reason: "missing_routing",
    });
    return;
  }

  if (!workerConfig.telegramBotToken) {
    await appendSystemEvent(runId, {
      phase: `${phase}_skipped`,
      reason: "missing_telegram_bot_token",
    });
    return;
  }

  try {
    await sendTelegramRunReply({
      botToken: workerConfig.telegramBotToken,
      routing,
      text,
    });
    await appendSystemEvent(runId, {
      phase,
      chatId: routing.chatId,
      threadId: routing.threadId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Telegram send error.";
    await appendErrorEvent(runId, {
      phase: `${phase}_error`,
      message,
    });
  }
};

const tryCompleteTelegramStream = async ({
  runId,
  sender,
  resultText,
}: {
  runId: string;
  sender?: TelegramStreamSender;
  resultText: string;
}) => {
  if (!sender) {
    return false;
  }
  try {
    await sender.complete(resultText);
    await appendSystemEvent(runId, {
      phase: "telegram_stream_completed",
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Telegram stream completion error.";
    await appendErrorEvent(runId, {
      phase: "telegram_stream_completion_failed",
      message,
    });
    return false;
  }
};

const tryFailTelegramStream = async ({
  runId,
  sender,
  fallbackText,
  phase,
}: {
  runId: string;
  sender?: TelegramStreamSender;
  fallbackText: string;
  phase: "telegram_stream_failed" | "telegram_stream_canceled";
}) => {
  if (!sender) {
    return false;
  }
  try {
    await sender.fail(fallbackText);
    await appendSystemEvent(runId, {
      phase,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Telegram stream failure handler error.";
    await appendErrorEvent(runId, {
      phase: `${phase}_handler_error`,
      message,
    });
    return false;
  }
};

const prepareTelegramMedia = async ({
  runId,
  sandbox,
  telegramContext,
  isTelegramLikeRun,
  source,
  runLogger,
}: {
  runId: string;
  sandbox: Sandbox;
  telegramContext: TelegramRunContext;
  isTelegramLikeRun: boolean;
  source: string;
  runLogger: ReturnType<typeof logger.withContext>;
}) => {
  const mediaCount = telegramContext.envelope?.media?.length ?? 0;
  if (!isTelegramLikeRun || mediaCount === 0 || !telegramContext.envelope) {
    return {
      mediaNotes: [] as string[],
      stagedMedia: [] as StagedTelegramMedia[],
    };
  }
  const envelope = telegramContext.envelope;

  const staged =
    source === "dev_telegram"
      ? await stageSimulatedTelegramMediaIntoSandbox({
          sandbox,
          envelope,
          simulatedMediaFiles: telegramContext.devMediaFiles ?? [],
          maxBytes: workerConfig.telegramMediaMaxBytes,
          maxDirectBlockBytes: workerConfig.telegramDirectBlockMaxBytes,
          workspaceRoot: SANDBOX_WORKSPACE_ROOT,
        })
      : await (async () => {
          if (!workerConfig.telegramBotToken) {
            await appendErrorEvent(runId, {
              phase: RUN_EVENT_PHASES.mediaStageFailed,
              reason: "missing_telegram_bot_token",
              failedCount: mediaCount,
            });
            throw new Error("Media staging failed: TELEGRAM_BOT_TOKEN is not configured in worker.");
          }

          return stageTelegramMediaIntoSandbox({
            sandbox,
            botToken: workerConfig.telegramBotToken,
            envelope,
            maxBytes: workerConfig.telegramMediaMaxBytes,
            maxDirectBlockBytes: workerConfig.telegramDirectBlockMaxBytes,
            workspaceRoot: SANDBOX_WORKSPACE_ROOT,
          });
        })();

  if (staged.failures.length > 0) {
    await appendErrorEvent(runId, {
      phase: RUN_EVENT_PHASES.mediaStageFailed,
      failedCount: staged.failures.length,
      failures: staged.failures,
    });
    throw new Error(`Media staging failed for ${staged.failures.length} attachment(s).`);
  }

  await appendSystemEvent(runId, {
    phase: "telegram_media_staged",
    stagedCount: staged.stagedPaths.length,
    directBlockCount: staged.stagedMedia.filter((entry) => Boolean(entry.directContentBlock)).length,
    mediaCount,
    stagedPaths: staged.stagedPaths,
  });
  runLogger.info(
    {
      phase: "telegram_media_staged",
      stagedCount: staged.stagedPaths.length,
      source,
    },
    "telegram_media_staged",
  );

  return {
    mediaNotes: staged.mediaNotes,
    stagedMedia: staged.stagedMedia,
  };
};

const runSingleMode = async ({
  prompt,
  signal,
  onEvent,
}: {
  prompt: string;
  signal: AbortSignal;
  onEvent: (type: EventType, payload: Record<string, unknown>) => Promise<void>;
}): Promise<AgentExecutionResult> => {
  return executeClaudeRun({
    prompt,
    maxTurns: workerConfig.maxTurns,
    signal,
    cwd: workerConfig.agentWorkspaceCwd,
    additionalDirectories: getAdditionalDirectories(),
    onEvent,
  });
};

const runStreamingWithFallback = async ({
  runId,
  sandbox,
  signal,
  runState,
  telegramContext,
  mediaNotes,
  stagedMedia,
  prompt,
  onEvent,
}: {
  runId: string;
  sandbox: Sandbox;
  signal: AbortSignal;
  runState: NonNullable<Awaited<ReturnType<typeof convexRuns.getRun>>>;
  telegramContext: TelegramRunContext;
  mediaNotes: string[];
  stagedMedia: StagedTelegramMedia[];
  prompt: string;
  onEvent: (type: EventType, payload: Record<string, unknown>) => Promise<void>;
}): Promise<AgentExecutionResult> => {
  const streamingMessages = buildTelegramStreamingMessages({
    intent: runState.run.intent,
    source: runState.run.source,
    input: runState.run.input,
    envelope: telegramContext.envelope,
    mediaNotes,
    stagedMedia,
  });

  await appendSystemEvent(runId, {
    phase: RUN_EVENT_PHASES.sandboxAgentStarted,
    runtime: "streaming",
  });

  try {
    const execution = await executeClaudeRunStreamingInSandbox({
      sandbox,
      messages: streamingMessages,
      maxTurns: workerConfig.maxTurns,
      signal,
      cwd: workerConfig.agentWorkspaceCwd,
      additionalDirectories: getAdditionalDirectories(),
      onEvent,
    });
    await appendSystemEvent(runId, {
      phase: RUN_EVENT_PHASES.sandboxAgentFinished,
      runtime: "streaming",
      status: "success",
    });
    return execution;
  } catch (error) {
    await appendErrorEvent(runId, {
      phase: RUN_EVENT_PHASES.sandboxAgentFinished,
      runtime: "streaming",
      status: "error",
      message: error instanceof Error ? error.message : "Unknown streaming runtime error.",
    });

    if (!workerConfig.streamingSingleFallback) {
      throw error;
    }

    await appendSystemEvent(runId, {
      phase: "streaming_fallback_single_mode",
      reason: error instanceof Error ? error.message : "streaming_failed",
    });

    return runSingleMode({ prompt, signal, onEvent });
  }
};

const runAgent = async ({
  runId,
  runState,
  sandbox,
  signal,
  isTelegramLikeRun,
  isDevTelegramRun,
  telegramContext,
  mediaNotes,
  stagedMedia,
  telegramStreamSender,
  runLogger,
}: {
  runId: string;
  runState: NonNullable<Awaited<ReturnType<typeof convexRuns.getRun>>>;
  sandbox: Sandbox;
  signal: AbortSignal;
  isTelegramLikeRun: boolean;
  isDevTelegramRun: boolean;
  telegramContext: TelegramRunContext;
  mediaNotes: string[];
  stagedMedia: StagedTelegramMedia[];
  telegramStreamSender?: TelegramStreamSender;
  runLogger: ReturnType<typeof logger.withContext>;
}): Promise<AgentExecutionResult> => {
  const prompt = buildPromptFromRun({
    intent: runState.run.intent,
    source: runState.run.source,
    input: runState.run.input,
    mediaNotes,
  });

  if (workerConfig.dummyMode) {
    const resultText = buildDummyPromptPackage({
      intent: runState.run.intent,
      source: runState.run.source,
      input: runState.run.input,
      mediaNotes,
    });
    await appendSystemEvent(runId, {
      phase: "dummy_prompt_package_generated",
    });
    return {
      resultText,
      ingestToolCallCount: 0,
    };
  }

  const onEvent = createRunEventForwarder({
    runId,
    telegramStreamSender,
    logStreamToStdout: isDevTelegramRun,
    runLogger,
  });
  const useStreamingRuntime = isTelegramLikeRun && workerConfig.streamingMode;
  if (useStreamingRuntime) {
    return runStreamingWithFallback({
      runId,
      sandbox,
      signal,
      runState,
      telegramContext,
      mediaNotes,
      stagedMedia,
      prompt,
      onEvent,
    });
  }
  return runSingleMode({
    prompt,
    signal,
    onEvent,
  });
};

const finalizeRun = async ({
  runId,
  sandbox,
  sessionId,
  resultText,
  ingestResult,
}: {
  runId: string;
  sandbox: Sandbox;
  sessionId?: string;
  resultText: string;
  ingestResult?: {
    promptIds: string[];
    assetIds: string[];
    skippedMediaIds: string[];
  };
}) => {
  await convexRuns.completeRun({
    runId,
    workerId: workerConfig.workerId,
    sessionId,
    artifacts: [
      {
        kind: "prompt_package",
        mimeType: "text/plain",
        textContent: resultText,
        metadata: {
          runtime: "claude-agent-sdk",
          sandboxId: sandbox.id,
          ingest: ingestResult,
        },
      },
    ],
  });
};

const normalizePromptPayload = (payload: AgentIngestPayload) => {
  const prompts = payload.prompts
    .map((prompt) => ({
      final_prompt: prompt.final_prompt.trim(),
      negative_prompt: prompt.negative_prompt?.trim() || undefined,
      generation_notes: prompt.generation_notes?.trim() || undefined,
      tags: Array.from(new Set((prompt.tags ?? []).map((tag) => tag.trim()).filter(Boolean))),
    }))
    .filter((prompt) => prompt.final_prompt.length > 0);

  return {
    prompts,
    selectedTelegramMediaIds: Array.from(
      new Set(payload.selectedTelegramMediaIds.map((mediaId) => mediaId.trim()).filter(Boolean)),
    ),
    selectedUrls: Array.from(new Set(payload.selectedUrls.map((url) => url.trim()).filter(Boolean))),
    notes: payload.notes?.trim() || undefined,
  };
};

const encodeDownloadedMedia = (media: DownloadedTelegramMedia) => ({
  mediaId: media.mediaId,
  kind: media.kind,
  mimeType: media.mimeType,
  fileName: media.fileName,
  base64: media.buffer.toString("base64"),
});

const applyAgentIngestPayload = async ({
  runId,
  runState,
  execution,
  telegramContext,
  runLogger,
}: {
  runId: string;
  runState: NonNullable<Awaited<ReturnType<typeof convexRuns.getRun>>>;
  execution: AgentExecutionResult;
  telegramContext: TelegramRunContext;
  runLogger: ReturnType<typeof logger.withContext>;
}) => {
  if (runState.run.intent !== "ingest") {
    return {
      promptIds: [] as string[],
      assetIds: [] as string[],
      skippedMediaIds: [] as string[],
    };
  }

  if (execution.ingestToolCallCount !== 1 || !execution.ingestPayload) {
    runLogger.error(
      {
        phase: "ingest_payload_missing",
        ingestToolCallCount: execution.ingestToolCallCount,
      },
      "ingest_payload_missing",
    );
    throw new Error("no_ingest_payload");
  }

  const normalizedPayload = normalizePromptPayload(execution.ingestPayload);
  if (normalizedPayload.prompts.length === 0) {
    runLogger.error(
      {
        phase: "ingest_payload_no_usable_prompt",
      },
      "ingest_payload_no_usable_prompt",
    );
    throw new Error("no_usable_prompt");
  }

  let downloadedMedia: DownloadedTelegramMedia[] = [];
  let skippedMediaIds: string[] = [];
  if (normalizedPayload.selectedTelegramMediaIds.length > 0) {
    if (!telegramContext.envelope) {
      throw new Error("selected_media_requires_telegram_envelope");
    }
    const downloaded =
      runState.run.source === "dev_telegram"
        ? await resolveSimulatedTelegramMediaForIngest({
            simulatedMediaFiles: telegramContext.devMediaFiles ?? [],
            selectedMediaIds: normalizedPayload.selectedTelegramMediaIds,
            maxBytes: workerConfig.telegramMediaMaxBytes,
          })
        : await (async () => {
            if (!workerConfig.telegramBotToken) {
              throw new Error("selected_media_requires_bot_token");
            }
            return downloadTelegramMediaForIngest({
              botToken: workerConfig.telegramBotToken,
              envelope: telegramContext.envelope!,
              selectedMediaIds: normalizedPayload.selectedTelegramMediaIds,
              maxBytes: workerConfig.telegramMediaMaxBytes,
            });
          })();
    if (downloaded.failures.length > 0) {
      const message = downloaded.failures.map((entry) => `${entry.mediaId}:${entry.reason}`).join(", ");
      throw new Error(`selected_media_download_failed:${message}`);
    }
    downloadedMedia = downloaded.downloadedMedia;
    skippedMediaIds = downloaded.skippedMediaIds;
  }

  const ingestResult = await convexRuns.ingestAgentPayload({
    runId,
    ownerUserId: resolveIngestOwnerUserId({
      runUserId: runState.run.userId,
      source: runState.run.source,
    }),
    payload: normalizedPayload,
    mediaFiles: downloadedMedia.map(encodeDownloadedMedia),
  });

  await appendSystemEvent(runId, {
    phase: "agent_ingest_applied",
    promptCount: ingestResult.promptIds.length,
    assetCount: ingestResult.assetIds.length,
    skippedMediaCount: skippedMediaIds.length,
  });
  runLogger.info(
    {
      phase: "agent_ingest_applied",
      promptCount: ingestResult.promptIds.length,
      assetCount: ingestResult.assetIds.length,
      skippedMediaCount: skippedMediaIds.length,
    },
    "agent_ingest_applied",
  );

  return {
    promptIds: ingestResult.promptIds,
    assetIds: ingestResult.assetIds,
    skippedMediaIds,
  };
};

export const dispatchRun = async (runId: string) => {
  const runLogger = logger.withContext({ runId, workerId: workerConfig.workerId });
  const claim = await convexRuns.claimRun({
    runId,
    workerId: workerConfig.workerId,
  });
  if (!claim.claimed) {
    runLogger.warn(
      {
        phase: "run_claim_rejected",
        status: claim.status,
      },
      "run_claim_rejected",
    );
    return {
      accepted: false,
      status: claim.status,
    };
  }

  const abortController = new AbortController();
  activeRuns.set(runId, { abortController });
  void executeRun(runId, abortController).finally(() => {
    activeRuns.delete(runId);
  });
  runLogger.info(
    {
      phase: "run_claimed",
      status: claim.status,
    },
    "run_claimed",
  );

  return {
    accepted: true,
    status: claim.status,
  };
};

export const cancelDispatchedRun = async ({
  runId,
  reason,
}: {
  runId: string;
  reason?: string;
}) => {
  const runLogger = logger.withContext({ runId, workerId: workerConfig.workerId });
  const active = activeRuns.get(runId);
  if (active) {
    active.abortController.abort();
  }
  await convexRuns.cancelRun({ runId, reason });
  runLogger.warn(
    {
      phase: "run_cancel_dispatched",
      reason,
    },
    "run_cancel_dispatched",
  );
};

const executeRun = async (runId: string, abortController: AbortController) => {
  let sandbox: Sandbox | undefined;
  let sessionId: string | undefined;
  let telegramRouting: TelegramRunRouting | undefined;
  let telegramStreamSender: TelegramStreamSender | undefined;
  let telegramContext: TelegramRunContext = {};
  let isTelegramLikeRun = false;
  let isTelegramOutboundRun = false;
  let isDevTelegramRun = false;
  let runLogger = logger.withContext({ runId, workerId: workerConfig.workerId });

  try {
    const runState = await convexRuns.getRun({ runId });
    if (!runState) {
      throw new Error("Run not found before execution.");
    }
    runLogger = runLogger.withContext({
      source: runState.run.source,
      runtime: runState.run.runtime,
      userId: runState.run.userId,
    });
    runLogger.info({ phase: "run_execution_started" }, "run_execution_started");

    telegramContext = extractTelegramContextFromRunInput(runState.run.input);
    telegramRouting = telegramContext.routing;
    isTelegramOutboundRun = runState.run.source === "telegram";
    isDevTelegramRun = runState.run.source === "dev_telegram";
    isTelegramLikeRun =
      isTelegramOutboundRun ||
      isDevTelegramRun ||
      telegramContext.provider === "telegram" ||
      telegramContext.provider === "dev_telegram";

    telegramStreamSender = createTelegramSender({
      runId,
      isTelegramOutboundRun,
      routing: telegramRouting,
    });

    const sandboxResult = await createRunSandbox({
      runId,
      userId: runState.run.userId,
    });
    sandbox = sandboxResult.sandbox;
    runLogger = runLogger.withContext({ sandboxId: sandbox.id });
    const active = activeRuns.get(runId);
    if (active) {
      active.sandbox = sandbox;
    }

    await convexRuns.setRunRunning({
      runId,
      workerId: workerConfig.workerId,
      sandboxId: sandbox.id,
      sandboxLabel: sandboxResult.sandboxLabel,
    });
    await appendSystemEvent(runId, {
      phase: "sandbox_created",
      sandboxId: sandbox.id,
    });
    runLogger.info({ phase: "sandbox_created", sandboxId: sandbox.id }, "sandbox_created");

    const media = await prepareTelegramMedia({
      runId,
      sandbox,
      telegramContext,
      isTelegramLikeRun,
      source: runState.run.source,
      runLogger,
    });
    const execution = await runAgent({
      runId,
      runState,
      sandbox,
      signal: abortController.signal,
      isTelegramLikeRun,
      isDevTelegramRun,
      telegramContext,
      mediaNotes: media.mediaNotes,
      stagedMedia: media.stagedMedia,
      telegramStreamSender,
      runLogger,
    });
    sessionId = execution.sessionId;
    runLogger = runLogger.withContext({ sessionId });
    const ingestResult = await applyAgentIngestPayload({
      runId,
      runState,
      execution,
      telegramContext,
      runLogger,
    });

    await finalizeRun({
      runId,
      sandbox,
      sessionId,
      resultText: execution.resultText,
      ingestResult,
    });
    runLogger.info(
      {
        phase: "run_completed",
        ingestPromptCount: ingestResult.promptIds.length,
        ingestAssetCount: ingestResult.assetIds.length,
      },
      "run_completed",
    );

    if (isTelegramOutboundRun) {
      const completedWithStream = await tryCompleteTelegramStream({
        runId,
        sender: telegramStreamSender,
        resultText: execution.resultText,
      });
      if (!completedWithStream) {
        await trySendTelegramReply({
          runId,
          routing: telegramRouting,
          text: execution.resultText,
          phase: "telegram_reply_sent",
        });
      }
    }
    if (isDevTelegramRun) {
      runLogger.info(
        {
          phase: "dev_telegram_reply_stdout",
          text: execution.resultText,
        },
        "dev_telegram_reply_stdout",
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown worker execution error.";
    runLogger.error({ phase: "run_execution_failed", error }, "run_execution_failed");

    const wasAborted = abortController.signal.aborted;
    if (wasAborted) {
      await convexRuns.cancelRun({
        runId,
        reason: message || "Run canceled.",
      });
      if (isTelegramOutboundRun) {
        const handledByStream = await tryFailTelegramStream({
          runId,
          sender: telegramStreamSender,
          fallbackText: buildTelegramCanceledReply(runId, message || "Canceled."),
          phase: "telegram_stream_canceled",
        });
        if (!handledByStream) {
          await trySendTelegramReply({
            runId,
            routing: telegramRouting,
            text: buildTelegramCanceledReply(runId, message || "Canceled."),
            phase: "telegram_reply_canceled",
          });
        }
      }
      if (isDevTelegramRun) {
        runLogger.warn(
          {
            phase: "dev_telegram_run_canceled",
            reason: message || "Canceled.",
          },
          "dev_telegram_run_canceled",
        );
      }
      return;
    }

    await convexRuns.failRun({
      runId,
      workerId: workerConfig.workerId,
      sessionId,
      error: message,
    });
    if (isTelegramOutboundRun) {
      const handledByStream = await tryFailTelegramStream({
        runId,
        sender: telegramStreamSender,
        fallbackText: buildTelegramFailureReply(runId, message),
        phase: "telegram_stream_failed",
      });
      if (!handledByStream) {
        await trySendTelegramReply({
          runId,
          routing: telegramRouting,
          text: buildTelegramFailureReply(runId, message),
          phase: "telegram_reply_failed",
        });
      }
    }
    if (isDevTelegramRun) {
      runLogger.error(
        {
          phase: "dev_telegram_failure_stdout",
          error: message,
          text: buildTelegramFailureReply(runId, message),
        },
        "dev_telegram_failure_stdout",
      );
    }
  } finally {
    if (sandbox) {
      await appendSystemEvent(runId, {
        phase: "sandbox_cleanup",
        sandboxId: sandbox.id,
      });
      runLogger.info({ phase: "sandbox_cleanup", sandboxId: sandbox.id }, "sandbox_cleanup");
    }
    await safeDeleteSandbox(sandbox);
  }
};
