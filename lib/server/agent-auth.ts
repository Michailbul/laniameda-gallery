import { createHash, randomBytes } from "node:crypto";
import { makeFunctionReference } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import { getServerConvexClient } from "@/lib/server/convex";

import { grantingScope, type AgentTokenScope } from "@/lib/agent-scopes";

export type { AgentTokenScope } from "@/lib/agent-scopes";

export type AgentAuthContext = {
  tokenId: Id<"agentTokens">;
  ownerUserId: string;
  tokenPrefix: string;
  label: string;
  scopes: AgentTokenScope[];
  // inspiration:adapt tokens: the world roots they may work on.
  worldIds?: string[];
};

export class AgentAuthError extends Error {
  constructor(
    message: string,
    public readonly status = 401,
  ) {
    super(message);
    this.name = "AgentAuthError";
  }
}

const authenticateAgentTokenMutation = makeFunctionReference<"mutation">(
  "agentTokens:authenticateAgentToken",
);

export const resolveAgentTokenIssuerSecret = () =>
  (
    process.env.AGENT_TOKEN_ISSUER_SECRET ??
    process.env.CURATION_ADMIN_SECRET ??
    ""
  ).trim();

export const requireAgentTokenIssuerSecret = () => {
  const secret = resolveAgentTokenIssuerSecret();
  if (!secret) {
    throw new Error("AGENT_TOKEN_ISSUER_SECRET is not configured.");
  }
  return secret;
};

export const createAgentTokenSecret = () =>
  `lgat_${randomBytes(32).toString("base64url")}`;

export const hashAgentToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export const tokenPrefix = (token: string) => token.slice(0, 14);

const bearerTokenFromRequest = (request: Request) => {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, ...rest] = header.split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer") {
    return undefined;
  }
  const token = rest.join(" ").trim();
  return token || undefined;
};

const authenticate = async (request: Request): Promise<AgentAuthContext> => {
  const token = bearerTokenFromRequest(request);
  if (!token) {
    throw new AgentAuthError("Missing bearer token.");
  }

  const client = getServerConvexClient();
  const auth = (await client.mutation(authenticateAgentTokenMutation, {
    tokenHash: hashAgentToken(token),
  })) as AgentAuthContext | null;

  if (!auth) {
    throw new AgentAuthError(
      "Invalid or expired agent token. Create a new token at /agents or reconnect the gallery.",
    );
  }

  return auth;
};

export const requireAgentAuth = async (
  request: Request,
  requiredScope: AgentTokenScope,
): Promise<AgentAuthContext> => {
  const auth = await authenticate(request);
  // Authentication and permission failures need different responses. A valid
  // token without Delete permission must not be treated as an expired token,
  // and reconnecting never grants a scope without the owner's consent.
  if (!auth.scopes.includes(requiredScope)) {
    throw new AgentAuthError(
      `This agent token lacks ${requiredScope}. The signed-in gallery owner can edit this active token's permissions at /agents, or reconnect the gallery and approve that permission. Permission grants do not approve any deletion.`,
      403,
    );
  }

  return auth;
};

/** Any one of the scopes is enough; returns which one let the token in. */
export const requireAgentAuthAny = async (
  request: Request,
  allowed: readonly AgentTokenScope[],
): Promise<AgentAuthContext & { granted: AgentTokenScope }> => {
  const auth = await authenticate(request);
  const granted = grantingScope(auth, allowed);
  if (!granted) {
    throw new AgentAuthError(
      `This agent token cannot do this (needs one of: ${allowed.join(", ")}). The signed-in gallery owner can edit this token's permissions at /agents.`,
      403,
    );
  }
  return { ...auth, granted };
};
