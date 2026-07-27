import { makeFunctionReference } from "convex/server";
import type { AiProvider, AiRunMode, AiRuntime } from "@/lib/ai/models";
import type { CompactUsage } from "@/lib/ai/schemas";
import type { RunIntent, RunSource } from "@/lib/run-contract";
import { getServerConvexClient } from "@/lib/server/convex";

const createRunMutation = makeFunctionReference<"mutation">("runs:createRun");
const setRunRunningMutation = makeFunctionReference<"mutation">("runs:setRunRunning");
const appendRunEventMutation = makeFunctionReference<"mutation">("runs:appendRunEvent");
const completeRunMutation = makeFunctionReference<"mutation">("runs:completeRun");
const failRunMutation = makeFunctionReference<"mutation">("runs:failRun");
const cancelRunMutation = makeFunctionReference<"mutation">("runs:cancelRun");
const getRunQuery = makeFunctionReference<"query">("runs:getRun");

const client = () => getServerConvexClient();

// Shared secret gating the runs control plane on the Convex side. Server-only:
// this module must never be imported from client components.
const runsServerSecret = () => {
  const secret = (
    process.env.RUNS_SERVER_SECRET ??
    process.env.CURATION_ADMIN_SECRET ??
    ""
  ).trim();
  if (!secret) {
    throw new Error("RUNS_SERVER_SECRET is not configured.");
  }
  return secret;
};

export const convexRuns = {
  createRun: (args: {
    userId: string;
    intent: RunIntent;
    source: RunSource;
    input?: unknown;
    idempotencyKey?: string;
    runtime?: AiRuntime;
    provider?: AiProvider;
    model?: string;
    mode?: AiRunMode;
    sourceChatId?: string;
    sourceThreadId?: string;
    sourceMessageId?: string;
    sourceUpdateId?: number;
  }) => client().mutation(createRunMutation, { ...args, serverSecret: runsServerSecret() }),

  setRunRunning: (args: {
    runId: string;
    workerId: string;
    sandboxId?: string;
    sandboxLabel?: string;
  }) => client().mutation(setRunRunningMutation, { ...args, serverSecret: runsServerSecret() }),

  appendRunEvent: (args: {
    runId: string;
    type: "stream_text" | "tool_call" | "tool_result" | "approval_request" | "error" | "status_change" | "system";
    payload?: unknown;
    seq?: number;
  }) => client().mutation(appendRunEventMutation, { ...args, serverSecret: runsServerSecret() }),

  completeRun: (args: {
    runId: string;
    workerId?: string;
    sessionId?: string;
    usage?: CompactUsage;
    artifacts?: Array<{
      kind: "prompt_package" | "image" | "text" | "json" | "other";
      mimeType?: string;
      storageId?: string;
      textContent?: string;
      metadata?: unknown;
    }>;
  }) => client().mutation(completeRunMutation, { ...args, serverSecret: runsServerSecret() }),

  failRun: (args: {
    runId: string;
    workerId?: string;
    error: string;
    sessionId?: string;
  }) => client().mutation(failRunMutation, { ...args, serverSecret: runsServerSecret() }),

  cancelRun: (args: {
    runId: string;
    userId?: string;
    reason?: string;
  }) => client().mutation(cancelRunMutation, { ...args, serverSecret: runsServerSecret() }),

  getRun: (args: { runId: string }) => client().query(getRunQuery, { ...args, serverSecret: runsServerSecret() }),
};
