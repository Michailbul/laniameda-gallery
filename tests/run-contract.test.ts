import { describe, expect, test } from "bun:test";
import {
  buildRunIdempotencyKey,
  isRunIntent,
  RUN_INTENTS,
  RUN_SOURCES,
} from "@/lib/run-contract";

describe("run contract", () => {
  test("validates known run intents", () => {
    for (const intent of RUN_INTENTS) {
      expect(isRunIntent(intent)).toBe(true);
    }
    expect(isRunIntent("unknown_intent")).toBe(false);
  });

  test("creates deterministic idempotency keys", () => {
    const key = buildRunIdempotencyKey({
      userId: "user_1",
      intent: "transfer_style",
      source: "dashboard",
      inputFingerprint: "abc123",
    });
    expect(key).toBe("user_1|transfer_style|dashboard|abc123");
  });

  test("includes dev_telegram in supported run sources", () => {
    expect(RUN_SOURCES.includes("dev_telegram")).toBeTrue();
  });
});
