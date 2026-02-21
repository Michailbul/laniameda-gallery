import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
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

export const convexRuns = {
  claimRun: (args: { runId: string; workerId: string }) => client.mutation(claimRunMutation, args),
  setRunRunning: (args: {
    runId: string;
    workerId: string;
    sandboxId?: string;
    sandboxLabel?: string;
  }) => client.mutation(setRunRunningMutation, args),
  appendRunEvent: (args: { runId: string; type: string; payload?: unknown; seq?: number }) =>
    client.mutation(appendRunEventMutation, args),
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
  }) => client.mutation(completeRunMutation, args),
  failRun: (args: { runId: string; workerId?: string; error: string; sessionId?: string }) =>
    client.mutation(failRunMutation, args),
  cancelRun: (args: { runId: string; reason?: string }) => client.mutation(cancelRunMutation, args),
  getRun: (args: { runId: string }) => client.query(getRunQuery, args),
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
    };
    mediaFiles: Array<{
      mediaId: string;
      kind: "image" | "video" | "audio" | "voice" | "document";
      mimeType?: string;
      fileName?: string;
      base64: string;
    }>;
  }) => client.action(ingestAgentPayloadAction, args),
};
