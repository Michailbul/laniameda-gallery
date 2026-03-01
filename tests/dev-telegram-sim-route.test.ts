import { beforeEach, describe, expect, mock, test } from "bun:test";

type CreatedRun = { runId: string; created: boolean; status: string };

const state = {
  createRunCalls: [] as Array<Record<string, unknown>>,
  appendCalls: [] as Array<Record<string, unknown>>,
  failCalls: [] as Array<Record<string, unknown>>,
  dispatchCalls: [] as Array<Record<string, unknown>>,
  createRunResult: { runId: "run-1", created: true, status: "queued" } as CreatedRun,
  dispatchResult: { ok: true as const } as { ok: true } | { ok: false; error: string },
};

const routePath = new URL("../app/api/dev/telegram/simulate/route.ts", import.meta.url).pathname;

mock.module("@/lib/server-auth", () => ({
  getAuthUser: async () => null,
  requireAuth: async () => { throw new Error("Not authenticated."); },
}));

mock.module("@/lib/ai/convex-runs", () => ({
  convexRuns: {
    createRun: async (args: Record<string, unknown>) => {
      state.createRunCalls.push(args);
      return state.createRunResult;
    },
    appendRunEvent: async (args: Record<string, unknown>) => {
      state.appendCalls.push(args);
      return { eventId: "event-1", seq: 1 };
    },
    failRun: async (args: Record<string, unknown>) => {
      state.failCalls.push(args);
      return { runId: "run-1", status: "failed" };
    },
  },
}));

mock.module("@/lib/ai/worker-dispatch", () => ({
  dispatchRunToWorker: async (args: Record<string, unknown>) => {
    state.dispatchCalls.push(args);
    return state.dispatchResult;
  },
}));

describe("dev telegram simulate route", () => {
  beforeEach(() => {
    state.createRunCalls = [];
    state.appendCalls = [];
    state.failCalls = [];
    state.dispatchCalls = [];
    state.createRunResult = { runId: "run-1", created: true, status: "queued" };
    state.dispatchResult = { ok: true as const };
    process.env.DEV_TELEGRAM_SIM_ENABLED = "true";
    process.env.DEV_TELEGRAM_SIM_AUTH_BYPASS = "true";
  });

  test("creates and dispatches a dev_telegram run", async () => {
    const { POST } = await import(routePath);
    const formData = new FormData();
    formData.set("chatId", "chat-1");
    formData.set("text", "hello world");

    const response = await POST(
      new Request("http://localhost/api/dev/telegram/simulate", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(payload.runId).toBe("run-1");

    expect(state.createRunCalls.length).toBe(1);
    expect(state.createRunCalls[0]?.source).toBe("dev_telegram");
    expect(state.createRunCalls[0]?.runtime).toBe("agent_worker");

    expect(state.dispatchCalls.length).toBe(1);
    expect(state.dispatchCalls[0]?.source).toBe("dev_telegram");
  });

  test("returns duplicate when createRun indicates existing idempotent run", async () => {
    state.createRunResult = { runId: "run-existing", created: false, status: "queued" };

    const { POST } = await import(routePath);
    const formData = new FormData();
    formData.set("chatId", "chat-1");
    formData.set("messageId", "42");

    const response = await POST(
      new Request("http://localhost/api/dev/telegram/simulate", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.duplicate).toBe(true);
    expect(state.dispatchCalls.length).toBe(0);
  });

  test("rejects non-local host by default", async () => {
    const { POST } = await import(routePath);
    const formData = new FormData();
    formData.set("chatId", "chat-1");

    const response = await POST(
      new Request("https://example.com/api/dev/telegram/simulate", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(403);
  });
});
