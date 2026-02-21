import { describe, expect, test } from "bun:test";
import {
  DEFAULT_IMAGE_ALIAS,
  getDefaultRuntime,
  isAgentWorkerEnabled,
  isAiRuntime,
  resolveImageModelAlias,
} from "@/lib/ai/models";

describe("ai model aliases", () => {
  test("resolves known model aliases", () => {
    const resolved = resolveImageModelAlias(DEFAULT_IMAGE_ALIAS);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.modelId.length).toBeGreaterThan(0);
      expect(resolved.provider).toBe("gateway");
    }
  });

  test("rejects unknown aliases", () => {
    const resolved = resolveImageModelAlias("unknown_alias");
    expect(resolved.ok).toBe(false);
  });

  test("runtime helpers return supported values", () => {
    expect(isAiRuntime("ai_sdk")).toBe(true);
    expect(isAiRuntime("agent_worker")).toBe(true);
    expect(isAiRuntime("random")).toBe(false);
    expect(["ai_sdk", "agent_worker"]).toContain(getDefaultRuntime());
    expect(typeof isAgentWorkerEnabled()).toBe("boolean");
  });
});
