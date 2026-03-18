import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { createLogger } from "../lib/observability/logger";
import { workerConfig } from "./config";

const claimRunMutation = makeFunctionReference<"mutation">("runs:claimRun");
const setRunRunningMutation = makeFunctionReference<"mutation">("runs:setRunRunning");
const appendRunEventMutation = makeFunctionReference<"mutation">("runs:appendRunEvent");
const completeRunMutation = makeFunctionReference<"mutation">("runs:completeRun");
const failRunMutation = makeFunctionReference<"mutation">("runs:failRun");
const cancelRunMutation = makeFunctionReference<"mutation">("runs:cancelRun");
const getRunQuery = makeFunctionReference<"query">("runs:getRun");
const ingestAgentPayloadAction = makeFunctionReference<"action">(
  "agent_ingest:ingestFromAgentPayload",
);

const client = new ConvexHttpClient(workerConfig.convexUrl);
const logger = createLogger({ service: "agent-worker-convex-client" });

const runTimed = async <T>({
  op,
  runId,
  fn,
}: {
  op: string;
  runId?: string;
  fn: () => Promise<T>;
}) => {
  const startedAt = Date.now();
  try {
    const result = await fn();
    logger.debug(
      {
        op,
        runId,
        durationMs: Date.now() - startedAt,
      },
      "convex_call_ok",
    );
    return result;
  } catch (error) {
    logger.error(
      {
        op,
        runId,
        durationMs: Date.now() - startedAt,
        error,
      },
      "convex_call_failed",
    );
    throw error;
  }
};

export const convexRuns = {
  claimRun: (args: { runId: string; workerId: string }) =>
    runTimed({
      op: "claimRun",
      runId: args.runId,
      fn: () => client.mutation(claimRunMutation, args),
    }),
  setRunRunning: (args: {
    runId: string;
    workerId: string;
    sandboxId?: string;
    sandboxLabel?: string;
  }) =>
    runTimed({
      op: "setRunRunning",
      runId: args.runId,
      fn: () => client.mutation(setRunRunningMutation, args),
    }),
  appendRunEvent: (args: { runId: string; type: string; payload?: unknown; seq?: number }) =>
    runTimed({
      op: "appendRunEvent",
      runId: args.runId,
      fn: () => client.mutation(appendRunEventMutation, args),
    }),
  completeRun: (args: {
    runId: string;
    workerId?: string;
    sessionId?: string;
    artifacts?: Array<{
      kind: "prompt_package" | "image" | "text" | "json" | "other";
      mimeType?: string;
      textContent?: string;
      metadata?: unknown;
    }>;
  }) =>
    runTimed({
      op: "completeRun",
      runId: args.runId,
      fn: () => client.mutation(completeRunMutation, args),
    }),
  failRun: (args: { runId: string; workerId?: string; error: string; sessionId?: string }) =>
    runTimed({
      op: "failRun",
      runId: args.runId,
      fn: () => client.mutation(failRunMutation, args),
    }),
  cancelRun: (args: { runId: string; reason?: string }) =>
    runTimed({
      op: "cancelRun",
      runId: args.runId,
      fn: () => client.mutation(cancelRunMutation, args),
    }),
  getRun: (args: { runId: string }) =>
    runTimed({
      op: "getRun",
      runId: args.runId,
      fn: () => client.query(getRunQuery, args),
    }),
  ingestAgentPayload: (args: {
    runId: string;
    ownerUserId: string;
    payload: {
      prompts: Array<{
        final_prompt: string;
        negative_prompt?: string;
        generation_notes?: string;
        tags: string[];
      }>;
      selectedTelegramMediaIds: string[];
      selectedUrls: string[];
      notes?: string;
      allowPromptOnly?: boolean;
    };
    mediaFiles: Array<{
      mediaId: string;
      kind: "image" | "video" | "audio" | "voice" | "document";
      mimeType?: string;
      fileName?: string;
      base64: string;
    }>;
  }) =>
    runTimed({
      op: "ingestAgentPayload",
      runId: args.runId,
      fn: () => client.action(ingestAgentPayloadAction, args),
    }),
};
