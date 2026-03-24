import { ConvexError, v } from "convex/values";
import { mutation, query, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { RUN_EVENT_PHASES as SHARED_RUN_EVENT_PHASES } from "../lib/run-phases";

type RunStatus =
  | "queued"
  | "claimed"
  | "running"
  | "waiting_input"
  | "completed"
  | "failed"
  | "canceled";

const runStatusValidator = v.union(
  v.literal("queued"),
  v.literal("claimed"),
  v.literal("running"),
  v.literal("waiting_input"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("canceled"),
);

const runIntentValidator = v.union(
  v.literal("creator_assist"),
  v.literal("transfer_style"),
  v.literal("transfer_pose"),
  v.literal("replace_character"),
  v.literal("ingest"),
  v.literal("execute"),
  v.literal("creator_assist"),
);

const runSourceValidator = v.union(
  v.literal("dashboard"),
  v.literal("canvas"),
  v.literal("telegram"),
  v.literal("dev_telegram"),
  v.literal("api"),
  v.literal("canvas"),
);

const runRuntimeValidator = v.union(v.literal("ai_sdk"), v.literal("agent_worker"));

const runProviderValidator = v.union(v.literal("gateway"), v.literal("provider_direct"));

const runModeValidator = v.union(v.literal("prompt_package"), v.literal("image_generate"));

const runUsageValidator = v.object({
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  totalTokens: v.optional(v.number()),
  estimatedCostUsd: v.optional(v.number()),
});

const runEventTypeValidator = v.union(
  v.literal("stream_text"),
  v.literal("tool_call"),
  v.literal("tool_result"),
  v.literal("approval_request"),
  v.literal("error"),
  v.literal("status_change"),
  v.literal("system"),
);

export const RUN_EVENT_PHASES = SHARED_RUN_EVENT_PHASES;

const runValidator = v.object({
  _id: v.id("runs"),
  _creationTime: v.number(),
  userId: v.string(),
  runtime: v.optional(runRuntimeValidator),
  provider: v.optional(runProviderValidator),
  model: v.optional(v.string()),
  mode: v.optional(runModeValidator),
  status: runStatusValidator,
  intent: runIntentValidator,
  source: runSourceValidator,
  sourceChatId: v.optional(v.string()),
  sourceThreadId: v.optional(v.string()),
  sourceMessageId: v.optional(v.string()),
  sourceUpdateId: v.optional(v.number()),
  input: v.optional(v.any()),
  idempotencyKey: v.optional(v.string()),
  workerId: v.optional(v.string()),
  workerClaimedAt: v.optional(v.number()),
  sessionId: v.optional(v.string()),
  sandboxId: v.optional(v.string()),
  sandboxLabel: v.optional(v.string()),
  canceledAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  failedAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
  usage: v.optional(runUsageValidator),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const runEventValidator = v.object({
  _id: v.id("run_events"),
  _creationTime: v.number(),
  runId: v.id("runs"),
  type: runEventTypeValidator,
  seq: v.number(),
  payload: v.optional(v.any()),
  createdAt: v.number(),
});

const runArtifactValidator = v.object({
  _id: v.id("run_artifacts"),
  _creationTime: v.number(),
  runId: v.id("runs"),
  kind: v.union(
    v.literal("prompt_package"),
    v.literal("image"),
    v.literal("text"),
    v.literal("json"),
    v.literal("other"),
  ),
  mimeType: v.optional(v.string()),
  storageId: v.optional(v.id("_storage")),
  textContent: v.optional(v.string()),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
});

const getLastEventSeq = async (ctx: MutationCtx, runId: Id<"runs">) => {
  const [lastEvent] = await ctx.db
    .query("run_events")
    .withIndex("by_run_seq", (q) => q.eq("runId", runId).gte("seq", 0))
    .order("desc")
    .take(1);
  return lastEvent?.seq ?? 0;
};

const insertStatusEvent = async (
  ctx: MutationCtx,
  runId: Id<"runs">,
  status: string,
  metadata?: Record<string, unknown>,
) => {
  const seq = (await getLastEventSeq(ctx, runId)) + 1;
  await ctx.db.insert("run_events", {
    runId,
    type: "status_change",
    seq,
    payload: {
      status,
      ...metadata,
    },
    createdAt: Date.now(),
  });
};

export const createRun = mutation({
  args: {
    userId: v.string(),
    intent: runIntentValidator,
    source: runSourceValidator,
    sourceChatId: v.optional(v.string()),
    sourceThreadId: v.optional(v.string()),
    sourceMessageId: v.optional(v.string()),
    sourceUpdateId: v.optional(v.number()),
    input: v.optional(v.any()),
    idempotencyKey: v.optional(v.string()),
    runtime: v.optional(runRuntimeValidator),
    provider: v.optional(runProviderValidator),
    model: v.optional(v.string()),
    mode: v.optional(runModeValidator),
  },
  returns: v.object({
    runId: v.id("runs"),
    created: v.boolean(),
    status: runStatusValidator,
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ runId: Id<"runs">; created: boolean; status: RunStatus }> => {
    const userId = args.userId.trim();
    if (!userId) {
      throw new ConvexError("userId is required.");
    }
    const idempotencyKey = args.idempotencyKey?.trim();
    if (idempotencyKey) {
      const existing = await ctx.db
        .query("runs")
        .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", idempotencyKey))
        .unique();
      if (existing) {
        return { runId: existing._id, created: false, status: existing.status as RunStatus };
      }
    }

    const now = Date.now();
    const runId = await ctx.db.insert("runs", {
      userId,
      status: "queued",
      intent: args.intent,
      source: args.source,
      sourceChatId: args.sourceChatId,
      sourceThreadId: args.sourceThreadId,
      sourceMessageId: args.sourceMessageId,
      sourceUpdateId: args.sourceUpdateId,
      input: args.input,
      idempotencyKey,
      runtime: args.runtime,
      provider: args.provider,
      model: args.model,
      mode: args.mode,
      createdAt: now,
      updatedAt: now,
    });
    await insertStatusEvent(ctx, runId, "queued");

    return { runId, created: true, status: "queued" };
  },
});

export const claimRun = mutation({
  args: {
    runId: v.id("runs"),
    workerId: v.string(),
  },
  returns: v.object({
    runId: v.id("runs"),
    claimed: v.boolean(),
    status: runStatusValidator,
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ runId: Id<"runs">; claimed: boolean; status: RunStatus }> => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      throw new ConvexError("Run not found.");
    }

    if (run.status === "queued") {
      const now = Date.now();
      await ctx.db.patch(args.runId, {
        status: "claimed",
        workerId: args.workerId,
        workerClaimedAt: now,
        updatedAt: now,
      });
      await insertStatusEvent(ctx, args.runId, "claimed", {
        workerId: args.workerId,
      });
      return { runId: args.runId, claimed: true, status: "claimed" };
    }

    return { runId: args.runId, claimed: false, status: run.status as RunStatus };
  },
});

export const setRunRunning = mutation({
  args: {
    runId: v.id("runs"),
    workerId: v.string(),
    sandboxId: v.optional(v.string()),
    sandboxLabel: v.optional(v.string()),
  },
  returns: v.object({
    runId: v.id("runs"),
    status: runStatusValidator,
  }),
  handler: async (ctx, args): Promise<{ runId: Id<"runs">; status: RunStatus }> => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      throw new ConvexError("Run not found.");
    }
    if (run.workerId && run.workerId !== args.workerId) {
      throw new ConvexError("Run is owned by a different worker.");
    }
    if (run.status === "completed" || run.status === "failed" || run.status === "canceled") {
      return { runId: args.runId, status: run.status as RunStatus };
    }

    const now = Date.now();
    await ctx.db.patch(args.runId, {
      status: "running",
      workerId: args.workerId,
      sandboxId: args.sandboxId,
      sandboxLabel: args.sandboxLabel,
      updatedAt: now,
    });
    await insertStatusEvent(ctx, args.runId, "running", {
      workerId: args.workerId,
      sandboxId: args.sandboxId,
    });

    return { runId: args.runId, status: "running" };
  },
});

export const appendRunEvent = mutation({
  args: {
    runId: v.id("runs"),
    type: runEventTypeValidator,
    payload: v.optional(v.any()),
    seq: v.optional(v.number()),
  },
  returns: v.object({
    eventId: v.id("run_events"),
    seq: v.number(),
  }),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      throw new ConvexError("Run not found.");
    }

    const seq = args.seq ?? ((await getLastEventSeq(ctx, args.runId)) + 1);
    const eventId = await ctx.db.insert("run_events", {
      runId: args.runId,
      type: args.type,
      seq,
      payload: args.payload,
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.runId, { updatedAt: Date.now() });

    return { eventId, seq };
  },
});

export const completeRun = mutation({
  args: {
    runId: v.id("runs"),
    workerId: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    usage: v.optional(runUsageValidator),
    artifacts: v.optional(
      v.array(
        v.object({
          kind: v.union(
            v.literal("prompt_package"),
            v.literal("image"),
            v.literal("text"),
            v.literal("json"),
            v.literal("other"),
          ),
          mimeType: v.optional(v.string()),
          storageId: v.optional(v.id("_storage")),
          textContent: v.optional(v.string()),
          metadata: v.optional(v.any()),
        }),
      ),
    ),
  },
  returns: v.object({
    runId: v.id("runs"),
    status: runStatusValidator,
    artifactIds: v.array(v.id("run_artifacts")),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ runId: Id<"runs">; status: RunStatus; artifactIds: Id<"run_artifacts">[] }> => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      throw new ConvexError("Run not found.");
    }
    if (args.workerId && run.workerId && args.workerId !== run.workerId) {
      throw new ConvexError("Run is owned by a different worker.");
    }
    if (run.status === "completed") {
      return { runId: args.runId, status: "completed", artifactIds: [] };
    }

    const now = Date.now();
    await ctx.db.patch(args.runId, {
      status: "completed",
      sessionId: args.sessionId ?? run.sessionId,
      completedAt: now,
      updatedAt: now,
      lastError: undefined,
      usage: args.usage ?? run.usage,
    });

    const artifactIds: Id<"run_artifacts">[] = [];
    for (const artifact of args.artifacts ?? []) {
      const artifactId = await ctx.db.insert("run_artifacts", {
        runId: args.runId,
        kind: artifact.kind,
        mimeType: artifact.mimeType,
        storageId: artifact.storageId,
        textContent: artifact.textContent,
        metadata: artifact.metadata,
        createdAt: now,
      });
      artifactIds.push(artifactId);
    }
    await insertStatusEvent(ctx, args.runId, "completed", {
      artifactCount: artifactIds.length,
    });

    return { runId: args.runId, status: "completed", artifactIds };
  },
});

export const failRun = mutation({
  args: {
    runId: v.id("runs"),
    workerId: v.optional(v.string()),
    error: v.string(),
    sessionId: v.optional(v.string()),
  },
  returns: v.object({
    runId: v.id("runs"),
    status: runStatusValidator,
  }),
  handler: async (ctx, args): Promise<{ runId: Id<"runs">; status: RunStatus }> => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      throw new ConvexError("Run not found.");
    }
    if (args.workerId && run.workerId && args.workerId !== run.workerId) {
      throw new ConvexError("Run is owned by a different worker.");
    }
    if (run.status === "failed" || run.status === "completed" || run.status === "canceled") {
      return { runId: args.runId, status: run.status as RunStatus };
    }

    const now = Date.now();
    await ctx.db.patch(args.runId, {
      status: "failed",
      sessionId: args.sessionId ?? run.sessionId,
      failedAt: now,
      updatedAt: now,
      lastError: args.error.trim(),
    });
    await insertStatusEvent(ctx, args.runId, "failed", {
      message: args.error.trim(),
    });
    await ctx.db.insert("run_events", {
      runId: args.runId,
      type: "error",
      seq: (await getLastEventSeq(ctx, args.runId)) + 1,
      payload: {
        message: args.error.trim(),
      },
      createdAt: now,
    });

    return { runId: args.runId, status: "failed" };
  },
});

export const cancelRun = mutation({
  args: {
    runId: v.id("runs"),
    userId: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  returns: v.object({
    runId: v.id("runs"),
    status: runStatusValidator,
  }),
  handler: async (ctx, args): Promise<{ runId: Id<"runs">; status: RunStatus }> => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      throw new ConvexError("Run not found.");
    }
    if (args.userId && run.userId !== args.userId) {
      throw new ConvexError("Run does not belong to this user.");
    }
    if (run.status === "completed" || run.status === "failed" || run.status === "canceled") {
      return { runId: args.runId, status: run.status as RunStatus };
    }

    const now = Date.now();
    await ctx.db.patch(args.runId, {
      status: "canceled",
      canceledAt: now,
      updatedAt: now,
      lastError: args.reason?.trim() || run.lastError,
    });
    await insertStatusEvent(ctx, args.runId, "canceled", {
      message: args.reason?.trim(),
    });

    return { runId: args.runId, status: "canceled" };
  },
});

export const resumeRun = mutation({
  args: {
    runId: v.id("runs"),
    userId: v.optional(v.string()),
  },
  returns: v.object({
    runId: v.id("runs"),
    status: runStatusValidator,
    sessionId: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ runId: Id<"runs">; status: RunStatus; sessionId?: string }> => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      throw new ConvexError("Run not found.");
    }
    if (args.userId && run.userId !== args.userId) {
      throw new ConvexError("Run does not belong to this user.");
    }
    if (run.status !== "waiting_input" && run.status !== "failed") {
      return { runId: args.runId, status: run.status as RunStatus, sessionId: run.sessionId };
    }

    await ctx.db.patch(args.runId, {
      status: "running",
      updatedAt: Date.now(),
    });
    await insertStatusEvent(ctx, args.runId, "running", { resumed: true });

    return { runId: args.runId, status: "running", sessionId: run.sessionId };
  },
});

export const getRun = query({
  args: {
    runId: v.id("runs"),
  },
  returns: v.union(
    v.null(),
    v.object({
      run: runValidator,
      events: v.array(runEventValidator),
      artifacts: v.array(runArtifactValidator),
    }),
  ),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      return null;
    }

    const events = await ctx.db
      .query("run_events")
      .withIndex("by_run_seq", (q) => q.eq("runId", args.runId).gte("seq", 0))
      .order("asc")
      .collect();
    const artifacts = await ctx.db
      .query("run_artifacts")
      .withIndex("by_run_createdAt", (q) => q.eq("runId", args.runId).gte("createdAt", 0))
      .order("asc")
      .collect();

    return {
      run,
      events,
      artifacts,
    };
  },
});

export const listRunsByUser = query({
  args: {
    userId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(runValidator),
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 25, 100);
    return await ctx.db
      .query("runs")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", args.userId).gte("createdAt", 0))
      .order("desc")
      .take(limit);
  },
});
