import { beforeEach, describe, expect, mock, test } from "bun:test";

const state = {
  authUserId: "telegram:278674008",
  actionCalls: [] as Array<Record<string, unknown>>,
  mutationCalls: [] as Array<Record<string, unknown>>,
  actionResult: { ok: true } as Record<string, unknown>,
};

const routePath = new URL("../app/api/ingest/route.ts", import.meta.url).pathname;

mock.module("@/lib/server-auth", () => ({
  requireAuth: async () => ({ id: state.authUserId }),
}));

mock.module("convex/browser", () => ({
  ConvexHttpClient: class {
    constructor(_url: string) {}

    async action(_reference: unknown, payload: Record<string, unknown>) {
      state.actionCalls.push(payload);
      return state.actionResult;
    }

    async mutation(_reference: unknown, payload: Record<string, unknown>) {
      state.mutationCalls.push(payload);
      return { failureId: "failure:1" };
    }
  },
}));

describe("POST /api/ingest", () => {
  beforeEach(() => {
    state.authUserId = "telegram:278674008";
    state.actionCalls = [];
    state.mutationCalls = [];
    state.actionResult = { promptId: "prompts:1" };
    process.env.CONVEX_URL = "https://example.convex.cloud";
  });

  test("rejects accidental prompt-only ingests without allowPromptOnly", async () => {
    const { POST } = await import(routePath);

    const response = await POST(
      new Request("http://localhost/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          promptText: "prompt only",
          ingestKey: "prompt-only",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Prompt-only ingest requires allowPromptOnly=true.",
    });
    expect(state.actionCalls).toHaveLength(0);
    expect(state.mutationCalls).toHaveLength(0);
  });

  test("allows explicit prompt-only ingests", async () => {
    const { POST } = await import(routePath);

    const response = await POST(
      new Request("http://localhost/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          promptText: "prompt only",
          ingestKey: "prompt-only",
          allowPromptOnly: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.actionCalls).toHaveLength(1);
    expect(state.actionCalls[0]?.ownerUserId).toBe("telegram:278674008");
    expect(state.actionCalls[0]?.allowPromptOnly).toBe(true);
  });
});
