import { createHash } from "node:crypto";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, mock, test } from "bun:test";

process.env.MCP_OAUTH_SECRET = "test-mcp-oauth-secret-0123456789abcdef";
process.env.MCP_ALLOWED_USER_IDS = "278674008";
process.env.AGENT_TOKEN_ISSUER_SECRET = "issuer-secret";

const state = {
  agentOwner: "telegram:278674008",
  agentValid: true,
  mintedTokens: [] as Array<Record<string, unknown>>,
  redeemedCodes: new Set<string>(),
  galleryCalls: [] as Array<{ authorization: string | null; body: Record<string, unknown> }>,
};

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
  createAgentTokenSecret: () => "lgat_test_secret_token_value",
  hashAgentToken: (token: string) => `hash:${token}`,
  tokenPrefix: (token: string) => token.slice(0, 14),
  requireAgentTokenIssuerSecret: () => "issuer-secret",
  requireAgentAuth: async (request: Request) => {
    if (!request.headers.get("authorization")) throw new MockAgentAuthError("Missing bearer token.");
    if (!state.agentValid) throw new MockAgentAuthError("Invalid agent token or missing scope.");
    return {
      tokenId: "agentTokens:1",
      ownerUserId: state.agentOwner,
      tokenPrefix: "lgat_prefix",
      label: "MCP",
      scopes: ["gallery:read", "gallery:write"],
    };
  },
}));

mock.module("@/lib/server/convex", () => ({
  getServerConvexClient: () => ({
    mutation: async (_reference: unknown, payload: Record<string, unknown>) => {
      if (typeof payload.oauthCodeHash === "string") {
        if (state.redeemedCodes.has(payload.oauthCodeHash)) throw new ConvexError("OAuth authorization code already used.");
        state.redeemedCodes.add(payload.oauthCodeHash);
      }
      state.mintedTokens.push(payload);
      return { _id: "agentTokens:new" };
    },
  }),
}));

const passthroughRoute = (path: string) => async (request: Request) => {
  const body = (await request.json()) as Record<string, unknown>;
  state.galleryCalls.push({ authorization: request.headers.get("authorization"), body });
  if (body.action === "listFolders") return Response.json({ folders: [{ _id: "f1" }, { _id: "f2" }] });
  return Response.json({ path, ok: true });
};

// Mock the dispatch table, not the route modules: bun module mocks are
// process-wide and the agent route tests import the real handlers.
mock.module("@/lib/server/mcp-agent-routes", () => ({
  AGENT_ROUTES: Object.fromEntries(
    [
      "/api/agent/customize",
      "/api/agent/gallery",
      "/api/agent/ingest",
      "/api/agent/ingest/batch",
      "/api/agent/ingest/delete",
      "/api/agent/ingest/update",
      "/api/agent/uploads",
      "/api/agent/stories",
      "/api/agent/presets",
      "/api/agent/instructions",
    ].map((path) => [path, passthroughRoute(path)]),
  ),
}));

const oauth = await import("../lib/server/mcp-oauth");
const tokenRoute = await import("../app/api/oauth/token/route");
const mcpRoute = await import("../app/api/mcp/route");

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "a".repeat(20) + "-verifier-" + "b".repeat(20);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

const register = async () =>
  (await oauth.registerClient({ client_name: "Claude", redirect_uris: [REDIRECT] })).client_id;

const authorizeParams = (clientId: string, overrides: Record<string, string> = {}) =>
  new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "xyz",
    ...overrides,
  });

const approvedCode = async (ownerUserId = "telegram:278674008") => {
  const clientId = await register();
  const validation = await oauth.validateAuthorizeParams(authorizeParams(clientId));
  if (!validation.ok) throw new Error("expected a valid request");
  return { clientId, code: await oauth.issueAuthorizationCode(validation.request, ownerUserId) };
};

const tokenRequest = (params: Record<string, string>) =>
  tokenRoute.POST(
    new Request("https://gallery.test/api/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    }),
  );

const mcpRequest = (body: unknown, authorization?: string) =>
  mcpRoute.POST(
    new Request("https://gallery.test/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        host: "gallery.test",
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

describe("MCP OAuth", () => {
  beforeEach(() => {
    state.agentOwner = "telegram:278674008";
    state.agentValid = true;
    state.mintedTokens = [];
    state.redeemedCodes = new Set();
    state.galleryCalls = [];
    process.env.MCP_ALLOWED_USER_IDS = "278674008";
  });

  test("metadata points the MCP resource at this server", () => {
    const resource = oauth.protectedResourceMetadata("https://gallery.test");
    expect(resource.resource).toBe("https://gallery.test/api/mcp");
    expect(resource.authorization_servers).toEqual(["https://gallery.test"]);
    const server = oauth.authorizationServerMetadata("https://gallery.test");
    expect(server.code_challenge_methods_supported).toEqual(["S256"]);
    expect(server.registration_endpoint).toBe("https://gallery.test/api/oauth/register");
  });

  test("registration accepts https and loopback redirects, rejects the rest", async () => {
    expect(oauth.isAcceptableRedirectUri("https://claude.ai/cb")).toBe(true);
    expect(oauth.isAcceptableRedirectUri("http://localhost:4567/callback")).toBe(true);
    expect(oauth.isAcceptableRedirectUri("http://127.0.0.1:9/cb")).toBe(true);
    expect(oauth.isAcceptableRedirectUri("cursor://anysphere.cursor-mcp/oauth")).toBe(true);
    expect(oauth.isAcceptableRedirectUri("http://evil.example/cb")).toBe(false);
    expect(oauth.isAcceptableRedirectUri("javascript:alert(1)")).toBe(false);
    await expect(oauth.registerClient({ redirect_uris: ["http://evil.example/cb"] })).rejects.toThrow();
    await expect(oauth.registerClient({ redirect_uris: [] })).rejects.toThrow();
  });

  test("an unregistered client or mismatched redirect never redirects", async () => {
    const forged = await oauth.validateAuthorizeParams(authorizeParams("not-a-client"));
    expect(forged).toMatchObject({ ok: false, kind: "page" });

    const clientId = await register();
    const wrongRedirect = await oauth.validateAuthorizeParams(
      authorizeParams(clientId, { redirect_uri: "https://evil.example/cb" }),
    );
    expect(wrongRedirect).toMatchObject({ ok: false, kind: "page" });
  });

  test("a trusted redirect gets protocol errors back, e.g. missing PKCE", async () => {
    const clientId = await register();
    const params = authorizeParams(clientId);
    params.delete("code_challenge");
    const result = await oauth.validateAuthorizeParams(params);
    expect(result.ok).toBe(false);
    if (result.ok || result.kind !== "redirect") throw new Error("expected redirect");
    const location = new URL(result.location);
    expect(location.origin + location.pathname).toBe(REDIRECT);
    expect(location.searchParams.get("error")).toBe("invalid_request");
    expect(location.searchParams.get("state")).toBe("xyz");
  });

  test("scopes default to the full gallery set and always include read", () => {
    expect(oauth.parseScopes(null)).toEqual(["gallery:read", "gallery:write", "gallery:delete"]);
    expect(oauth.parseScopes("gallery:write")).toEqual(["gallery:read", "gallery:write"]);
    expect(() => oauth.parseScopes("gallery:read bogus")).toThrow("Unsupported gallery scope");
  });

  test("sequential and concurrent code redemption mint exactly one token", async () => {
    const { clientId, code } = await approvedCode();
    const params = { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: VERIFIER };
    const responses = await Promise.all([tokenRequest(params), tokenRequest(params)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
    expect(state.mintedTokens).toHaveLength(1);
    const replay = await tokenRequest(params);
    expect(replay.status).toBe(400);
    expect((await replay.json()).error).toBe("invalid_grant");
    expect(state.mintedTokens).toHaveLength(1);
  });

  test("token exchange requires the bound redirect URI", async () => {
    const { clientId, code } = await approvedCode();
    const response = await tokenRequest({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: VERIFIER });
    expect(response.status).toBe(400);
    expect(state.mintedTokens).toHaveLength(0);
  });

  test("only the configured owner is allowed", () => {
    expect(oauth.isMcpAllowedUser("telegram:278674008")).toBe(true);
    expect(oauth.isMcpAllowedUser("278674008")).toBe(true);
    expect(oauth.isMcpAllowedUser("telegram:111")).toBe(false);
    process.env.MCP_ALLOWED_USER_IDS = "";
    const previousOwner = process.env.KB_OWNER_USER_ID;
    delete process.env.KB_OWNER_USER_ID;
    expect(oauth.isMcpAllowedUser("telegram:278674008")).toBe(false);
    if (previousOwner !== undefined) process.env.KB_OWNER_USER_ID = previousOwner;
  });

  test("a consent ticket can't be used as an authorization code", async () => {
    const clientId = await register();
    const validation = await oauth.validateAuthorizeParams(authorizeParams(clientId));
    if (!validation.ok) throw new Error("expected valid");
    const ticket = await oauth.signConsentTicket(validation.request, "telegram:278674008");
    expect((await oauth.readConsentTicket(ticket))?.ownerUserId).toBe("telegram:278674008");
    const response = await tokenRequest({
      grant_type: "authorization_code",
      code: ticket,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
    });
    expect(response.status).toBe(400);
    expect(state.mintedTokens).toHaveLength(0);
  });

  test("token endpoint mints an agent token for a valid code + verifier", async () => {
    const { clientId, code } = await approvedCode();
    const response = await tokenRequest({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.access_token).toBe("lgat_test_secret_token_value");
    expect(body.token_type).toBe("Bearer");
    expect(body.scope).toBe("gallery:read gallery:write gallery:delete");
    expect(state.mintedTokens).toHaveLength(1);
    expect(state.mintedTokens[0]).toMatchObject({
      ownerUserId: "telegram:278674008",
      label: "MCP · Claude",
      tokenHash: "hash:lgat_test_secret_token_value",
    });
  });

  test("token endpoint refuses a wrong verifier, client or redirect", async () => {
    const { clientId, code } = await approvedCode();
    const base = {
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
    };
    const otherClient = await oauth.registerClient({ redirect_uris: [REDIRECT] });

    for (const params of [
      { ...base, code_verifier: "c".repeat(50) },
      { ...base, client_id: otherClient.client_id },
      { ...base, redirect_uri: "https://claude.ai/other" },
      { ...base, grant_type: "refresh_token" },
    ]) {
      const response = await tokenRequest(params);
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    expect(state.mintedTokens).toHaveLength(0);
  });

  test("token endpoint refuses a code for someone who is no longer allowed", async () => {
    const { clientId, code } = await approvedCode("telegram:999");
    const response = await tokenRequest({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
    });
    expect(response.status).toBe(403);
    expect(state.mintedTokens).toHaveLength(0);
  });
});

describe("hosted MCP endpoint", () => {
  beforeEach(() => {
    state.agentOwner = "telegram:278674008";
    state.agentValid = true;
    state.galleryCalls = [];
    process.env.MCP_ALLOWED_USER_IDS = "278674008";
  });

  const initialize = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    },
  };

  test("no token: 401 with a resource_metadata challenge", async () => {
    const response = await mcpRequest(initialize);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://gallery.test/.well-known/oauth-protected-resource/api/mcp"',
    );
  });

  test("bad token: 401 invalid_token", async () => {
    state.agentValid = false;
    const response = await mcpRequest(initialize, "Bearer lgat_revoked");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  test("a valid token for someone else's gallery is refused", async () => {
    state.agentOwner = "telegram:555";
    const response = await mcpRequest(initialize, "Bearer lgat_other");
    expect(response.status).toBe(403);
  });

  test("initialize and tools/list work for the owner, without filePath", async () => {
    const init = await mcpRequest(initialize, "Bearer lgat_owner");
    expect(init.status).toBe(200);
    const initBody = (await init.json()) as { result: { serverInfo: { name: string }; instructions?: string } };
    expect(initBody.result.serverInfo.name).toBe("laniameda-gallery");
    expect(initBody.result.instructions).toContain("agentDescription");

    const list = await mcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }, "Bearer lgat_owner");
    const listBody = (await list.json()) as {
      result: { tools: Array<{ name: string; inputSchema: { properties?: Record<string, unknown> } }> };
    };
    const names = listBody.result.tools.map((tool) => tool.name);
    expect(names).toContain("search_gallery");
    expect(names).toContain("preview_assets");
    expect(names).toContain("prepare_uploads");
    expect(names).toContain("save_assets");
    expect(names).toContain("save_story");
    expect(names).toContain("update_story");
    expect(names).toContain("get_story_revisions");
    expect(names).toContain("save_filter_preset");
    expect(names).toContain("get_skill_instructions");
    const saveAsset = listBody.result.tools.find((tool) => tool.name === "save_asset");
    expect(saveAsset?.inputSchema.properties).toHaveProperty("url");
    expect(saveAsset?.inputSchema.properties).not.toHaveProperty("filePath");
  });

  test("tool calls reach the agent API in-process with the caller's token", async () => {
    const response = await mcpRequest(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "check_connection", arguments: {} } },
      "Bearer lgat_owner",
    );
    const body = (await response.json()) as { result: { content: Array<{ text: string }> } };
    const payload = JSON.parse(body.result.content[0]!.text) as Record<string, unknown>;
    expect(payload).toMatchObject({ ok: true, authenticated: true, collectionCount: 2 });
    expect(state.galleryCalls[0]).toEqual({
      authorization: "Bearer lgat_owner",
      body: { action: "listFolders" },
    });
  });

  test("a hosted body-only story edit forwards no default metadata", async () => {
    const response = await mcpRequest(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "update_story", arguments: { id: "story:one", body: "Revised opening", expectedRevision: 2 } } },
      "Bearer lgat_owner",
    );
    expect(response.status).toBe(200);
    expect(state.galleryCalls[0]).toEqual({ authorization: "Bearer lgat_owner", body: { action: "update", id: "story:one", body: "Revised opening", expectedRevision: 2 } });
  });

  test("instructions use the connector bearer token and requested resource", async () => {
    const response = await mcpRequest({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_skill_instructions", arguments: { resource: "references/worlds.md" } } }, "Bearer lgat_owner");
    expect(response.status).toBe(200);
    expect(state.galleryCalls[0]).toEqual({ authorization: "Bearer lgat_owner", body: { resource: "references/worlds.md" } });
  });

  test("save_assets forwards uploadIds with their original file names", async () => {
    const response = await mcpRequest(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "save_assets",
          arguments: {
            items: [
              { uploadId: "upload-1", fileName: "frame 01.png", tagNames: ["character"] },
              { url: "https://example.test/b.jpg" },
            ],
          },
        },
      },
      "Bearer lgat_owner",
    );
    expect(response.status).toBe(200);
    expect(state.galleryCalls.at(-1)?.body).toEqual({
      items: [
        { uploadId: "upload-1", fileName: "frame 01.png", tagNames: ["character"] },
        { url: "https://example.test/b.jpg" },
      ],
    });
  });

  test("GET is not offered on the stateless endpoint", async () => {
    const response = mcpRoute.GET();
    expect(response.status).toBe(405);
  });
});
