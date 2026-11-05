// Magnific through its MCP server (https://mcp.magnific.com) with Michael's own
// sign-in, the way the board's quickedit.py does it: a Streamable HTTP session,
// tools/call, results read from structuredContent or the text part. Plus the
// OAuth constants for Settings → Connect Magnific (Keycloak realm "mcp").

export const MAGNIFIC_MCP_URL = "https://mcp.magnific.com";
export const MAGNIFIC_ISSUER = "https://auth.magnific.com/realms/mcp";
export const MAGNIFIC_AUTHORIZE_URL = `${MAGNIFIC_ISSUER}/protocol/openid-connect/auth`;
export const MAGNIFIC_TOKEN_URL = `${MAGNIFIC_ISSUER}/protocol/openid-connect/token`;
export const MAGNIFIC_SCOPE = "openid profile email mcp:custom-audience";
// A public client registered for the gallery on 3 Nov 2026 (dynamic client
// registration, PKCE, no secret). Its redirect URIs are
// https://gallery.laniameda.space/api/settings/magnific/callback and
// http://localhost/api/settings/magnific/callback (any port).
export const MAGNIFIC_CLIENT_ID = "d4478f2d-9ab6-4c4e-ab13-ed82575dd5d2";
export const MAGNIFIC_CALLBACK_PATH = "/api/settings/magnific/callback";

export type MagnificTokens = {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. */
  expiresAt: number;
  clientId: string;
};

/** The sign-in expired or was revoked: reconnect in Settings. */
export class MagnificAuthError extends Error {}
/** A refusal the next route should take over: out of credit, a blocked model. */
export class MagnificRefusal extends Error {
  constructor(message: string, readonly outOfCredit: boolean) { super(message); }
}

const TIMEOUT_MS = 90 * 1000;

export async function exchangeMagnificToken(body: Record<string, string>): Promise<MagnificTokens> {
  const response = await fetch(MAGNIFIC_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(30 * 1000),
  });
  const json = await response.json().catch(() => null) as
    | { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string }
    | null;
  if (!response.ok || !json?.access_token) {
    const why = json?.error_description || json?.error || `HTTP ${response.status}`;
    throw new MagnificAuthError(`Magnific sign-in failed: ${why}`);
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? body.refresh_token,
    expiresAt: Date.now() + Math.max(60, json.expires_in ?? 300) * 1000,
    clientId: body.client_id ?? MAGNIFIC_CLIENT_ID,
  };
}

export const refreshMagnificTokens = (tokens: MagnificTokens) => {
  if (!tokens.refreshToken) throw new MagnificAuthError("Magnific sign-in expired. Reconnect it in Settings.");
  return exchangeMagnificToken({ grant_type: "refresh_token", refresh_token: tokens.refreshToken, client_id: tokens.clientId });
};

const readRpc = (text: string) => {
  // Streamable HTTP answers either JSON or an SSE stream; the last data line is the reply.
  const body = text.includes("data:") && !text.trimStart().startsWith("{")
    ? text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).pop() ?? ""
    : text;
  return body.trim() ? JSON.parse(body) as { result?: Record<string, unknown>; error?: unknown } : null;
};

export type MagnificSession = { call: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>> };

export async function openMagnificSession(accessToken: string): Promise<MagnificSession> {
  let sessionId: string | undefined;
  let id = 0;
  const rpc = async (method: string, params: unknown, notification = false) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;
    const response = await fetch(MAGNIFIC_MCP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", method, params, ...(notification ? {} : { id: ++id }) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 401) throw new MagnificAuthError("Magnific sign-in expired. Reconnect it in Settings.");
    const text = await response.text();
    if (!response.ok && response.status !== 202) throw new Error(`magnific HTTP ${response.status}: ${text.slice(0, 300)}`);
    sessionId = response.headers.get("mcp-session-id") ?? sessionId;
    return notification ? null : readRpc(text);
  };
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "laniameda.gallery", version: "1" } });
  await rpc("notifications/initialized", {}, true);
  return {
    call: async (name, args) => {
      const reply = await rpc("tools/call", { name, arguments: args });
      if (!reply || reply.error) throw new Error(`magnific ${name}: ${JSON.stringify(reply?.error ?? "no reply").slice(0, 400)}`);
      const result = reply.result as { structuredContent?: Record<string, unknown>; content?: { type: string; text?: string }[]; isError?: boolean };
      let out: Record<string, unknown>;
      if (result.structuredContent) out = result.structuredContent;
      else {
        const text = (result.content ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("");
        try { out = JSON.parse(text) as Record<string, unknown>; } catch { out = { text }; }
      }
      if (result.isError) {
        const message = JSON.stringify(out).slice(0, 400);
        if (/credit|balance|insufficient/i.test(message)) throw new MagnificRefusal(`magnific: out of credits`, true);
        throw new MagnificRefusal(`magnific: ${message}`, false);
      }
      return out;
    },
  };
}

/** Top-level Magnific projects, from folders_list (it answers in an indented text list). */
export async function listMagnificProjects(session: MagnificSession) {
  const out = await session.call("folders_list", { onlyProjects: true });
  const items = Array.isArray(out.items) ? out.items as { reference?: string; name?: string; type?: string }[] : null;
  if (items) return items.filter((item) => item.reference && item.name).map((item) => ({ reference: item.reference!, name: item.name!, type: item.type }));
  const text = typeof out.text === "string" ? out.text : "";
  const projects: { reference: string; name: string; type?: string }[] = [];
  for (const match of text.matchAll(/- reference: (\S+)\n\s+name: (.+)\n\s+type: (\S+)/g)) {
    projects.push({ reference: match[1]!, name: match[2]!.trim().replace(/^"|"$/g, ""), type: match[3] });
  }
  return projects;
}

const squash = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

/**
 * The Magnific project an edit lands in: the one named like the asset's world,
 * else "laniameda.gallery" (made on first use). Never Personal or the root.
 */
export async function magnificProjectFor(session: MagnificSession, worldName?: string) {
  const projects = await listMagnificProjects(session);
  const wanted = worldName ? squash(worldName) : "";
  const world = wanted ? projects.find((project) => squash(project.name) === wanted) : undefined;
  if (world) return world.reference;
  const shelf = projects.find((project) => squash(project.name) === "laniamedagallery");
  if (shelf) return shelf.reference;
  const created = await session.call("folders_create", { name: "laniameda.gallery", type: "project" });
  const reference = (created.reference ?? (created.folder as { reference?: string } | undefined)?.reference) as string | undefined;
  if (reference) return reference;
  const again = (await listMagnificProjects(session)).find((project) => squash(project.name) === "laniamedagallery");
  return again?.reference;
}
