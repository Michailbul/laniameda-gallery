import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const state = {
  scopes: [] as string[],
  actions: [] as Array<Record<string, unknown>>,
  partFailure: undefined as string | undefined,
};

mock.module("@/lib/server/agent-auth", () => ({
  AgentAuthError: class extends Error {
    constructor(message: string, public readonly status = 401) { super(message); }
  },
  requireAgentAuth: async (_request: Request, scope: string) => {
    state.scopes.push(scope);
    return { tokenId: "agentTokens:1", ownerUserId: "telegram:278674008", tokenPrefix: "lgat_x", label: "test", scopes: ["gallery:read"] };
  },
}));

mock.module("@/lib/server/convex", () => ({
  getServerConvexClient: () => ({
    action: async (_reference: unknown, payload: Record<string, unknown>) => {
      state.actions.push(payload);
      if ("index" in payload) {
        if (state.partFailure) throw new Error(state.partFailure);
        return { url: "https://r2.example/signed-part", bytes: 20 };
      }
      return { generatedAt: 1, parts: [{ index: 0, count: 1, bytes: 20 }] };
    },
  }),
}));

const { POST } = await import("../app/api/agent/inventory/route");
const post = (body: unknown) =>
  POST(new Request("http://localhost/api/agent/inventory", { method: "POST", body: JSON.stringify(body) }));

describe("POST /api/agent/inventory", () => {
  const originalFetch = globalThis.fetch;
  const fetched: string[] = [];
  beforeEach(() => {
    state.scopes.length = 0;
    state.actions.length = 0;
    state.partFailure = undefined;
    fetched.length = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      fetched.push(String(input));
      return new Response('{"assets":[{"_id":"a"}]}', { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("status needs read scope, derives the owner and is never cached", async () => {
    const response = await post({ action: "status", refresh: true, maxAgeMinutes: 60 });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(state.scopes).toEqual(["gallery:read"]);
    expect(state.actions).toEqual([{ ownerUserId: "telegram:278674008", refresh: true, maxAgeMinutes: 60 }]);
  });

  test("a part is fetched server-side and the R2 URL never reaches the agent", async () => {
    const response = await post({ action: "part", generatedAt: 1, index: 0 });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe('{"assets":[{"_id":"a"}]}');
    expect(text).not.toContain("r2.example");
    expect(fetched).toEqual(["https://r2.example/signed-part"]);
  });

  test("a replaced snapshot answers 409 and unknown fields are rejected", async () => {
    state.partFailure = "The inventory export was rebuilt. Read its status again.";
    expect((await post({ action: "part", generatedAt: 1, index: 0 })).status).toBe(409);
    expect((await post({ action: "status", ownerUserId: "someone-else" })).status).toBe(400);
    expect(fetched).toEqual([]);
  });
});
