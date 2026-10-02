import { makeFunctionReference } from "convex/server";
import {
  createAgentTokenSecret,
  hashAgentToken,
  requireAgentTokenIssuerSecret,
  tokenPrefix,
} from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import {
  MCP_ACCESS_TOKEN_DAYS,
  OAuthError,
  corsPreflight,
  oauthErrorResponse,
  oauthJson,
  redeemAuthorizationCode,
} from "@/lib/server/mcp-oauth";

const createAgentTokenMutation = makeFunctionReference<"mutation">(
  "agentTokens:createAgentToken",
);

const readParams = async (request: Request) => {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string") params.set(key, value);
    }
    return params;
  }
  return new URLSearchParams(await request.text());
};

// Exchanges an authorization code for a gallery agent token. The access token
// IS an lgat_ agent token, so /api/agent/* accepts it as-is and the owner can
// see and revoke it on /agents.
export async function POST(request: Request) {
  try {
    const params = await readParams(request);
    if (params.get("grant_type") !== "authorization_code") {
      throw new OAuthError("unsupported_grant_type", "Only authorization_code is supported.");
    }

    const redeemed = await redeemAuthorizationCode({
      code: params.get("code"),
      clientId: params.get("client_id"),
      redirectUri: params.get("redirect_uri"),
      codeVerifier: params.get("code_verifier"),
    });

    const rawToken = createAgentTokenSecret();
    const expiresInSeconds = MCP_ACCESS_TOKEN_DAYS * 24 * 60 * 60;
    await getServerConvexClient(redeemed.ownerUserId).mutation(createAgentTokenMutation, {
      serverSecret: requireAgentTokenIssuerSecret(),
      ownerUserId: redeemed.ownerUserId,
      tokenHash: hashAgentToken(rawToken),
      tokenPrefix: tokenPrefix(rawToken),
      label: `MCP · ${redeemed.clientName}`,
      scopes: redeemed.scopes,
      expiresAt: Date.now() + expiresInSeconds * 1000,
    });

    return oauthJson({
      access_token: rawToken,
      token_type: "Bearer",
      expires_in: expiresInSeconds,
      scope: redeemed.scopes.join(" "),
    });
  } catch (error) {
    return oauthErrorResponse(error);
  }
}

export const OPTIONS = corsPreflight;
