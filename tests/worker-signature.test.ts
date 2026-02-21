import { describe, expect, test } from "bun:test";
import { createWorkerSignature, verifyWorkerSignature } from "@/lib/worker-signature";

describe("worker signature", () => {
  test("verifies valid signatures", () => {
    const body = JSON.stringify({ runId: "run_123" });
    const secret = "local-secret";
    const timestamp = `${Math.floor(Date.now() / 1000)}`;
    const signature = createWorkerSignature({ secret, body, timestamp });

    expect(
      verifyWorkerSignature({
        secret,
        body,
        timestamp,
        signature,
      }),
    ).toBe(true);
  });

  test("rejects tampered payloads", () => {
    const body = JSON.stringify({ runId: "run_123" });
    const secret = "local-secret";
    const timestamp = `${Math.floor(Date.now() / 1000)}`;
    const signature = createWorkerSignature({ secret, body, timestamp });

    expect(
      verifyWorkerSignature({
        secret,
        body: JSON.stringify({ runId: "run_999" }),
        timestamp,
        signature,
      }),
    ).toBe(false);
  });
});
