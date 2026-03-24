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
  }) => client().mutation(createRunMutation, args),

  setRunRunning: (args: {
    runId: string;
    workerId: string;
    sandboxId?: string;
    sandboxLabel?: string;
  }) => client().mutation(setRunRunningMutation, args),

  appendRunEvent: (args: {
    runId: string;
    type: "stream_text" | "tool_call" | "tool_result" | "approval_request" | "error" | "status_change" | "system";
    payload?: unknown;
    seq?: number;
  }) => client().mutation(appendRunEventMutation, args),

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
  }) => client().mutation(completeRunMutation, args),

  failRun: (args: {
    runId: string;
    workerId?: string;
    error: string;
    sessionId?: string;
  }) => client().mutation(failRunMutation, args),

  cancelRun: (args: {
    runId: string;
    userId?: string;
    reason?: string;
  }) => client().mutation(cancelRunMutation, args),

  getRun: (args: { runId: string }) => client().query(getRunQuery, args),
};
