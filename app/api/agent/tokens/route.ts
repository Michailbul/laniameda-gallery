import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";
import { requireAuth } from "@/lib/server-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import {
  createAgentTokenSecret,
  hashAgentToken,
  requireAgentTokenIssuerSecret,
  tokenPrefix,
  type AgentTokenScope,
} from "@/lib/server/agent-auth";

const createAgentTokenMutation = makeFunctionReference<"mutation">(
  "agentTokens:createAgentToken",
);
const listAgentTokensQuery = makeFunctionReference<"query">(
  "agentTokens:listAgentTokens",
);

const VALID_SCOPES = new Set<AgentTokenScope>([
  "gallery:read",
  "gallery:write",
  "gallery:delete",
]);

const parseBody = async (request: Request) => {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const parseScopes = (value: unknown): AgentTokenScope[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const scopes = value.filter(
    (scope): scope is AgentTokenScope =>
      typeof scope === "string" && VALID_SCOPES.has(scope as AgentTokenScope),
  );
  return scopes.length > 0 ? Array.from(new Set(scopes)) : undefined;
};

const parseExpiresAt = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  const maxDays = 365;
  const days = Math.min(value, maxDays);
  return Date.now() + days * 24 * 60 * 60 * 1000;
};

export async function GET() {
  try {
    const user = await requireAuth();
    const client = getServerConvexClient();
    const tokens = await client.query(listAgentTokensQuery, {
      serverSecret: requireAgentTokenIssuerSecret(),
      ownerUserId: user.ownerUserId,
    });

    return NextResponse.json({ tokens });
  } catch (error) {
    if (error instanceof Error && error.message === "Not authenticated.") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to list agent tokens.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const body = await parseBody(request);
    const rawToken = createAgentTokenSecret();

    const client = getServerConvexClient();
    const token = await client.mutation(createAgentTokenMutation, {
      serverSecret: requireAgentTokenIssuerSecret(),
      ownerUserId: user.ownerUserId,
      tokenHash: hashAgentToken(rawToken),
      tokenPrefix: tokenPrefix(rawToken),
      label: typeof body.label === "string" ? body.label : undefined,
      scopes: parseScopes(body.scopes),
      expiresAt: parseExpiresAt(body.expiresInDays),
    });

    return NextResponse.json({
      token,
      secret: rawToken,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Not authenticated.") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to create agent token.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
