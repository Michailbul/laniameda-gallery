import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { RUN_EVENT_PHASES } from "@/lib/run-phases";

type RunStatus =
  | "queued"
  | "claimed"
  | "running"
  | "waiting_input"
  | "completed"
  | "failed"
  | "canceled";

type RunRecord = {
  _id: string;
  _creationTime: number;
  userId: string;
  intent: string;
  source: string;
  status: RunStatus;
  input?: unknown;
  idempotencyKey?: string;
  workerId?: string;
  workerClaimedAt?: number;
  sessionId?: string;
  sandboxId?: string;
  sandboxLabel?: string;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
};

type StageMediaResult = {
  stagedPaths: string[];
  mediaNotes: string[];
  stagedMedia: Array<Record<string, unknown>>;
  failures: Array<{ mediaId: string; reason: string }>;
};

type DownloadMediaResult = {
  downloadedMedia: Array<{
    mediaId: string;
    kind: string;
    mimeType?: string;
    fileName?: string;
    sizeBytes: number;
    buffer: Buffer;
  }>;
  failures: Array<{ mediaId: string; reason: string }>;
  skippedMediaIds: string[];
};

type WorkerDispatchResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
    };

const makeUpdate = ({
  updateId = 1001,
  messageId = 2001,
  text = "hello from test",
  withMedia = false,
}: {
  updateId?: number;
  messageId?: number;
  text?: string;
  withMedia?: boolean;
}) => {
  return {
    update_id: updateId,
    message: {
      message_id: messageId,
      chat: { id: 278674008, type: "private" as const },
      from: { id: 278674008, first_name: "Michail" },
      text,
      ...(withMedia
        ? {
            photo: [{ file_id: "photo-1", file_size: 12345 }],
            document: {
              file_id: "doc-1",
              file_name: "brief.pdf",
              mime_type: "application/pdf",
              file_size: 22222,
            },
          }
        : {}),
    },
  };
};

const state = {
  runSeq: 0,
  eventSeqByRunId: new Map<string, number>(),
  runsById: new Map<string, RunRecord>(),
  eventsByRunId: new Map<string, Array<{ runId: string; type: string; payload?: unknown; seq: number }>>(),
  artifactsByRunId: new Map<string, Array<Record<string, unknown>>>(),
  idempotencyToRunId: new Map<string, string>(),
  dispatchCalls: [] as string[],
  replies: [] as Array<{ chatId: string; text: string }>,
  runtimeMessages: [] as Array<Record<string, unknown>>,
  ingestCalls: [] as Array<Record<string, unknown>>,
  runtimeStreamingImpl: async ({
    messages,
    onEvent,
  }: {
    messages: Array<Record<string, unknown>>;
    onEvent: (
      type: "stream_text" | "tool_call" | "tool_result" | "status_change" | "error",
      payload: Record<string, unknown>,
    ) => Promise<void>;
  }) => {
    state.runtimeMessages = messages;
    await onEvent("status_change", { phase: RUN_EVENT_PHASES.streamInit });
    await onEvent("stream_text", { phase: RUN_EVENT_PHASES.streamChunk, textDelta: "hello " });
    await onEvent("stream_text", { phase: RUN_EVENT_PHASES.streamChunk, textDelta: "world" });
    return {
      resultText: "streaming-result",
      sessionId: "session-1",
      ingestToolCallCount: 1,
      ingestPayload: {
        prompts: [
          {
            final_prompt: "cinematic close-up portrait",
            tags: ["portrait"],
          },
        ],
        selectedTelegramMediaIds: [],
        selectedUrls: [],
      },
    };
  },
  stageMediaImpl: async (): Promise<StageMediaResult> => ({
    stagedPaths: [],
    mediaNotes: [],
    stagedMedia: [],
    failures: [],
  }),
  downloadMediaImpl: async (): Promise<DownloadMediaResult> => ({
    downloadedMedia: [],
    failures: [],
    skippedMediaIds: [],
  }),
  dispatchImpl: async (_payload: { runId: string }): Promise<WorkerDispatchResult> => ({
    ok: true as const,
  }),
  pendingTerminalResolvers: new Map<string, Array<() => void>>(),
  pendingReplyResolvers: [] as Array<() => void>,
  clear() {
    this.runSeq = 0;
    this.eventSeqByRunId.clear();
    this.runsById.clear();
    this.eventsByRunId.clear();
    this.artifactsByRunId.clear();
    this.idempotencyToRunId.clear();
    this.dispatchCalls = [];
    this.replies = [];
    this.runtimeMessages = [];
    this.ingestCalls = [];
    this.runtimeStreamingImpl = async ({ messages, onEvent }) => {
      state.runtimeMessages = messages;
      await onEvent("status_change", { phase: RUN_EVENT_PHASES.streamInit });
      await onEvent("stream_text", { phase: RUN_EVENT_PHASES.streamChunk, textDelta: "hello " });
      await onEvent("stream_text", { phase: RUN_EVENT_PHASES.streamChunk, textDelta: "world" });
      return {
        resultText: "streaming-result",
        sessionId: "session-1",
        ingestToolCallCount: 1,
        ingestPayload: {
          prompts: [{ final_prompt: "cinematic close-up portrait", tags: ["portrait"] }],
          selectedTelegramMediaIds: [],
          selectedUrls: [],
        },
      };
    };
    this.pendingTerminalResolvers.clear();
    this.pendingReplyResolvers = [];
    this.stageMediaImpl = async () => ({
      stagedPaths: [],
      mediaNotes: [],
      stagedMedia: [],
      failures: [],
    });
    this.downloadMediaImpl = async () => ({
      downloadedMedia: [],
      failures: [],
      skippedMediaIds: [],
    });
    this.dispatchImpl = async () => ({ ok: true as const });
  },
  appendEvent(args: { runId: string; type: string; payload?: unknown }) {
    const nextSeq = (this.eventSeqByRunId.get(args.runId) ?? 0) + 1;
    this.eventSeqByRunId.set(args.runId, nextSeq);
    const events = this.eventsByRunId.get(args.runId) ?? [];
    events.push({ ...args, seq: nextSeq });
    this.eventsByRunId.set(args.runId, events);
  },
  resolveTerminal(runId: string) {
    const resolvers = this.pendingTerminalResolvers.get(runId) ?? [];
    for (const resolve of resolvers) {
      resolve();
    }
    this.pendingTerminalResolvers.delete(runId);
  },
  waitForTerminal(runId: string) {
    const run = this.runsById.get(runId);
    if (run && (run.status === "completed" || run.status === "failed" || run.status === "canceled")) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const pending = this.pendingTerminalResolvers.get(runId) ?? [];
      pending.push(resolve);
      this.pendingTerminalResolvers.set(runId, pending);
    });
  },
  resolveReplyWaiters() {
    for (const resolve of this.pendingReplyResolvers) {
      resolve();
    }
    this.pendingReplyResolvers = [];
  },
  waitForReplies(minCount: number) {
    if (this.replies.length >= minCount) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.pendingReplyResolvers.push(resolve);
    });
  },
};

const agentWorkerConvexClientPath = new URL("../agent-worker/convex-client.ts", import.meta.url).pathname;
const agentWorkerDaytonaPath = new URL("../agent-worker/daytona.ts", import.meta.url).pathname;
const agentWorkerRuntimePath = new URL("../agent-worker/agent-runtime.ts", import.meta.url).pathname;
const agentWorkerTelegramPath = new URL("../agent-worker/telegram.ts", import.meta.url).pathname;
const agentWorkerTelegramStreamPath = new URL("../agent-worker/telegram-stream.ts", import.meta.url).pathname;
const agentWorkerConfigPath = new URL("../agent-worker/config.ts", import.meta.url).pathname;

mock.module("@/lib/ai/convex-runs", () => ({
  convexRuns: {
    createRun: async (args: Record<string, unknown>) => {
      const userId = String(args.userId ?? "");
      const idempotencyKey = typeof args.idempotencyKey === "string" ? args.idempotencyKey : undefined;
      if (idempotencyKey) {
        const existing = state.idempotencyToRunId.get(idempotencyKey);
        if (existing) {
          return { runId: existing, created: false, status: state.runsById.get(existing)?.status ?? "queued" };
        }
      }

      state.runSeq += 1;
      const runId = `run-${state.runSeq}`;
      const now = Date.now();
      const run: RunRecord = {
        _id: runId,
        _creationTime: now,
        userId,
        intent: String(args.intent ?? "ingest"),
        source: String(args.source ?? "telegram"),
        status: "queued",
        input: args.input,
        idempotencyKey,
        createdAt: now,
        updatedAt: now,
      };
      state.runsById.set(runId, run);
      state.eventsByRunId.set(runId, []);
      state.artifactsByRunId.set(runId, []);
      if (idempotencyKey) {
        state.idempotencyToRunId.set(idempotencyKey, runId);
      }
      state.appendEvent({
        runId,
        type: "status_change",
        payload: { status: "queued" },
      });
      return { runId, created: true, status: "queued" };
    },
    appendRunEvent: async (args: { runId: string; type: string; payload?: unknown }) => {
      state.appendEvent(args);
      return { eventId: `${args.runId}-event-${state.eventSeqByRunId.get(args.runId)}`, seq: state.eventSeqByRunId.get(args.runId) ?? 1 };
    },
    failRun: async (args: { runId: string; error: string }) => {
      const run = state.runsById.get(args.runId);
      if (!run) throw new Error("run missing");
      run.status = "failed";
      run.lastError = args.error;
      run.updatedAt = Date.now();
      state.appendEvent({
        runId: args.runId,
        type: "error",
        payload: { message: args.error },
      });
      state.resolveTerminal(args.runId);
      return { runId: args.runId, status: "failed" };
    },
  },
}));

mock.module("@/lib/ai/worker-dispatch", () => ({
  dispatchRunToWorker: async (payload: { runId: string }) => {
    state.dispatchCalls.push(payload.runId);
    return state.dispatchImpl(payload);
  },
  cancelRunInWorker: async () => {},
}));

mock.module(agentWorkerConfigPath, () => ({
  workerConfig: {
    port: 8797,
    workerId: "worker-test",
    convexUrl: "https://convex.test",
    sharedSecret: "test-shared-secret",
    claudeModel: "claude-sonnet-4-5",
    maxTurns: 8,
    dummyMode: false,
    streamingMode: true,
    streamingSingleFallback: false,
    allowedTools: ["Read", "Write", "Bash"],
    gatewayApiKey: "gateway-key",
    gatewayBaseUrl: "https://ai-gateway.vercel.sh",
    skillsEnabled: true,
    settingSources: ["project"],
    daytonaApiKey: "daytona-key",
    daytonaApiUrl: "https://daytona.test",
    daytonaTarget: "target",
    sandboxAutoStopMinutes: 10,
    telegramBotToken: "bot-token",
    telegramMediaMaxBytes: 20_000_000,
    telegramDirectBlockMaxBytes: 5_000_000,
    agentWorkspaceCwd: "/workspace",
    agentAdditionalDirectories: [],
    sandboxNodeCommand: "node",
  },
}));

mock.module(agentWorkerConvexClientPath, () => ({
  convexRuns: {
    claimRun: async ({ runId, workerId }: { runId: string; workerId: string }) => {
      const run = state.runsById.get(runId);
      if (!run) throw new Error("run missing");
      if (run.status !== "queued") {
        return { runId, claimed: false, status: run.status };
      }
      run.status = "claimed";
      run.workerId = workerId;
      run.workerClaimedAt = Date.now();
      run.updatedAt = Date.now();
      state.appendEvent({ runId, type: "status_change", payload: { status: "claimed", workerId } });
      return { runId, claimed: true, status: "claimed" };
    },
    setRunRunning: async ({
      runId,
      workerId,
      sandboxId,
      sandboxLabel,
    }: {
      runId: string;
      workerId: string;
      sandboxId?: string;
      sandboxLabel?: string;
    }) => {
      const run = state.runsById.get(runId);
      if (!run) throw new Error("run missing");
      run.status = "running";
      run.workerId = workerId;
      run.sandboxId = sandboxId;
      run.sandboxLabel = sandboxLabel;
      run.updatedAt = Date.now();
      state.appendEvent({ runId, type: "status_change", payload: { status: "running", sandboxId } });
      return { runId, status: "running" };
    },
    appendRunEvent: async (args: { runId: string; type: string; payload?: unknown }) => {
      state.appendEvent(args);
      return { eventId: `${args.runId}-event-${state.eventSeqByRunId.get(args.runId)}`, seq: state.eventSeqByRunId.get(args.runId) ?? 1 };
    },
    completeRun: async ({
      runId,
      workerId,
      sessionId,
      artifacts,
    }: {
      runId: string;
      workerId?: string;
      sessionId?: string;
      artifacts?: Array<Record<string, unknown>>;
    }) => {
      const run = state.runsById.get(runId);
      if (!run) throw new Error("run missing");
      run.status = "completed";
      run.workerId = workerId ?? run.workerId;
      run.sessionId = sessionId;
      run.updatedAt = Date.now();
      state.artifactsByRunId.set(runId, artifacts ?? []);
      state.appendEvent({ runId, type: "status_change", payload: { status: "completed" } });
      state.resolveTerminal(runId);
      return { runId, status: "completed", artifactIds: [] };
    },
    failRun: async ({ runId, error }: { runId: string; error: string }) => {
      const run = state.runsById.get(runId);
      if (!run) throw new Error("run missing");
      run.status = "failed";
      run.lastError = error;
      run.updatedAt = Date.now();
      state.appendEvent({ runId, type: "error", payload: { message: error } });
      state.resolveTerminal(runId);
      return { runId, status: "failed" };
    },
    cancelRun: async ({ runId, reason }: { runId: string; reason?: string }) => {
      const run = state.runsById.get(runId);
      if (!run) throw new Error("run missing");
      run.status = "canceled";
      run.lastError = reason;
      run.updatedAt = Date.now();
      state.appendEvent({ runId, type: "status_change", payload: { status: "canceled" } });
      state.resolveTerminal(runId);
      return { runId, status: "canceled" };
    },
    getRun: async ({ runId }: { runId: string }) => {
      const run = state.runsById.get(runId);
      if (!run) return null;
      return {
        run,
        events: state.eventsByRunId.get(runId) ?? [],
        artifacts: state.artifactsByRunId.get(runId) ?? [],
      };
    },
    ingestAgentPayload: async (args: Record<string, unknown>) => {
      state.ingestCalls.push(args);
      return {
        promptIds: ["prompt-1"],
        assetIds: ["asset-1"],
        skippedMediaIds: [],
      };
    },
  },
}));

mock.module(agentWorkerDaytonaPath, () => ({
  createRunSandbox: async ({ runId }: { runId: string }) => ({
    sandbox: {
      id: `sandbox-${runId}`,
      fs: {
        createFolder: async () => {},
        uploadFile: async () => {},
      },
    },
    sandboxLabel: `sandbox-${runId}`,
  }),
  safeDeleteSandbox: async () => {},
}));

mock.module(agentWorkerRuntimePath, () => ({
  SANDBOX_WORKSPACE_ROOT: ".agent-runtime/workspace",
  executeClaudeRunStreamingInSandbox: async ({
    messages,
    onEvent,
  }: {
    messages: Array<Record<string, unknown>>;
    onEvent: (
      type: "stream_text" | "tool_call" | "tool_result" | "status_change" | "error",
      payload: Record<string, unknown>,
    ) => Promise<void>;
  }) => state.runtimeStreamingImpl({ messages, onEvent }),
  executeClaudeRun: async () => ({
    resultText: "single-result",
    sessionId: "session-single",
    ingestToolCallCount: 0,
  }),
}));

mock.module(agentWorkerTelegramPath, () => ({
  buildDummyPromptPackage: () => "dummy-result",
  extractTelegramContextFromRunInput: (input: unknown) => {
    const payload = (input || {}) as Record<string, unknown>;
    const envelope = (payload.envelope || undefined) as Record<string, unknown> | undefined;
    const routing = (payload.routing || undefined) as Record<string, unknown> | undefined;
    return {
      provider: payload.provider === "telegram" ? "telegram" : undefined,
      envelope:
        envelope && envelope.provider === "telegram"
          ? {
              provider: "telegram",
              chatId: String(envelope.chatId ?? ""),
              messageId: String(envelope.messageId ?? ""),
              chatType: "direct",
              media: Array.isArray(envelope.media) ? envelope.media : undefined,
            }
          : undefined,
      routing: routing
        ? {
            chatId: String(routing.chatId ?? ""),
            replyToMessageId: Number(routing.replyToMessageId ?? 0) || undefined,
            threadId: Number(routing.threadId ?? 0) || undefined,
            chatType: "direct",
          }
        : undefined,
    };
  },
  stageTelegramMediaIntoSandbox: async () => state.stageMediaImpl(),
  downloadTelegramMediaForIngest: async () => state.downloadMediaImpl(),
  sendTelegramRunReply: async ({
    routing,
    text,
  }: {
    routing: { chatId: string };
    text: string;
  }) => {
    state.replies.push({ chatId: routing.chatId, text });
    state.resolveReplyWaiters();
  },
}));

mock.module(agentWorkerTelegramStreamPath, () => ({
  createTelegramStreamSender: ({ routing }: { routing: { chatId: string } }) => {
    let text = "";
    return {
      appendTextDelta: (delta: string) => {
        text += delta;
      },
      flush: async () => {},
      complete: async (finalText: string) => {
        state.replies.push({ chatId: routing.chatId, text: finalText || text });
        state.resolveReplyWaiters();
      },
      fail: async (fallbackText: string) => {
        state.replies.push({ chatId: routing.chatId, text: fallbackText });
        state.resolveReplyWaiters();
      },
    };
  },
}));

mock.module("@workos-inc/authkit-nextjs", () => ({
  withAuth: async () => ({ user: null }),
}));

let routePost: (request: Request) => Promise<Response>;
let devSimRoutePost: (request: Request) => Promise<Response>;
let dispatchRun: (runId: string) => Promise<{ accepted: boolean; status: string }>;
const previousEnv = {
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
  TELEGRAM_WEBHOOK_MAX_BODY_BYTES: process.env.TELEGRAM_WEBHOOK_MAX_BODY_BYTES,
  TELEGRAM_WEBHOOK_BODY_TIMEOUT_MS: process.env.TELEGRAM_WEBHOOK_BODY_TIMEOUT_MS,
  DEV_TELEGRAM_SIM_ENABLED: process.env.DEV_TELEGRAM_SIM_ENABLED,
  DEV_TELEGRAM_SIM_AUTH_BYPASS: process.env.DEV_TELEGRAM_SIM_AUTH_BYPASS,
};

beforeAll(async () => {
  process.env.TELEGRAM_WEBHOOK_SECRET = "telegram-secret";
  process.env.TELEGRAM_WEBHOOK_MAX_BODY_BYTES = "1000000";
  process.env.TELEGRAM_WEBHOOK_BODY_TIMEOUT_MS = "30000";
  process.env.DEV_TELEGRAM_SIM_ENABLED = "true";
  process.env.DEV_TELEGRAM_SIM_AUTH_BYPASS = "true";

  const routeModule = await import("@/app/api/telegram/webhook/route");
  routePost = routeModule.POST;
  const devSimRouteModule = await import("@/app/api/dev/telegram/simulate/route");
  devSimRoutePost = devSimRouteModule.POST;

  const orchestratorModule = await import("@/agent-worker/orchestrator");
  dispatchRun = orchestratorModule.dispatchRun;
});

afterAll(() => {
  process.env.TELEGRAM_WEBHOOK_SECRET = previousEnv.TELEGRAM_WEBHOOK_SECRET;
  process.env.TELEGRAM_WEBHOOK_MAX_BODY_BYTES = previousEnv.TELEGRAM_WEBHOOK_MAX_BODY_BYTES;
  process.env.TELEGRAM_WEBHOOK_BODY_TIMEOUT_MS = previousEnv.TELEGRAM_WEBHOOK_BODY_TIMEOUT_MS;
  process.env.DEV_TELEGRAM_SIM_ENABLED = previousEnv.DEV_TELEGRAM_SIM_ENABLED;
  process.env.DEV_TELEGRAM_SIM_AUTH_BYPASS = previousEnv.DEV_TELEGRAM_SIM_AUTH_BYPASS;
  mock.restore();
});

beforeEach(() => {
  state.clear();
});

describe("Telegram streaming integration harness", () => {
  test("webhook -> worker dispatch -> sandbox streaming -> run complete", async () => {
    state.dispatchImpl = async ({ runId }) => {
      const result = await dispatchRun(runId);
      if (!result.accepted) {
        return { ok: false as const, error: `Run was not accepted: ${result.status}` };
      }
      await state.waitForTerminal(runId);
      return { ok: true as const };
    };

    const response = await routePost(
      new Request("http://localhost/api/telegram/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "telegram-secret",
        },
        body: JSON.stringify(makeUpdate({ updateId: 9001, messageId: 101 })),
      }),
    );
    const body = await response.json();
    await state.waitForReplies(1);

    expect(response.status).toBe(200);
    expect(body.ok).toBeTrue();
    expect(body.duplicate).toBeFalse();
    expect(state.dispatchCalls.length).toBe(1);

    const run = state.runsById.get(body.runId);
    expect(run?.status).toBe("completed");
    const events = state.eventsByRunId.get(body.runId) ?? [];
    expect(
      events.some(
        (event) =>
          (event.payload as Record<string, unknown>)?.phase === RUN_EVENT_PHASES.sandboxAgentStarted,
      ),
    ).toBeTrue();
    expect(
      events.some(
        (event) =>
          (event.payload as Record<string, unknown>)?.phase === RUN_EVENT_PHASES.streamChunk,
      ),
    ).toBeTrue();
    expect(
      events.some(
        (event) =>
          (event.payload as Record<string, unknown>)?.phase === RUN_EVENT_PHASES.sandboxAgentFinished,
      ),
    ).toBeTrue();
    expect(state.replies.length).toBe(1);
    expect(state.replies[0]?.text).toContain("streaming-result");
    expect(state.ingestCalls.length).toBe(1);
    expect((state.ingestCalls[0]?.ownerUserId as string | undefined) ?? "").toContain("telegram:");
  });

  test("dev simulate route -> worker dispatch -> run complete without telegram reply send", async () => {
    state.dispatchImpl = async ({ runId }) => {
      const result = await dispatchRun(runId);
      if (!result.accepted) {
        return { ok: false as const, error: `Run was not accepted: ${result.status}` };
      }
      await state.waitForTerminal(runId);
      return { ok: true as const };
    };

    const formData = new FormData();
    formData.set("chatId", "dev-chat-1");
    formData.set("messageId", "1001");
    formData.set("text", "simulate dev telegram flow");

    const response = await devSimRoutePost(
      new Request("http://localhost/api/dev/telegram/simulate", {
        method: "POST",
        body: formData,
      }),
    );

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ok).toBeTrue();

    const run = state.runsById.get(body.runId);
    expect(run?.source).toBe("dev_telegram");
    expect(run?.status).toBe("completed");
    expect(state.replies.length).toBe(0);
    expect(state.ingestCalls.length).toBe(1);
    expect(state.dispatchCalls.length).toBe(1);
  });

  test("duplicate Telegram update does not create a duplicate run", async () => {
    state.dispatchImpl = async ({ runId }) => {
      const result = await dispatchRun(runId);
      if (!result.accepted) {
        return { ok: false as const, error: `Run was not accepted: ${result.status}` };
      }
      await state.waitForTerminal(runId);
      return { ok: true as const };
    };

    const requestBody = JSON.stringify(makeUpdate({ updateId: 9002, messageId: 102 }));
    const requestInit = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "telegram-secret",
      },
      body: requestBody,
    };

    const first = await routePost(new Request("http://localhost/api/telegram/webhook", requestInit));
    const firstBody = await first.json();
    const second = await routePost(new Request("http://localhost/api/telegram/webhook", requestInit));
    const secondBody = await second.json();

    expect(firstBody.duplicate).toBeFalse();
    expect(secondBody.duplicate).toBeTrue();
    expect(firstBody.runId).toBe(secondBody.runId);
    expect(state.runsById.size).toBe(1);
    expect(state.dispatchCalls.length).toBe(1);
  });

  test("missing submit_ingest_payload fails run with no_ingest_payload", async () => {
    state.runtimeStreamingImpl = async ({ messages, onEvent }) => {
      state.runtimeMessages = messages;
      await onEvent("status_change", { phase: RUN_EVENT_PHASES.streamInit });
      await onEvent("stream_text", { phase: RUN_EVENT_PHASES.streamChunk, textDelta: "partial" });
      return {
        resultText: "partial",
        sessionId: "session-1",
        ingestToolCallCount: 0,
        ingestPayload: {
          prompts: [],
          selectedTelegramMediaIds: [],
          selectedUrls: [],
        },
      };
    };

    state.dispatchImpl = async ({ runId }) => {
      const result = await dispatchRun(runId);
      if (!result.accepted) {
        return { ok: false as const, error: `Run was not accepted: ${result.status}` };
      }
      await state.waitForTerminal(runId);
      return { ok: true as const };
    };

    const response = await routePost(
      new Request("http://localhost/api/telegram/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "telegram-secret",
        },
        body: JSON.stringify(makeUpdate({ updateId: 9010, messageId: 110 })),
      }),
    );
    const body = await response.json();
    await state.waitForReplies(1);

    expect(response.status).toBe(200);
    const run = state.runsById.get(body.runId);
    expect(run?.status).toBe("failed");
    expect(run?.lastError).toContain("no_ingest_payload");
    expect(state.replies[0]?.text).toContain("no_ingest_payload");
  });

  test("failed media staging marks run as failed and emits media_stage_failed", async () => {
    state.stageMediaImpl = async () => ({
      stagedPaths: [],
      mediaNotes: ["[media unavailable: photo-1 (file exceeds 20000000 bytes)]"],
      stagedMedia: [],
      failures: [{ mediaId: "photo-1", reason: "file exceeds 20000000 bytes" }],
    });

    state.dispatchImpl = async ({ runId }) => {
      const result = await dispatchRun(runId);
      if (!result.accepted) {
        return { ok: false as const, error: `Run was not accepted: ${result.status}` };
      }
      await state.waitForTerminal(runId);
      return { ok: true as const };
    };

    const response = await routePost(
      new Request("http://localhost/api/telegram/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "telegram-secret",
        },
        body: JSON.stringify(makeUpdate({ updateId: 9003, messageId: 103, withMedia: true })),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    const run = state.runsById.get(body.runId);
    expect(run?.status).toBe("failed");
    expect(run?.lastError).toContain("Media staging failed");
    const events = state.eventsByRunId.get(body.runId) ?? [];
    expect(
      events.some(
        (event) =>
          event.type === "error" &&
          (event.payload as Record<string, unknown>)?.phase === RUN_EVENT_PHASES.mediaStageFailed,
      ),
    ).toBeTrue();
  });

  test("successful media run sends image/document direct blocks to streaming runtime", async () => {
    state.stageMediaImpl = async () => ({
      stagedPaths: ["media/inbound/104/01-file.jpg", "media/inbound/104/02-file.pdf"],
      mediaNotes: [
        "[media attached: media/inbound/104/01-file.jpg (image/jpeg)]",
        "[media attached: media/inbound/104/02-file.pdf (application/pdf)]",
      ],
      stagedMedia: [
        {
          mediaId: "photo-1",
          kind: "image",
          mimeType: "image/jpeg",
          relativePath: "media/inbound/104/01-file.jpg",
          directContentBlock: {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: "img-data" },
          },
        },
        {
          mediaId: "doc-1",
          kind: "document",
          mimeType: "application/pdf",
          relativePath: "media/inbound/104/02-file.pdf",
          directContentBlock: {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: "pdf-data" },
            title: "brief.pdf",
          },
        },
      ],
      failures: [],
    });

    state.dispatchImpl = async ({ runId }) => {
      const result = await dispatchRun(runId);
      if (!result.accepted) {
        return { ok: false as const, error: `Run was not accepted: ${result.status}` };
      }
      await state.waitForTerminal(runId);
      return { ok: true as const };
    };

    const response = await routePost(
      new Request("http://localhost/api/telegram/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "telegram-secret",
        },
        body: JSON.stringify(makeUpdate({ updateId: 9004, messageId: 104, withMedia: true })),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    const run = state.runsById.get(body.runId);
    expect(run?.status).toBe("completed");

    const firstMessage = state.runtimeMessages[0] as { message?: { content?: Array<Record<string, unknown>> } };
    const content = firstMessage?.message?.content ?? [];
    expect(content.some((block) => block.type === "image")).toBeTrue();
    expect(content.some((block) => block.type === "document")).toBeTrue();
  });
});
