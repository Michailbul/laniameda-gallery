import { afterEach, describe, expect, mock, test } from "bun:test";
import { createLogger } from "@/lib/observability/logger";

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

const logLines: string[] = [];
const warnLines: string[] = [];
const errorLines: string[] = [];

afterEach(() => {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
  logLines.length = 0;
  warnLines.length = 0;
  errorLines.length = 0;
});

describe("observability logger", () => {
  test("writes structured logs with context", () => {
    console.log = mock((line: string) => {
      logLines.push(line);
    }) as unknown as typeof console.log;

    const logger = createLogger({
      service: "test-service",
      envProfile: "test",
      minLevel: "debug",
    }).withContext({ requestId: "req-1", runId: "run-1" });

    logger.info({ phase: "ingress", op: "create_run" }, "run_created");

    expect(logLines.length).toBe(1);
    const parsed = JSON.parse(logLines[0] || "{}");
    expect(parsed.service).toBe("test-service");
    expect(parsed.envProfile).toBe("test");
    expect(parsed.requestId).toBe("req-1");
    expect(parsed.runId).toBe("run-1");
    expect(parsed.phase).toBe("ingress");
    expect(parsed.op).toBe("create_run");
    expect(parsed.msg).toBe("run_created");
    expect(typeof parsed.ts).toBe("string");
  });

  test("redacts sensitive fields and truncates text", () => {
    console.log = mock((line: string) => {
      logLines.push(line);
    }) as unknown as typeof console.log;

    const logger = createLogger({
      service: "test-service",
      envProfile: "test",
      minLevel: "debug",
    });

    logger.info(
      {
        apiKey: "secret-value",
        nested: {
          authToken: "top-secret",
        },
        text: "x".repeat(800),
      },
      "sanitized",
    );

    const parsed = JSON.parse(logLines[0] || "{}");
    expect(parsed.apiKey).toBe("[REDACTED]");
    expect(parsed.nested?.authToken).toBe("[REDACTED]");
    expect(typeof parsed.text).toBe("string");
    expect(parsed.text.includes("[truncated]")).toBeTrue();
  });

  test("time helper returns duration and logs completion", async () => {
    console.log = mock((line: string) => {
      logLines.push(line);
    }) as unknown as typeof console.log;

    const logger = createLogger({
      service: "test-service",
      envProfile: "test",
      minLevel: "debug",
    });

    const { result, durationMs } = await logger.time("unit_op", async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return 42;
    });

    expect(result).toBe(42);
    expect(durationMs).toBeGreaterThanOrEqual(0);
    expect(logLines.length).toBe(1);
    const parsed = JSON.parse(logLines[0] || "{}");
    expect(parsed.op).toBe("unit_op");
    expect(typeof parsed.durationMs).toBe("number");
    expect(parsed.msg).toBe("operation_completed");
  });

  test("time helper logs failures at error level", async () => {
    console.error = mock((line: string) => {
      errorLines.push(line);
    }) as unknown as typeof console.error;

    const logger = createLogger({
      service: "test-service",
      envProfile: "test",
      minLevel: "debug",
    });

    await expect(
      logger.time("failing_op", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(errorLines.length).toBe(1);
    const parsed = JSON.parse(errorLines[0] || "{}");
    expect(parsed.op).toBe("failing_op");
    expect(parsed.msg).toBe("operation_failed");
    expect(parsed.error?.message).toContain("boom");
  });
});
