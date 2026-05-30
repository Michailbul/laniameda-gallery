import { beforeEach, describe, expect, mock, test } from "bun:test";

const state = {
  ownerUserId: "telegram:278674008",
  requiredScopes: [] as string[],
  actionCalls: [] as Array<{ payload: Record<string, unknown> }>,
  queryCalls: [] as Array<{ payload: Record<string, unknown> }>,
  mutationCalls: [] as Array<{ payload: Record<string, unknown> }>,
};

const ingestRoutePath = new URL("../app/api/agent/ingest/route.ts", import.meta.url).pathname;
const galleryRoutePath = new URL("../app/api/agent/gallery/route.ts", import.meta.url).pathname;
const customizeRoutePath = new URL("../app/api/agent/customize/route.ts", import.meta.url).pathname;

class MockAgentAuthError extends Error {
  constructor(
    message: string,
    public readonly status = 401,
  ) {
    super(message);
  }
}

mock.module("@/lib/server/agent-auth", () => ({
  AgentAuthError: MockAgentAuthError,
  requireAgentAuth: async (_request: Request, requiredScope: string) => {
    state.requiredScopes.push(requiredScope);
    return {
      tokenId: "agentTokens:1",
      ownerUserId: state.ownerUserId,
      tokenPrefix: "lgat_prefix",
      label: "Codex",
      scopes: ["gallery:read", "gallery:write"],
    };
  },
}));

mock.module("@/lib/server/convex", () => ({
  getServerConvexClient: () => ({
    action: async (_reference: unknown, payload: Record<string, unknown>) => {
      state.actionCalls.push({ payload });
      return { ok: true };
    },
    query: async (_reference: unknown, payload: Record<string, unknown>) => {
      state.queryCalls.push({ payload });
      return [];
    },
    mutation: async (_reference: unknown, payload: Record<string, unknown>) => {
      state.mutationCalls.push({ payload });
      return { ok: true };
    },
  }),
}));

describe("agent API routes", () => {
  beforeEach(() => {
    state.ownerUserId = "telegram:278674008";
    state.requiredScopes = [];
    state.actionCalls = [];
    state.queryCalls = [];
    state.mutationCalls = [];
  });

  test("agent ingest derives ownerUserId from token auth", async () => {
    const { POST } = await import(ingestRoutePath);

    const response = await POST(
      new Request("http://localhost/api/agent/ingest", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ownerUserId: "attacker",
          promptText: "cinematic portrait",
          allowPromptOnly: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.requiredScopes).toEqual(["gallery:write"]);
    expect(state.actionCalls[0]?.payload).toMatchObject({
      ownerUserId: "telegram:278674008",
      promptText: "cinematic portrait",
      allowPromptOnly: true,
      ingestSource: "agent",
    });
  });

  test("agent gallery reads derive ownerUserId from token auth", async () => {
    const { POST } = await import(galleryRoutePath);

    const response = await POST(
      new Request("http://localhost/api/agent/gallery", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "listAssets",
          ownerUserId: "attacker",
          pillar: "creators",
          limit: 5,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.requiredScopes).toEqual(["gallery:read"]);
    expect(state.queryCalls[0]?.payload).toMatchObject({
      ownerUserId: "telegram:278674008",
      pillar: "creators",
      limit: 5,
    });
  });

  test("agent customization writes derive ownerUserId from token auth", async () => {
    const { POST } = await import(customizeRoutePath);

    const response = await POST(
      new Request("http://localhost/api/agent/customize", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "upsertPillar",
          ownerUserId: "attacker",
          label: "Moodboards",
          color: "#abcdef",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.requiredScopes).toEqual(["gallery:write"]);
    expect(state.mutationCalls[0]?.payload).toMatchObject({
      ownerUserId: "telegram:278674008",
      label: "Moodboards",
      color: "#abcdef",
    });
  });

  test("agent folder delete requires delete scope and derives ownerUserId", async () => {
    const { POST } = await import(customizeRoutePath);

    const response = await POST(
      new Request("http://localhost/api/agent/customize", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "deleteFolder",
          ownerUserId: "attacker",
          folderId: "folders:1",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.requiredScopes).toEqual(["gallery:delete"]);
    expect(state.mutationCalls[0]?.payload).toMatchObject({
      ownerUserId: "telegram:278674008",
      folderId: "folders:1",
    });
  });
});
