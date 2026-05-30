import { createHash, randomBytes } from "node:crypto";
import { makeFunctionReference } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import { getServerConvexClient } from "@/lib/server/convex";

export type AgentTokenScope = "gallery:read" | "gallery:write" | "gallery:delete";

export type AgentAuthContext = {
  tokenId: Id<"agentTokens">;
  ownerUserId: string;
  tokenPrefix: string;
  label: string;
  scopes: AgentTokenScope[];
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

export const requireAgentAuth = async (
  request: Request,
  requiredScope: AgentTokenScope,
): Promise<AgentAuthContext> => {
  const token = bearerTokenFromRequest(request);
  if (!token) {
    throw new AgentAuthError("Missing bearer token.");
  }

  const client = getServerConvexClient();
  const auth = (await client.mutation(authenticateAgentTokenMutation, {
    tokenHash: hashAgentToken(token),
    requiredScope,
  })) as AgentAuthContext | null;

  if (!auth) {
    throw new AgentAuthError("Invalid agent token or missing scope.");
  }

  return auth;
};
