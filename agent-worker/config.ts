const parsePositiveInt = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
};

const parseCsv = (value: string | undefined, fallback: string[]) => {
  if (!value) return fallback;
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const VALID_SETTING_SOURCES = new Set(["user", "project", "local"] as const);
type AgentSettingSource = "user" | "project" | "local";

const parseSettingSources = (
  value: string | undefined,
  fallback: AgentSettingSource[],
): AgentSettingSource[] => {
  const parsed = parseCsv(value, fallback);
  const filtered = parsed.filter((entry): entry is AgentSettingSource =>
    VALID_SETTING_SOURCES.has(entry as AgentSettingSource),
  );
  if (filtered.length === 0) {
    return fallback;
  }
  return Array.from(new Set(filtered));
};

export type WorkerConfig = {
  port: number;
  workerId: string;
  convexUrl: string;
  sharedSecret: string;
  claudeModel: string;
  maxTurns: number;
  dummyMode: boolean;
  streamingMode: boolean;
  streamingSingleFallback: boolean;
  allowedTools: string[];
  gatewayApiKey: string;
  gatewayBaseUrl: string;
  skillsEnabled: boolean;
  settingSources: AgentSettingSource[];
  daytonaApiKey: string;
  daytonaApiUrl: string;
  daytonaTarget: string;
  sandboxAutoStopMinutes: number;
  telegramBotToken: string;
  telegramMediaMaxBytes: number;
  telegramDirectBlockMaxBytes: number;
  agentWorkspaceCwd: string;
  agentAdditionalDirectories: string[];
  sandboxNodeCommand: string;
};

export const buildWorkerConfig = (
  env: Record<string, string | undefined>,
): WorkerConfig => ({
  port: parsePositiveInt(env.PORT, 8787),
  workerId: env.AGENT_WORKER_ID || env.HOSTNAME || "agent-worker-1",
  convexUrl: env.CONVEX_URL || env.NEXT_PUBLIC_CONVEX_URL || "",
  sharedSecret: env.AGENT_WORKER_SHARED_SECRET || "",
  claudeModel: env.AGENT_MODEL || "claude-sonnet-4-5",
  maxTurns: parsePositiveInt(env.AGENT_MAX_TURNS, 8),
  dummyMode: parseBoolean(env.AGENT_DUMMY_MODE, false),
  streamingMode: parseBoolean(env.AGENT_STREAMING_MODE, true),
  streamingSingleFallback: parseBoolean(env.AGENT_STREAMING_SINGLE_FALLBACK, true),
  allowedTools: parseCsv(env.AGENT_ALLOWED_TOOLS, [
    "Read",
    "Write",
    "Edit",
    "Bash",
    "Glob",
    "Grep",
    "LS",
  ]),
  gatewayApiKey: env.AI_GATEWAY_API_KEY || "",
  gatewayBaseUrl: env.AGENT_GATEWAY_BASE_URL || "https://ai-gateway.vercel.sh",
  skillsEnabled: parseBoolean(env.AGENT_SKILLS_ENABLED, true),
  settingSources: parseSettingSources(env.AGENT_SETTING_SOURCES, ["project"]),
  daytonaApiKey: env.DAYTONA_API_KEY || "",
  daytonaApiUrl: env.DAYTONA_API_URL || "",
  daytonaTarget: env.DAYTONA_TARGET || "",
  sandboxAutoStopMinutes: parsePositiveInt(env.DAYTONA_AUTO_STOP_MINUTES, 10),
  telegramBotToken: env.TELEGRAM_BOT_TOKEN || "",
  telegramMediaMaxBytes: parsePositiveInt(env.TELEGRAM_MEDIA_MAX_BYTES, 20_000_000),
  telegramDirectBlockMaxBytes: parsePositiveInt(
    env.TELEGRAM_MEDIA_DIRECT_BLOCK_MAX_BYTES,
    5_000_000,
  ),
  agentWorkspaceCwd: env.AGENT_WORKSPACE_CWD || process.cwd(),
  agentAdditionalDirectories: parseCsv(env.AGENT_ADDITIONAL_DIRECTORIES, []),
  sandboxNodeCommand: env.AGENT_SANDBOX_NODE_COMMAND || "node",
});

export const workerConfig = buildWorkerConfig(process.env);

export const assertWorkerConfigValues = (config: WorkerConfig) => {
  if (!config.convexUrl) {
    throw new Error("CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL) must be set for agent-worker.");
  }
  if (!config.sharedSecret) {
    throw new Error("AGENT_WORKER_SHARED_SECRET must be set for agent-worker.");
  }
  if (!config.daytonaApiKey || !config.daytonaApiUrl || !config.daytonaTarget) {
    throw new Error(
      "DAYTONA_API_KEY, DAYTONA_API_URL, and DAYTONA_TARGET must be set for agent-worker.",
    );
  }
  if (!config.dummyMode && !config.gatewayApiKey) {
    throw new Error("AI_GATEWAY_API_KEY must be set for agent-worker live mode.");
  }
};

export const assertWorkerConfig = () => {
  assertWorkerConfigValues(workerConfig);
};
