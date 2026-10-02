import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { AgentAuthError, requireAgentAuth } from "@/lib/server/agent-auth";
import { AGENT_ROUTES } from "@/lib/server/mcp-agent-routes";
import {
  CORS_HEADERS,
  corsPreflight,
  isMcpAllowedUser,
  originFromRequest,
  resourceMetadataUrl,
} from "@/lib/server/mcp-oauth";
import {
  GALLERY_MCP_INSTRUCTIONS,
  registerGalleryTools,
  type JsonRecord,
} from "@/mcp/laniameda-gallery/tools";

// Hosted MCP endpoint (Streamable HTTP, stateless). Clients authenticate with
// OAuth (see lib/server/mcp-oauth.ts) and the access token is a gallery agent
// token, so tool calls go through the same /api/agent/* handlers as the local
// stdio server, dispatched in-process instead of over the network.

// Batch saves run inside this request (see /api/agent/ingest/batch).
export const maxDuration = 300;

const withCors = (response: Response) => {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
};

const unauthorized = (origin: string, description: string, hadToken: boolean) => {
  const challenge = [
    `Bearer resource_metadata="${resourceMetadataUrl(origin)}"`,
    ...(hadToken ? ['error="invalid_token"', `error_description="${description}"`] : []),
  ].join(", ");
  return withCors(
    Response.json(
      { error: hadToken ? "invalid_token" : "unauthorized", error_description: description },
      { status: 401, headers: { "www-authenticate": challenge } },
    ),
  );
};

const createApiFetch =
  (origin: string, authorization: string) => async (path: string, body: JsonRecord) => {
    const handler = AGENT_ROUTES[path];
    if (!handler) throw new Error(`Unknown gallery API path: ${path}`);

    const response = await handler(
      new Request(`${origin}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization },
        body: JSON.stringify(body),
      }),
    );
    const text = await response.text();
    let parsed: JsonRecord;
    try {
      parsed = text ? (JSON.parse(text) as JsonRecord) : {};
    } catch {
      parsed = { error: text };
    }
    if (!response.ok) {
      throw new Error(
        typeof parsed.error === "string" ? parsed.error : `Request failed with HTTP ${response.status}`,
      );
    }
    return parsed;
  };

export async function POST(request: Request) {
  const origin = originFromRequest(request);
  const authorization = request.headers.get("authorization") ?? "";
  const hadToken = /^bearer\s+\S/i.test(authorization);

  try {
    const auth = await requireAgentAuth(request, "gallery:read");
    if (!isMcpAllowedUser(auth.ownerUserId)) {
      return withCors(
        Response.json(
          { error: "insufficient_scope", error_description: "This gallery's MCP is private." },
          { status: 403 },
        ),
      );
    }
  } catch (error) {
    if (error instanceof AgentAuthError) {
      return unauthorized(origin, error.message, hadToken);
    }
    throw error;
  }

  const server = new McpServer(
    { name: "laniameda-gallery", version: "0.2.0" },
    { instructions: GALLERY_MCP_INSTRUCTIONS },
  );
  registerGalleryTools(server, {
    apiFetch: createApiFetch(origin, authorization),
    apiUrl: origin,
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return withCors(await transport.handleRequest(request));
  } finally {
    // JSON mode resolves only after the reply is complete, so closing here is safe.
    void server.close();
  }
}

// Stateless server: no standalone SSE stream to open and no session to end.
const methodNotAllowed = () =>
  withCors(
    Response.json(
      { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null },
      { status: 405, headers: { allow: "POST, OPTIONS" } },
    ),
  );

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = corsPreflight;
