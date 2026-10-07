import { beforeEach, describe, expect, mock, test } from "bun:test";

const state = {
  ownerUserId: "telegram:278674008",
  requiredScopes: [] as string[],
  actionCalls: [] as Array<{ payload: Record<string, unknown> }>,
  actionResult: { ok: true } as Record<string, unknown>,
  queryCalls: [] as Array<{ payload: Record<string, unknown> }>,
  mutationCalls: [] as Array<{ payload: Record<string, unknown> }>,
  queryFailure: undefined as string | undefined,
  mutationFailure: undefined as string | undefined,
};

const ingestRoutePath = new URL("../app/api/agent/ingest/route.ts", import.meta.url).pathname;
const ingestUpdateRoutePath = new URL(
  "../app/api/agent/ingest/update/route.ts",
  import.meta.url,
).pathname;
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
      return state.actionResult;
    },
    query: async (_reference: unknown, payload: Record<string, unknown>) => {
      state.queryCalls.push({ payload });
      if (state.queryFailure) throw new Error(state.queryFailure);
      return [];
    },
    mutation: async (_reference: unknown, payload: Record<string, unknown>) => {
      state.mutationCalls.push({ payload });
      if (state.mutationFailure) throw new Error(state.mutationFailure);
      return { ok: true };
    },
  }),
}));

describe("agent API routes", () => {
  beforeEach(() => {
    state.ownerUserId = "telegram:278674008";
    state.requiredScopes = [];
    state.actionCalls = [];
    state.actionResult = { ok: true };
    state.queryCalls = [];
    state.mutationCalls = [];
    state.queryFailure = undefined;
    state.mutationFailure = undefined;
  });

  test("complete listing rejects unknown predicates and token-owner overrides", async () => {
    const { POST } = await import(galleryRoutePath);
    for (const bad of [{ pieceType: "characters" }, { ownerUserId: "attacker" }, { pageSize: 201 }]) {
      const response = await POST(new Request("http://localhost/api/agent/gallery", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "listAssetsPage", ...bad }),
      }));
      expect(response.status).toBe(400);
    }
    expect(state.queryCalls).toHaveLength(0);
    const response = await POST(new Request("http://localhost/api/agent/gallery", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "listAssetsPage", folderId: "folders:1", includeDescendants: true, includeWorkflowAssets: false, cursor: "cursor", pageSize: 100 }),
    }));
    expect(response.status).toBe(200);
    expect(state.queryCalls[0]?.payload).toEqual({ ownerUserId: state.ownerUserId, folderId: "folders:1", includeDescendants: true, includeWorkflowAssets: false, cursor: "cursor", pageSize: 100 });
    expect(state.requiredScopes.every(scope => scope === "gallery:read")).toBe(true);
  });

  test("menu discovery is read-scoped and child storybooks are write-scoped", async () => {
    const { POST } = await import(customizeRoutePath);
    const send = (payload: Record<string, unknown>) => POST(new Request("http://localhost/api/agent/customize", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    }));
    expect((await send({ action: "listMenuFilters" })).status).toBe(200);
    expect((await send({ action: "createFolder", name: "Board", parentFolderId: "folders:parent", kind: "storybook", ownerUserId: "attacker" })).status).toBe(200);
    expect(state.requiredScopes).toEqual(["gallery:read", "gallery:write"]);
    expect(state.mutationCalls[0]?.payload).toMatchObject({ ownerUserId: state.ownerUserId, name: "Board", parentFolderId: "folders:parent", kind: "storybook" });
  });

  test("explicit collection options preserve false and do not invent publication intent", async () => {
    const { POST } = await import(customizeRoutePath);
    for (const [option, field] of [["pinned", "pinned"], ["hidden", "hidden"], ["showcased", "showcased"], ["featured", "featured"]]) {
      const response = await POST(new Request("http://localhost/api/agent/customize", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "setCollectionOption", folderId: "folders:1", option, enabled: false }),
      }));
      expect(response.status).toBe(200);
      expect(state.mutationCalls.at(-1)?.payload).toEqual({ ownerUserId: state.ownerUserId, folderId: "folders:1", [field]: false });
    }
    const response = await POST(new Request("http://localhost/api/agent/customize", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "setCollectionOption", folderId: "folders:1", option: "cover", assetId: null }),
    }));
    expect(response.status).toBe(200);
    expect(state.mutationCalls.at(-1)?.payload).toEqual({ ownerUserId: state.ownerUserId, folderId: "folders:1", assetId: null });
    expect(state.requiredScopes.every(scope => scope === "gallery:write")).toBe(true);
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

  test("agent ingest resolves multiple asset collections after create", async () => {
    const { POST } = await import(ingestRoutePath);
    state.actionResult = { assetId: "assets:1" };

    const response = await POST(
      new Request("http://localhost/api/agent/ingest", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          promptText: "cinematic romance",
          url: "https://example.com/video.mp4",
          folderIds: ["folders:love", "folders:cinematic", "folders:love"],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.actionCalls[0]?.payload).toMatchObject({
      ownerUserId: "telegram:278674008",
      folderId: "folders:love",
    });
    expect(state.actionCalls[0]?.payload.folderIds).toBeUndefined();
    expect(state.mutationCalls[0]?.payload).toMatchObject({
      ownerUserId: "telegram:278674008",
      assetId: "assets:1",
      folderIds: ["folders:love", "folders:cinematic"],
    });
  });

  test("agent asset update replaces multiple collections", async () => {
    const { POST } = await import(ingestUpdateRoutePath);
    state.actionResult = { target: "asset", assetId: "assets:1" };

    const response = await POST(
      new Request("http://localhost/api/agent/ingest/update", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          target: "asset",
          id: "assets:1",
          folderIds: ["folders:love", "folders:cinematic"],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.actionCalls[0]?.payload).toEqual({
      target: "asset",
      id: "assets:1",
      ownerUserId: "telegram:278674008",
    });
    expect(state.mutationCalls[0]?.payload).toMatchObject({
      ownerUserId: "telegram:278674008",
      folderIds: ["folders:love", "folders:cinematic"],
    });
  });

  test("invalid secondary collections reject before creating or changing media", async () => {
    state.queryFailure = "Collection not found.";
    for (const routePath of [ingestRoutePath, ingestUpdateRoutePath]) {
      const { POST } = await import(routePath);
      const response = await POST(new Request("http://localhost/api/agent/ingest", {
        method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test" },
        body: JSON.stringify({ target: "asset", id: "assets:1", url: "https://example.com/movie.mp4", folderIds: ["folders:valid", "folders:foreign"] }),
      }));
      expect(response.status).toBe(400);
    }
    expect(state.actionCalls).toHaveLength(0);
    expect(state.mutationCalls).toHaveLength(0);
  });

  test("a filing race reports the persisted ID instead of an empty save failure", async () => {
    state.actionResult = { assetId: "assets:persisted", created: true };
    state.mutationFailure = "Collection was deleted.";
    const { POST } = await import(ingestRoutePath);
    const response = await POST(new Request("http://localhost/api/agent/ingest", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify({ url: "https://example.com/movie.mp4", ingestKey: "test:movie", folderIds: ["folders:valid"] }),
    }));
    expect(response.status).toBe(207);
    expect(await response.json()).toMatchObject({ ok: false, partial: true, assetId: "assets:persisted", result: { assetId: "assets:persisted" }, failedStep: "collections" });
    expect(state.actionCalls).toHaveLength(1);
  });

  test("a partly persisted create reports its IDs and stops secondary filing", async () => {
    state.actionResult = { promptId: "prompts:persisted", assetId: "assets:persisted", partial: true, failedStep: "upstreamInputs", error: "Source was deleted during the save." };
    const { POST } = await import(ingestRoutePath);
    const response = await POST(new Request("http://localhost/api/agent/ingest", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify({ url: "https://example.com/movie.mp4", ingestKey: "test:partial-create", folderIds: ["folders:valid"] }),
    }));
    expect(response.status).toBe(207);
    expect(await response.json()).toMatchObject({ ok: false, partial: true, promptId: "prompts:persisted", assetId: "assets:persisted", failedStep: "upstreamInputs" });
    expect(state.mutationCalls).toHaveLength(0);
  });

  test("a partly persisted media update remains explicit at the HTTP boundary", async () => {
    state.actionResult = { target: "asset", assetId: "assets:persisted", partial: true, failedStep: "media", error: "Read before retrying." };
    const { POST } = await import(ingestUpdateRoutePath);
    const response = await POST(new Request("http://localhost/api/agent/ingest/update", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test" }, body: JSON.stringify({ target: "asset", id: "assets:persisted" }),
    }));
    expect(response.status).toBe(207);
    expect(await response.json()).toMatchObject({ ok: false, partial: true, result: { assetId: "assets:persisted", failedStep: "media" } });
    expect(state.mutationCalls).toHaveLength(0);
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
          kind: "image",
          limit: 5,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.requiredScopes).toEqual(["gallery:read"]);
    expect(state.queryCalls[0]?.payload).toMatchObject({
      ownerUserId: "telegram:278674008",
      kind: "image",
      limit: 5,
    });
  });

  test("agent contact sheet strips typed ids and pins the token owner", async () => {
    const { POST } = await import(galleryRoutePath);
    state.actionResult = { imageBase64: "AAAA", cells: [] };

    const response = await POST(
      new Request("http://localhost/api/agent/gallery", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "contactSheet",
          ownerUserId: "attacker",
          ids: ["asset:a1", "a2"],
          columns: 2,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.requiredScopes).toEqual(["gallery:read"]);
    expect(state.actionCalls[0]?.payload).toEqual({
      ownerUserId: "telegram:278674008",
      assetIds: ["a1", "a2"],
      columns: 2,
      maxEdge: undefined,
    });
    expect(await response.json()).toEqual({ sheet: { imageBase64: "AAAA", cells: [] } });
  });

  test("agent contact sheet requires ids", async () => {
    const { POST } = await import(galleryRoutePath);

    const response = await POST(
      new Request("http://localhost/api/agent/gallery", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "contactSheet" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(state.actionCalls).toEqual([]);
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
          action: "createFolder",
          ownerUserId: "attacker",
          name: "Moodboards",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.requiredScopes).toEqual(["gallery:write"]);
    expect(state.mutationCalls[0]?.payload).toMatchObject({
      ownerUserId: "telegram:278674008",
      name: "Moodboards",
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
