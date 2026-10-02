import { createHash, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { canActorAccessByUserId, parseUserIdList } from "@/lib/identity";
import type { AgentTokenScope } from "@/lib/server/agent-auth";

// OAuth 2.1 for the hosted MCP endpoint (/api/mcp), sized for one owner.
//
// Everything here is stateless: a registered client, a pending consent and an
// authorization code are each a short HS256 JWT signed with MCP_OAUTH_SECRET
// (falling back to SESSION_SECRET). Each kind carries its own audience, so one
// can never stand in for another, or for a session cookie. The only durable
// record is the agent token minted at the token endpoint, which shows up on
// /agents and can be revoked there.

export const MCP_RESOURCE_PATH = "/api/mcp";
export const MCP_SCOPES: AgentTokenScope[] = ["gallery:read", "gallery:write", "gallery:delete"];
export const MCP_ACCESS_TOKEN_DAYS = 365;

const ISSUER_CLAIM = "laniameda-gallery";
const AUDIENCE = {
  client: "mcp-oauth-client",
  consent: "mcp-oauth-consent",
  code: "mcp-oauth-code",
} as const;
const CONSENT_TTL_SECONDS = 10 * 60;
const CODE_TTL_SECONDS = 2 * 60;

export class OAuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

const signingKey = () => {
  const secret = (process.env.MCP_OAUTH_SECRET ?? process.env.SESSION_SECRET ?? "").trim();
  if (secret.length < 32) {
    throw new Error("MCP_OAUTH_SECRET (or SESSION_SECRET) must be at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
};

const sign = (claims: Record<string, unknown>, audience: string, ttlSeconds?: number) => {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER_CLAIM)
    .setAudience(audience)
    .setIssuedAt();
  if (ttlSeconds) jwt.setExpirationTime(`${ttlSeconds}s`);
  return jwt.sign(signingKey());
};

const verify = async (token: string, audience: string) => {
  try {
    const { payload } = await jwtVerify(token, signingKey(), {
      issuer: ISSUER_CLAIM,
      audience,
      algorithms: ["HS256"],
    });
    return payload;
  } catch {
    return null;
  }
};

// ── Who may connect ──────────────────────────────────────────────────────────

/** Owner ids allowed to authorize the MCP. Empty means nobody (fail closed). */
export const getMcpAllowedUserIds = () =>
  parseUserIdList(process.env.MCP_ALLOWED_USER_IDS ?? process.env.KB_OWNER_USER_ID);

export const isMcpAllowedUser = (ownerUserId: string | null | undefined) =>
  Boolean(ownerUserId) && canActorAccessByUserId(ownerUserId as string, getMcpAllowedUserIds());

// ── Origins and metadata ─────────────────────────────────────────────────────

/** Public origin of this deployment, as the client reached it. */
export const originFromHeaders = (headers: Headers, fallbackUrl?: string) => {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (host) {
    const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
    const proto = forwardedProto || (isLocal ? "http" : "https");
    return `${proto}://${host}`;
  }
  if (fallbackUrl) return new URL(fallbackUrl).origin;
  throw new Error("Cannot resolve the request origin.");
};

export const originFromRequest = (request: Request) =>
  originFromHeaders(request.headers, request.url);

export const resourceMetadataUrl = (origin: string) =>
  `${origin}/.well-known/oauth-protected-resource${MCP_RESOURCE_PATH}`;

export const protectedResourceMetadata = (origin: string) => ({
  resource: `${origin}${MCP_RESOURCE_PATH}`,
  authorization_servers: [origin],
  scopes_supported: MCP_SCOPES,
  bearer_methods_supported: ["header"],
  resource_name: "laniameda.gallery",
});

export const authorizationServerMetadata = (origin: string) => ({
  issuer: origin,
  authorization_endpoint: `${origin}/oauth/authorize`,
  token_endpoint: `${origin}/api/oauth/token`,
  registration_endpoint: `${origin}/api/oauth/register`,
  scopes_supported: MCP_SCOPES,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code"],
  token_endpoint_auth_methods_supported: ["none"],
  code_challenge_methods_supported: ["S256"],
});

// ── Dynamic client registration (RFC 7591) ───────────────────────────────────

export type RegisteredClient = {
  clientId: string;
  clientName: string;
  redirectUris: string[];
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:", "about:"]);

/** https anywhere, http only on loopback, and private-use app schemes (cursor://). */
export const isAcceptableRedirectUri = (value: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return LOOPBACK_HOSTS.has(url.hostname);
  return !BLOCKED_SCHEMES.has(url.protocol);
};

const cleanClientName = (value: unknown) => {
  const name = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return name.slice(0, 80) || "MCP client";
};

export const registerClient = async (body: Record<string, unknown>) => {
  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((uri): uri is string => typeof uri === "string")
    : [];
  if (redirectUris.length === 0 || redirectUris.length > 10) {
    throw new OAuthError("invalid_redirect_uri", "Register between 1 and 10 redirect_uris.");
  }
  const rejected = redirectUris.find((uri) => !isAcceptableRedirectUri(uri));
  if (rejected) {
    throw new OAuthError("invalid_redirect_uri", `Redirect URI not allowed: ${rejected}`);
  }

  const authMethod = body.token_endpoint_auth_method;
  if (authMethod !== undefined && authMethod !== "none") {
    throw new OAuthError(
      "invalid_client_metadata",
      "Only public clients (token_endpoint_auth_method: none) are supported.",
    );
  }

  const clientName = cleanClientName(body.client_name);
  const clientId = await sign({ name: clientName, uris: redirectUris }, AUDIENCE.client);

  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
};

export const resolveClient = async (clientId: string | null | undefined) => {
  if (!clientId) return null;
  const payload = await verify(clientId, AUDIENCE.client);
  if (!payload || !Array.isArray(payload.uris)) return null;
  return {
    clientId,
    clientName: cleanClientName(payload.name),
    redirectUris: payload.uris.filter((uri): uri is string => typeof uri === "string"),
  } satisfies RegisteredClient;
};

// ── Authorization request ────────────────────────────────────────────────────

export type AuthorizationRequest = {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scopes: AgentTokenScope[];
  resource?: string;
};

export const parseScopes = (raw: string | null | undefined): AgentTokenScope[] => {
  const requested = (raw ?? "").split(/\s+/).filter(Boolean);
  const granted = MCP_SCOPES.filter((scope) => requested.includes(scope));
  // No (or no known) scope asked for: grant the full gallery set, which is what
  // a generic connector expects. Read is always included.
  if (granted.length === 0) return [...MCP_SCOPES];
  return granted.includes("gallery:read") ? granted : ["gallery:read", ...granted];
};

/** Where to send an error back to the client, once its redirect is trusted. */
export const errorRedirect = (
  redirectUri: string,
  error: string,
  state: string | undefined,
  description?: string,
) => {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (description) url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  return url.toString();
};

export type AuthorizeValidation =
  | { ok: true; request: AuthorizationRequest }
  // The client or redirect can't be trusted: show the error, never redirect.
  | { ok: false; kind: "page"; message: string }
  // The redirect is trusted: hand the error back to the client.
  | { ok: false; kind: "redirect"; location: string };

export const validateAuthorizeParams = async (
  params: URLSearchParams,
): Promise<AuthorizeValidation> => {
  const client = await resolveClient(params.get("client_id"));
  if (!client) {
    return { ok: false, kind: "page", message: "This client is not registered with the gallery." };
  }

  const redirectUri = params.get("redirect_uri") ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : null);
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
    return { ok: false, kind: "page", message: "The redirect address does not match this client." };
  }

  const state = params.get("state") ?? undefined;
  const fail = (error: string, description: string) => ({
    ok: false as const,
    kind: "redirect" as const,
    location: errorRedirect(redirectUri, error, state, description),
  });

  if (params.get("response_type") !== "code") {
    return fail("unsupported_response_type", "Only response_type=code is supported.");
  }
  const codeChallenge = params.get("code_challenge");
  if (!codeChallenge || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
    return fail("invalid_request", "A PKCE code_challenge is required.");
  }
  if ((params.get("code_challenge_method") ?? "plain") !== "S256") {
    return fail("invalid_request", "code_challenge_method must be S256.");
  }

  return {
    ok: true,
    request: {
      clientId: client.clientId,
      clientName: client.clientName,
      redirectUri,
      codeChallenge,
      state,
      scopes: parseScopes(params.get("scope")),
      resource: params.get("resource") ?? undefined,
    },
  };
};

// ── Consent ticket → authorization code ──────────────────────────────────────

/** Binds the consent form to the signed-in owner and the validated request. */
export const signConsentTicket = (request: AuthorizationRequest, ownerUserId: string) =>
  sign({ ...request, sub: ownerUserId }, AUDIENCE.consent, CONSENT_TTL_SECONDS);

export const readConsentTicket = async (ticket: string) => {
  const payload = await verify(ticket, AUDIENCE.consent);
  if (!payload || typeof payload.sub !== "string") return null;
  return {
    ownerUserId: payload.sub,
    request: {
      clientId: payload.clientId as string,
      clientName: payload.clientName as string,
      redirectUri: payload.redirectUri as string,
      codeChallenge: payload.codeChallenge as string,
      state: payload.state as string | undefined,
      scopes: payload.scopes as AgentTokenScope[],
      resource: payload.resource as string | undefined,
    } satisfies AuthorizationRequest,
  };
};

export const issueAuthorizationCode = (request: AuthorizationRequest, ownerUserId: string) =>
  sign(
    {
      sub: ownerUserId,
      cid: createHash("sha256").update(request.clientId).digest("base64url"),
      name: request.clientName,
      ruri: request.redirectUri,
      cc: request.codeChallenge,
      scp: request.scopes,
    },
    AUDIENCE.code,
    CODE_TTL_SECONDS,
  );

const pkceMatches = (verifier: string, challenge: string) => {
  const computed = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
};

export type RedeemedCode = {
  ownerUserId: string;
  clientName: string;
  scopes: AgentTokenScope[];
};

export const redeemAuthorizationCode = async (input: {
  code: string | null;
  clientId: string | null;
  redirectUri: string | null;
  codeVerifier: string | null;
}): Promise<RedeemedCode> => {
  if (!input.code || !input.codeVerifier) {
    throw new OAuthError("invalid_request", "code and code_verifier are required.");
  }
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier)) {
    throw new OAuthError("invalid_grant", "Malformed code_verifier.");
  }

  const payload = await verify(input.code, AUDIENCE.code);
  if (!payload || typeof payload.sub !== "string") {
    throw new OAuthError("invalid_grant", "The authorization code is invalid or expired.");
  }
  const clientHash = input.clientId
    ? createHash("sha256").update(input.clientId).digest("base64url")
    : null;
  if (clientHash !== payload.cid) {
    throw new OAuthError("invalid_grant", "The code was issued to a different client.");
  }
  if (input.redirectUri && input.redirectUri !== payload.ruri) {
    throw new OAuthError("invalid_grant", "redirect_uri does not match the authorization request.");
  }
  if (!pkceMatches(input.codeVerifier, String(payload.cc))) {
    throw new OAuthError("invalid_grant", "PKCE verification failed.");
  }
  if (!isMcpAllowedUser(payload.sub)) {
    throw new OAuthError("access_denied", "This account may not use the gallery MCP.", 403);
  }

  return {
    ownerUserId: payload.sub,
    clientName: cleanClientName(payload.name),
    scopes: Array.isArray(payload.scp) ? (payload.scp as AgentTokenScope[]) : [...MCP_SCOPES],
  };
};

// ── HTTP helpers ─────────────────────────────────────────────────────────────

export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers":
    "authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "www-authenticate, mcp-session-id, mcp-protocol-version",
  "access-control-max-age": "86400",
};

export const oauthJson = (body: unknown, status = 200, extraHeaders?: Record<string, string>) =>
  Response.json(body, {
    status,
    headers: { ...CORS_HEADERS, "cache-control": "no-store", ...extraHeaders },
  });

export const oauthErrorResponse = (error: unknown) => {
  if (error instanceof OAuthError) {
    return oauthJson({ error: error.code, error_description: error.message }, error.status);
  }
  console.error("[mcp-oauth]", error);
  return oauthJson({ error: "server_error", error_description: "Unexpected server error." }, 500);
};

export const corsPreflight = () => new Response(null, { status: 204, headers: CORS_HEADERS });
