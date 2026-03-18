import { describe, expect, test } from "bun:test";
import {
  buildAgentSdkAllowedTools,
  buildAgentSdkGatewayEnv,
  normalizeIngestPayload,
  resolveSandboxPathInWorkspace,
} from "@/agent-worker/agent-runtime";
import { assertWorkerConfigValues, buildWorkerConfig } from "@/agent-worker/config";

describe("buildAgentSdkGatewayEnv", () => {
  test("injects gateway auth and clears direct Anthropic API key", () => {
    const env = buildAgentSdkGatewayEnv({
      SOME_VAR: "value",
      ANTHROPIC_API_KEY: "sk-ant-test",
    });

    expect(env["SOME_VAR"]).toBe("value");
    expect(env.ANTHROPIC_API_KEY).toBe("");
    expect(env.ANTHROPIC_BASE_URL).toBeTruthy();
    expect(env.ANTHROPIC_AUTH_TOKEN).not.toBeUndefined();
  });
});

describe("assertWorkerConfigValues", () => {
  test("fails fast in live mode when AI gateway key is missing", () => {
    const config = buildWorkerConfig({
      CONVEX_URL: "https://convex.test",
      AGENT_WORKER_SHARED_SECRET: "shared-secret",
      AGENT_DUMMY_MODE: "false",
      DAYTONA_API_KEY: "daytona-key",
      DAYTONA_API_URL: "https://daytona.test",
      DAYTONA_TARGET: "target",
    });

    expect(() => assertWorkerConfigValues(config)).toThrow(
      "AI_GATEWAY_API_KEY must be set for agent-worker live mode.",
    );
  });

  test("parses setting sources and skills flag from env", () => {
    const config = buildWorkerConfig({
      CONVEX_URL: "https://convex.test",
      AGENT_WORKER_SHARED_SECRET: "shared-secret",
      AGENT_DUMMY_MODE: "true",
      AGENT_SETTING_SOURCES: "project,user,invalid",
      AGENT_SKILLS_ENABLED: "true",
      DAYTONA_API_KEY: "daytona-key",
      DAYTONA_API_URL: "https://daytona.test",
      DAYTONA_TARGET: "target",
    });

    expect(config.settingSources).toEqual(["project", "user"]);
    expect(config.skillsEnabled).toBeTrue();
  });
});

describe("buildAgentSdkAllowedTools", () => {
  test("adds Skill tool when skills are enabled", () => {
    const tools = buildAgentSdkAllowedTools({
      allowedTools: ["Read", "Write", "Bash"],
      skillsEnabled: true,
    });

    expect(tools.includes("Skill")).toBeTrue();
    expect(tools.includes("Read")).toBeTrue();
  });
});

describe("normalizeIngestPayload", () => {
  test("preserves explicit prompt-only opt-in while trimming prompt and selector values", () => {
    const payload = normalizeIngestPayload({
      prompts: [
        {
          final_prompt: "  cinematic portrait  ",
          negative_prompt: "  low quality  ",
          generation_notes: "  keep skin texture  ",
          tags: [" portrait ", "portrait", " editorial "],
        },
      ],
      selectedTelegramMediaIds: ["  ", "media-1", "media-1"],
      selectedUrls: [" https://example.com/ref ", "https://example.com/ref"],
      allowPromptOnly: true,
      notes: "  preserve the workflow  ",
    });

    expect(payload).toEqual({
      prompts: [
        {
          final_prompt: "cinematic portrait",
          negative_prompt: "low quality",
          generation_notes: "keep skin texture",
          tags: ["portrait", "editorial"],
        },
      ],
      selectedTelegramMediaIds: ["media-1"],
      selectedUrls: ["https://example.com/ref"],
      allowPromptOnly: true,
      notes: "preserve the workflow",
    });
  });
});

describe("resolveSandboxPathInWorkspace", () => {
  test("maps in-repo paths into sandbox workspace root", () => {
    const localRoot = "/tmp/workspace";
    expect(
      resolveSandboxPathInWorkspace({
        localPath: "/tmp/workspace/CLAUDE.md",
        localWorkspaceRoot: localRoot,
        remoteWorkspaceRoot: ".agent-runtime/workspace",
      }),
    ).toBe(".agent-runtime/workspace/CLAUDE.md");

    expect(
      resolveSandboxPathInWorkspace({
        localPath: "/tmp/workspace/media/inbound/77/01-file.jpg",
        localWorkspaceRoot: localRoot,
        remoteWorkspaceRoot: ".agent-runtime/workspace",
      }),
    ).toBe(".agent-runtime/workspace/media/inbound/77/01-file.jpg");
  });
});
