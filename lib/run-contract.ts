export const RUN_STATUSES = [
  "queued",
  "claimed",
  "running",
  "waiting_input",
  "completed",
  "failed",
  "canceled",
] as const;

export const RUN_INTENTS = [
  "transfer_style",
  "transfer_pose",
  "replace_character",
  "ingest",
  "execute",
] as const;

export const RUN_SOURCES = ["dashboard", "telegram", "api"] as const;
export const RUN_RUNTIMES = ["ai_sdk", "agent_worker"] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];
export type RunIntent = (typeof RUN_INTENTS)[number];
export type RunSource = (typeof RUN_SOURCES)[number];
export type RunRuntime = (typeof RUN_RUNTIMES)[number];

export type RunDispatchPayload = {
  runId: string;
  userId: string;
  intent: RunIntent;
  source: RunSource;
};

export const isRunIntent = (value: string): value is RunIntent => {
  return RUN_INTENTS.includes(value as RunIntent);
};

export const buildRunIdempotencyKey = ({
  userId,
  intent,
  source,
  inputFingerprint,
}: {
  userId: string;
  intent: RunIntent;
  source: RunSource;
  inputFingerprint?: string;
}) => {
  return [userId.trim(), intent, source, inputFingerprint?.trim() || "none"].join("|");
};
