import { beforeEach, describe, expect, mock, test } from "bun:test";

const state = {
  authUserId: "telegram:278674008",
  actionCalls: [] as Array<{ payload: Record<string, unknown> }>,
  actionResult: { ok: true } as Record<string, unknown>,
};

const updateRoutePath = new URL("../app/api/ingest/update/route.ts", import.meta.url).pathname;
const deleteRoutePath = new URL("../app/api/ingest/delete/route.ts", import.meta.url).pathname;

mock.module("@/lib/server-auth", () => ({
  requireAuth: async () => ({ id: state.authUserId }),
}));

mock.module("@/lib/server/convex", () => ({
  getServerConvexClient: () => ({
    action: async (_reference: unknown, payload: Record<string, unknown>) => {
      state.actionCalls.push({ payload });
      return state.actionResult;
    },
  }),
}));

describe("ingest management routes", () => {
  beforeEach(() => {
    state.authUserId = "telegram:278674008";
    state.actionCalls = [];
    state.actionResult = { ok: true };
  });

  test("POST /api/ingest/update injects the authenticated ownerUserId", async () => {
    state.actionResult = { target: "prompt", promptId: "prompts:1" };
    const { POST } = await import(updateRoutePath);

    const response = await POST(
      new Request("http://localhost/api/ingest/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target: "prompt",
          ingestKey: "prompt:key",
          promptText: "Updated prompt",
          ownerUserId: "ignore-me",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.actionCalls).toHaveLength(1);
    expect(state.actionCalls[0]?.payload).toEqual({
      target: "prompt",
      ingestKey: "prompt:key",
      promptText: "Updated prompt",
      ownerUserId: "telegram:278674008",
    });

    const payload = (await response.json()) as {
      ok: boolean;
      result: Record<string, unknown>;
    };
    expect(payload.ok).toBeTrue();
    expect(payload.result.promptId).toBe("prompts:1");
  });

  test("DELETE /api/ingest/delete injects the authenticated ownerUserId", async () => {
    state.actionResult = { target: "asset", deleted: true, assetId: "assets:1" };
    const { DELETE } = await import(deleteRoutePath);

    const response = await DELETE(
      new Request("http://localhost/api/ingest/delete", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target: "asset",
          ingestKey: "asset:key",
          ownerUserId: "ignore-me",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.actionCalls).toHaveLength(1);
    expect(state.actionCalls[0]?.payload).toEqual({
      target: "asset",
      ingestKey: "asset:key",
      ownerUserId: "telegram:278674008",
    });

    const payload = (await response.json()) as {
      ok: boolean;
      result: Record<string, unknown>;
    };
    expect(payload.ok).toBeTrue();
    expect(payload.result.deleted).toBeTrue();
  });

  test("returns 400 for invalid JSON payloads", async () => {
    const { POST } = await import(updateRoutePath);

    const response = await POST(
      new Request("http://localhost/api/ingest/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    expect(state.actionCalls).toHaveLength(0);
  });
});
