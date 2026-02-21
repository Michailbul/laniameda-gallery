import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import type { Sandbox } from "@daytonaio/sdk";
import {
  createSdkMcpServer,
  query,
  type PermissionResult,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { RUN_EVENT_PHASES } from "../lib/run-phases";
import { workerConfig } from "./config";
import { DaytonaSpawnedProcess } from "./daytona-spawn";

type EventCallback = (
  eventType: "stream_text" | "tool_call" | "tool_result" | "status_change" | "error",
  payload: Record<string, unknown>,
) => Promise<void>;

const REMOTE_AGENT_SDK_ROOT = ".agent-runtime/claude-agent-sdk";
export const SANDBOX_WORKSPACE_ROOT = ".agent-runtime/workspace";
const INGEST_MCP_SERVER_NAME = "prompt_ingest";
export const SUBMIT_INGEST_PAYLOAD_TOOL_NAME = "submit_ingest_payload";
const MCP_SUBMIT_INGEST_PAYLOAD_TOOL_NAME = `mcp__${INGEST_MCP_SERVER_NAME}__${SUBMIT_INGEST_PAYLOAD_TOOL_NAME}`;

const ingestPromptSchema = z
  .object({
    final_prompt: z.string(),
    negative_prompt: z.optional(z.string()),
    generation_notes: z.optional(z.string()),
    tags: z.optional(z.array(z.string())),
    userId: z.optional(z.never()),
    ownerUserId: z.optional(z.never()),
  })
  .strict();

const ingestPayloadSchema = z
  .object({
    prompts: z.array(ingestPromptSchema),
    selectedTelegramMediaIds: z.array(z.string()),
    selectedUrls: z.array(z.string()),
    notes: z.optional(z.string()),
    userId: z.optional(z.never()),
    ownerUserId: z.optional(z.never()),
  })
  .strict();

export type AgentIngestPrompt = {
  final_prompt: string;
  negative_prompt?: string;
  generation_notes?: string;
  tags: string[];
};

export type AgentIngestPayload = {
  prompts: AgentIngestPrompt[];
  selectedTelegramMediaIds: string[];
  selectedUrls: string[];
  notes?: string;
};

type IngestToolCapture = {
  successfulToolCalls: number;
  payload?: AgentIngestPayload;
};

export const buildAgentSdkAllowedTools = ({
  allowedTools,
  skillsEnabled,
  includeIngestTool,
}: {
  allowedTools: string[];
  skillsEnabled: boolean;
  includeIngestTool?: boolean;
}) => {
  const normalized = new Set(allowedTools);
  if (skillsEnabled) {
    normalized.add("Skill");
  }
  if (includeIngestTool) {
    normalized.add(SUBMIT_INGEST_PAYLOAD_TOOL_NAME);
    normalized.add(MCP_SUBMIT_INGEST_PAYLOAD_TOOL_NAME);
  }
  return Array.from(normalized);
};

const getAllowedTools = (options?: { includeIngestTool?: boolean }) =>
  buildAgentSdkAllowedTools({
    allowedTools: workerConfig.allowedTools,
    skillsEnabled: workerConfig.skillsEnabled,
    includeIngestTool: options?.includeIngestTool,
  });

const isSubmitIngestToolName = (toolName: string) =>
  toolName === SUBMIT_INGEST_PAYLOAD_TOOL_NAME ||
  toolName === MCP_SUBMIT_INGEST_PAYLOAD_TOOL_NAME ||
  toolName.endsWith(`__${SUBMIT_INGEST_PAYLOAD_TOOL_NAME}`);

const isToolAllowed = (toolName: string) => {
  if (isSubmitIngestToolName(toolName)) {
    return true;
  }
  return getAllowedTools().includes(toolName);
};

const permissionDecision = async (toolName: string): Promise<PermissionResult> => {
  if (!isToolAllowed(toolName)) {
    return {
      behavior: "deny",
      message: `Tool ${toolName} is not allowed for this run.`,
    };
  }
  return { behavior: "allow" };
};

const ensureSandboxFolder = async (sandbox: Sandbox, folderPath: string) => {
  const segments = folderPath.split("/").filter(Boolean);
  let currentPath = "";
  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    try {
      await sandbox.fs.createFolder(currentPath, "755");
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (message.includes("exist") || message.includes("already")) {
        continue;
      }
      throw error;
    }
  }
};

const getAgentSdkLocalRoot = () => {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve("@anthropic-ai/claude-agent-sdk/package.json");
  return path.dirname(packageJsonPath);
};

const toPosixPath = (value: string) => value.split(path.sep).join("/");

const pathExists = async (filePath: string) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const isDirectory = async (filePath: string) => {
  try {
    return (await fs.stat(filePath)).isDirectory();
  } catch {
    return false;
  }
};

const uploadFileToSandbox = async ({
  sandbox,
  localPath,
  remotePath,
}: {
  sandbox: Sandbox;
  localPath: string;
  remotePath: string;
}) => {
  await ensureSandboxFolder(sandbox, path.posix.dirname(remotePath));
  await sandbox.fs.uploadFile(localPath, remotePath);
};

const syncDirectoryToSandbox = async ({
  sandbox,
  localDir,
  remoteDir,
}: {
  sandbox: Sandbox;
  localDir: string;
  remoteDir: string;
}) => {
  await ensureSandboxFolder(sandbox, remoteDir);
  const entries = await fs.readdir(localDir, { withFileTypes: true });
  for (const entry of entries) {
    const localPath = path.join(localDir, entry.name);
    const remotePath = `${remoteDir}/${entry.name}`;
    if (entry.isDirectory()) {
      await syncDirectoryToSandbox({
        sandbox,
        localDir: localPath,
        remoteDir: remotePath,
      });
      continue;
    }
    if (entry.isFile()) {
      await sandbox.fs.uploadFile(localPath, remotePath);
    }
  }
};

const syncProjectContextToSandbox = async ({
  sandbox,
  localWorkspaceRoot,
  remoteWorkspaceRoot,
}: {
  sandbox: Sandbox;
  localWorkspaceRoot: string;
  remoteWorkspaceRoot: string;
}) => {
  await ensureSandboxFolder(sandbox, remoteWorkspaceRoot);

  const claudeMd = path.join(localWorkspaceRoot, "CLAUDE.md");
  if (await pathExists(claudeMd)) {
    await uploadFileToSandbox({
      sandbox,
      localPath: claudeMd,
      remotePath: `${remoteWorkspaceRoot}/CLAUDE.md`,
    });
  }

  const settingsPath = path.join(localWorkspaceRoot, ".claude", "settings.json");
  if (await pathExists(settingsPath)) {
    await uploadFileToSandbox({
      sandbox,
      localPath: settingsPath,
      remotePath: `${remoteWorkspaceRoot}/.claude/settings.json`,
    });
  }

  const skillsDir = path.join(localWorkspaceRoot, ".claude", "skills");
  if (await isDirectory(skillsDir)) {
    await syncDirectoryToSandbox({
      sandbox,
      localDir: skillsDir,
      remoteDir: `${remoteWorkspaceRoot}/.claude/skills`,
    });
  }
};

const prepareAgentSdkInSandbox = async (sandbox: Sandbox) => {
  const localSdkRoot = getAgentSdkLocalRoot();
  const localWorkspaceRoot = path.resolve(workerConfig.agentWorkspaceCwd || process.cwd());

  await syncDirectoryToSandbox({
    sandbox,
    localDir: localSdkRoot,
    remoteDir: REMOTE_AGENT_SDK_ROOT,
  });
  await syncProjectContextToSandbox({
    sandbox,
    localWorkspaceRoot,
    remoteWorkspaceRoot: SANDBOX_WORKSPACE_ROOT,
  });
  return {
    localSdkRoot,
    remoteSdkRoot: REMOTE_AGENT_SDK_ROOT,
    localWorkspaceRoot,
    remoteWorkspaceRoot: SANDBOX_WORKSPACE_ROOT,
  };
};

export const buildAgentSdkGatewayEnv = (
  baseEnv: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> => {
  return {
    ...baseEnv,
    ANTHROPIC_BASE_URL: workerConfig.gatewayBaseUrl,
    ANTHROPIC_AUTH_TOKEN: workerConfig.gatewayApiKey,
    ANTHROPIC_API_KEY: "",
  };
};

export const resolveSandboxPathInWorkspace = ({
  localPath,
  localWorkspaceRoot,
  remoteWorkspaceRoot,
}: {
  localPath: string;
  localWorkspaceRoot: string;
  remoteWorkspaceRoot: string;
}) => {
  const resolvedRoot = path.resolve(localWorkspaceRoot);
  const resolvedPath = path.isAbsolute(localPath)
    ? path.resolve(localPath)
    : path.resolve(resolvedRoot, localPath);
  const relative = path.relative(resolvedRoot, resolvedPath);
  if (!relative || relative === ".") {
    return remoteWorkspaceRoot;
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return remoteWorkspaceRoot;
  }
  return `${remoteWorkspaceRoot}/${toPosixPath(relative)}`;
};

const mapAdditionalDirectoriesToSandboxWorkspace = ({
  localWorkspaceRoot,
  remoteWorkspaceRoot,
  additionalDirectories,
}: {
  localWorkspaceRoot: string;
  remoteWorkspaceRoot: string;
  additionalDirectories?: string[];
}) => {
  if (!additionalDirectories || additionalDirectories.length === 0) {
    return undefined;
  }
  const mapped = additionalDirectories.map((entry) =>
    resolveSandboxPathInWorkspace({
      localPath: entry,
      localWorkspaceRoot,
      remoteWorkspaceRoot,
    }),
  );
  return Array.from(new Set(mapped));
};

const closeRunnerSafely = (runner: { close: () => void }) => {
  try {
    runner.close();
  } catch {
    // no-op
  }
};

type QueryRunner = AsyncIterable<SDKMessage> & { close: () => void };

const normalizeUniqueStrings = (values: string[]) => {
  const cleaned = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return Array.from(new Set(cleaned));
};

const normalizeIngestPayload = (input: z.infer<typeof ingestPayloadSchema>): AgentIngestPayload => {
  const prompts: AgentIngestPrompt[] = [];
  for (const prompt of input.prompts) {
    const finalPrompt = prompt.final_prompt.trim();
    if (!finalPrompt) {
      continue;
    }

    const normalizedPrompt: AgentIngestPrompt = {
      final_prompt: finalPrompt,
      tags: normalizeUniqueStrings(prompt.tags ?? []),
    };
    const negativePrompt = prompt.negative_prompt?.trim();
    if (negativePrompt) {
      normalizedPrompt.negative_prompt = negativePrompt;
    }
    const generationNotes = prompt.generation_notes?.trim();
    if (generationNotes) {
      normalizedPrompt.generation_notes = generationNotes;
    }

    prompts.push(normalizedPrompt);
  }

  return {
    prompts,
    selectedTelegramMediaIds: normalizeUniqueStrings(input.selectedTelegramMediaIds),
    selectedUrls: normalizeUniqueStrings(input.selectedUrls),
    notes: input.notes?.trim() || undefined,
  };
};

const createSubmitIngestToolResult = (text: string): CallToolResult => ({
  content: [{ type: "text", text }],
});

const createIngestMcpServer = ({
  capture,
  onEvent,
}: {
  capture: IngestToolCapture;
  onEvent: EventCallback;
}) => {
  return createSdkMcpServer({
    name: INGEST_MCP_SERVER_NAME,
    version: "1.0.0",
    tools: [
      {
        name: SUBMIT_INGEST_PAYLOAD_TOOL_NAME,
        description:
          "Submit the structured ingest payload once extraction is complete. Do not include any user identifiers.",
        inputSchema: ingestPayloadSchema.shape,
        handler: async (rawArgs: unknown) => {
          if (capture.successfulToolCalls >= 1) {
            throw new Error(`${SUBMIT_INGEST_PAYLOAD_TOOL_NAME} can only be called once per run.`);
          }
          const parsed = ingestPayloadSchema.parse(rawArgs);
          const normalized = normalizeIngestPayload(parsed);
          capture.payload = normalized;
          capture.successfulToolCalls += 1;
          await onEvent("status_change", {
            phase: "ingest_payload_submitted",
            promptCount: normalized.prompts.length,
            selectedMediaCount: normalized.selectedTelegramMediaIds.length,
            selectedUrlCount: normalized.selectedUrls.length,
          });
          return createSubmitIngestToolResult("Ingest payload accepted.");
        },
      },
    ],
  });
};

const closeMcpServerSafely = async (closeable: { close: () => Promise<void> }) => {
  try {
    await closeable.close();
  } catch {
    // no-op
  }
};

const extractStreamTextDelta = (event: unknown) => {
  if (!event || typeof event !== "object") {
    return undefined;
  }
  const eventRecord = event as Record<string, unknown>;
  if (eventRecord.type !== "content_block_delta") {
    return undefined;
  }
  const delta = eventRecord.delta;
  if (!delta || typeof delta !== "object") {
    return undefined;
  }
  const deltaRecord = delta as Record<string, unknown>;
  if (deltaRecord.type !== "text_delta") {
    return undefined;
  }
  return typeof deltaRecord.text === "string" ? deltaRecord.text : undefined;
};

const runQueryAndCollectResult = async ({
  runner,
  onEvent,
  signal,
  ingestToolCapture,
}: {
  runner: QueryRunner;
  onEvent: EventCallback;
  signal: AbortSignal;
  ingestToolCapture?: IngestToolCapture;
}) => {
  const closeRunner = () => closeRunnerSafely(runner);
  signal.addEventListener("abort", closeRunner, { once: true });

  let resultText = "";
  let sessionId: string | undefined;

  try {
    await onEvent("status_change", { phase: RUN_EVENT_PHASES.streamInit });
    for await (const message of runner) {
      sessionId = message.session_id;
      await handleMessageEvent(message, onEvent);
      if (message.type === "result") {
        if (message.subtype === "success") {
          resultText = message.result;
        } else {
          throw new Error(
            message.errors.join(", ") || `Agent run failed with subtype ${message.subtype}`,
          );
        }
      }
    }
  } finally {
    signal.removeEventListener("abort", closeRunner);
    closeRunner();
  }

  if (!resultText) {
    throw new Error("Agent run produced no final result.");
  }

  return {
    resultText,
    sessionId,
    ingestPayload: ingestToolCapture?.payload,
    ingestToolCallCount: ingestToolCapture?.successfulToolCalls ?? 0,
  };
};

export const executeClaudeRun = async ({
  prompt,
  onEvent,
  signal,
  maxTurns,
  cwd,
  additionalDirectories,
}: {
  prompt: string;
  onEvent: EventCallback;
  signal: AbortSignal;
  maxTurns: number;
  cwd?: string;
  additionalDirectories?: string[];
}) => {
  const runner: QueryRunner = query({
    prompt,
    options: {
      model: workerConfig.claudeModel,
      permissionMode: "default",
      includePartialMessages: true,
      maxTurns,
      allowedTools: getAllowedTools(),
      cwd,
      additionalDirectories,
      settingSources: workerConfig.settingSources,
      env: buildAgentSdkGatewayEnv(),
      canUseTool: async (toolName) => permissionDecision(toolName),
      sandbox: {
        enabled: true,
        allowUnsandboxedCommands: false,
      },
    },
  });
  return runQueryAndCollectResult({ runner, onEvent, signal });
};

const streamPromptMessages = async function* (messages: Array<Record<string, unknown>>) {
  for (const message of messages) {
    yield message as unknown as never;
  }
};

export const executeClaudeRunStreamingInSandbox = async ({
  sandbox,
  messages,
  onEvent,
  signal,
  maxTurns,
  cwd,
  additionalDirectories,
}: {
  sandbox: Sandbox;
  messages: Array<Record<string, unknown>>;
  onEvent: EventCallback;
  signal: AbortSignal;
  maxTurns: number;
  cwd?: string;
  additionalDirectories?: string[];
}) => {
  const sdkPaths = await prepareAgentSdkInSandbox(sandbox);
  const remoteCwd = cwd
    ? resolveSandboxPathInWorkspace({
        localPath: cwd,
        localWorkspaceRoot: sdkPaths.localWorkspaceRoot,
        remoteWorkspaceRoot: sdkPaths.remoteWorkspaceRoot,
      })
    : sdkPaths.remoteWorkspaceRoot;
  const remoteAdditionalDirectories = mapAdditionalDirectoriesToSandboxWorkspace({
    localWorkspaceRoot: sdkPaths.localWorkspaceRoot,
    remoteWorkspaceRoot: sdkPaths.remoteWorkspaceRoot,
    additionalDirectories,
  });
  const ingestToolCapture: IngestToolCapture = {
    successfulToolCalls: 0,
  };
  const ingestMcpServer = createIngestMcpServer({
    capture: ingestToolCapture,
    onEvent,
  });

  const runner: QueryRunner = query({
    prompt: streamPromptMessages(messages),
    options: {
      model: workerConfig.claudeModel,
      permissionMode: "default",
      includePartialMessages: true,
      maxTurns,
      allowedTools: getAllowedTools({ includeIngestTool: true }),
      cwd: remoteCwd,
      additionalDirectories: remoteAdditionalDirectories,
      settingSources: workerConfig.settingSources,
      env: buildAgentSdkGatewayEnv(),
      mcpServers: {
        [INGEST_MCP_SERVER_NAME]: ingestMcpServer,
      },
      pathToClaudeCodeExecutable: `${sdkPaths.remoteSdkRoot}/cli.js`,
      canUseTool: async (toolName) => permissionDecision(toolName),
      sandbox: {
        enabled: true,
        allowUnsandboxedCommands: false,
      },
      spawnClaudeCodeProcess: (options) =>
        new DaytonaSpawnedProcess({
          sandbox,
          options,
          localSdkRoot: sdkPaths.localSdkRoot,
          remoteSdkRoot: sdkPaths.remoteSdkRoot,
          sandboxNodeCommand: workerConfig.sandboxNodeCommand,
        }),
    },
  });
  try {
    return await runQueryAndCollectResult({
      runner,
      onEvent,
      signal,
      ingestToolCapture,
    });
  } finally {
    await closeMcpServerSafely(ingestMcpServer.instance);
  }
};

const handleMessageEvent = async (message: SDKMessage, onEvent: EventCallback) => {
  if (message.type === "stream_event") {
    const textDelta = extractStreamTextDelta(message.event);
    await onEvent("stream_text", {
      phase: RUN_EVENT_PHASES.streamChunk,
      event: message.event,
      textDelta,
      sessionId: message.session_id,
    });
    return;
  }

  if (message.type === "tool_progress") {
    await onEvent("tool_call", {
      phase: RUN_EVENT_PHASES.toolProgress,
      toolName: message.tool_name,
      toolUseId: message.tool_use_id,
      elapsedSeconds: message.elapsed_time_seconds,
      sessionId: message.session_id,
    });
    return;
  }

  if (message.type === "tool_use_summary") {
    await onEvent("tool_result", {
      summary: message.summary,
      toolUseIds: message.preceding_tool_use_ids,
      sessionId: message.session_id,
    });
    return;
  }

  if (message.type === "system") {
    await onEvent("status_change", {
      phase: message.subtype === "init" ? RUN_EVENT_PHASES.streamInit : undefined,
      subtype: message.subtype,
      status: "status" in message ? message.status : undefined,
      sessionId: message.session_id,
    });
    return;
  }

  if (message.type === "result" && message.subtype !== "success") {
    await onEvent("error", {
      subtype: message.subtype,
      message: message.errors.join(", ") || "Unknown result error",
      sessionId: message.session_id,
    });
  }
};
