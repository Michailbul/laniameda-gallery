import type { Sandbox } from "@daytonaio/sdk";
import { RUN_EVENT_PHASES } from "../lib/run-phases";
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
  sendTelegramRunReply,
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
}: {
  runId: string;
  telegramStreamSender?: TelegramStreamSender;
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
  };
};

const createTelegramSender = ({
  runId,
  isTelegramRun,
  routing,
}: {
  runId: string;
  isTelegramRun: boolean;
  routing?: TelegramRunRouting;
}) => {
  if (!isTelegramRun || !routing || !workerConfig.telegramBotToken) {
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
  isTelegramRun,
}: {
  runId: string;
  sandbox: Sandbox;
  telegramContext: TelegramRunContext;
  isTelegramRun: boolean;
}) => {
  const mediaCount = telegramContext.envelope?.media?.length ?? 0;
  if (!isTelegramRun || mediaCount === 0 || !telegramContext.envelope) {
    return {
      mediaNotes: [] as string[],
      stagedMedia: [] as StagedTelegramMedia[],
    };
  }

  if (!workerConfig.telegramBotToken) {
    await appendErrorEvent(runId, {
      phase: RUN_EVENT_PHASES.mediaStageFailed,
      reason: "missing_telegram_bot_token",
      failedCount: mediaCount,
    });
    throw new Error("Media staging failed: TELEGRAM_BOT_TOKEN is not configured in worker.");
  }

  const staged = await stageTelegramMediaIntoSandbox({
    sandbox,
    botToken: workerConfig.telegramBotToken,
    envelope: telegramContext.envelope,
    maxBytes: workerConfig.telegramMediaMaxBytes,
    maxDirectBlockBytes: workerConfig.telegramDirectBlockMaxBytes,
    workspaceRoot: SANDBOX_WORKSPACE_ROOT,
  });

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
  isTelegramRun,
  telegramContext,
  mediaNotes,
  stagedMedia,
  telegramStreamSender,
}: {
  runId: string;
  runState: NonNullable<Awaited<ReturnType<typeof convexRuns.getRun>>>;
  sandbox: Sandbox;
  signal: AbortSignal;
  isTelegramRun: boolean;
  telegramContext: TelegramRunContext;
  mediaNotes: string[];
  stagedMedia: StagedTelegramMedia[];
  telegramStreamSender?: TelegramStreamSender;
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
  });
  const useStreamingRuntime = isTelegramRun && workerConfig.streamingMode;
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
}: {
  runId: string;
  runState: NonNullable<Awaited<ReturnType<typeof convexRuns.getRun>>>;
  execution: AgentExecutionResult;
  telegramContext: TelegramRunContext;
}) => {
  if (runState.run.intent !== "ingest") {
    return {
      promptIds: [] as string[],
      assetIds: [] as string[],
      skippedMediaIds: [] as string[],
    };
  }

  if (execution.ingestToolCallCount !== 1 || !execution.ingestPayload) {
    throw new Error("no_ingest_payload");
  }

  const normalizedPayload = normalizePromptPayload(execution.ingestPayload);
  if (normalizedPayload.prompts.length === 0) {
    throw new Error("no_usable_prompt");
  }

  let downloadedMedia: DownloadedTelegramMedia[] = [];
  let skippedMediaIds: string[] = [];
  if (normalizedPayload.selectedTelegramMediaIds.length > 0) {
    if (!telegramContext.envelope) {
      throw new Error("selected_media_requires_telegram_envelope");
    }
    if (!workerConfig.telegramBotToken) {
      throw new Error("selected_media_requires_bot_token");
    }
    const downloaded = await downloadTelegramMediaForIngest({
      botToken: workerConfig.telegramBotToken,
      envelope: telegramContext.envelope,
      selectedMediaIds: normalizedPayload.selectedTelegramMediaIds,
      maxBytes: workerConfig.telegramMediaMaxBytes,
    });
    if (downloaded.failures.length > 0) {
      const message = downloaded.failures.map((entry) => `${entry.mediaId}:${entry.reason}`).join(", ");
      throw new Error(`selected_media_download_failed:${message}`);
    }
    downloadedMedia = downloaded.downloadedMedia;
    skippedMediaIds = downloaded.skippedMediaIds;
  }

  const ingestResult = await convexRuns.ingestAgentPayload({
    runId,
    ownerUserId: runState.run.userId,
    payload: normalizedPayload,
    mediaFiles: downloadedMedia.map(encodeDownloadedMedia),
  });

  await appendSystemEvent(runId, {
    phase: "agent_ingest_applied",
    promptCount: ingestResult.promptIds.length,
    assetCount: ingestResult.assetIds.length,
    skippedMediaCount: skippedMediaIds.length,
  });

  return {
    promptIds: ingestResult.promptIds,
    assetIds: ingestResult.assetIds,
    skippedMediaIds,
  };
};

export const dispatchRun = async (runId: string) => {
  const claim = await convexRuns.claimRun({
    runId,
    workerId: workerConfig.workerId,
  });
  if (!claim.claimed) {
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
  const active = activeRuns.get(runId);
  if (active) {
    active.abortController.abort();
  }
  await convexRuns.cancelRun({ runId, reason });
};

const executeRun = async (runId: string, abortController: AbortController) => {
  let sandbox: Sandbox | undefined;
  let sessionId: string | undefined;
  let telegramRouting: TelegramRunRouting | undefined;
  let telegramStreamSender: TelegramStreamSender | undefined;
  let telegramContext: TelegramRunContext = {};
  let isTelegramRun = false;

  try {
    const runState = await convexRuns.getRun({ runId });
    if (!runState) {
      throw new Error("Run not found before execution.");
    }

    telegramContext = extractTelegramContextFromRunInput(runState.run.input);
    telegramRouting = telegramContext.routing;
    isTelegramRun = runState.run.source === "telegram" || telegramContext.provider === "telegram";
    telegramStreamSender = createTelegramSender({
      runId,
      isTelegramRun,
      routing: telegramRouting,
    });

    const sandboxResult = await createRunSandbox({
      runId,
      userId: runState.run.userId,
    });
    sandbox = sandboxResult.sandbox;
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

    const media = await prepareTelegramMedia({
      runId,
      sandbox,
      telegramContext,
      isTelegramRun,
    });
    const execution = await runAgent({
      runId,
      runState,
      sandbox,
      signal: abortController.signal,
      isTelegramRun,
      telegramContext,
      mediaNotes: media.mediaNotes,
      stagedMedia: media.stagedMedia,
      telegramStreamSender,
    });
    sessionId = execution.sessionId;
    const ingestResult = await applyAgentIngestPayload({
      runId,
      runState,
      execution,
      telegramContext,
    });

    await finalizeRun({
      runId,
      sandbox,
      sessionId,
      resultText: execution.resultText,
      ingestResult,
    });

    if (isTelegramRun) {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown worker execution error.";
    const wasAborted = abortController.signal.aborted;
    if (wasAborted) {
      await convexRuns.cancelRun({
        runId,
        reason: message || "Run canceled.",
      });
      if (isTelegramRun) {
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
      return;
    }
    await convexRuns.failRun({
      runId,
      workerId: workerConfig.workerId,
      sessionId,
      error: message,
    });
    if (isTelegramRun) {
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
  } finally {
    if (sandbox) {
      await appendSystemEvent(runId, {
        phase: "sandbox_cleanup",
        sandboxId: sandbox.id,
      });
    }
    await safeDeleteSandbox(sandbox);
  }
};
