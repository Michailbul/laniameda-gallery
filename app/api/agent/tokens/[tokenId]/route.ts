import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
import { requireAuth } from "@/lib/server-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { requireAgentTokenIssuerSecret } from "@/lib/server/agent-auth";
import { AGENT_TOKEN_SCOPES } from "@/lib/agent-scopes";

const revokeAgentTokenMutation = makeFunctionReference<"mutation">(
  "agentTokens:revokeAgentToken",
);
const updateAgentTokenScopesMutation = makeFunctionReference<"mutation">(
  "agentTokens:updateAgentTokenScopes",
);
const scopeUpdateSchema = z.object({
  scopes: z.array(z.enum(AGENT_TOKEN_SCOPES)).min(1).max(AGENT_TOKEN_SCOPES.length),
  // inspiration:adapt: the projects (world roots) the token may work on.
  worldIds: z.array(z.string().min(1).max(64)).max(20).optional(),
}).strict();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ tokenId: string }> },
) {
  try {
    // Deliberately use the signed-in owner session, never requireAgentAuth.
    // Possessing an agent token does not authorize permission changes.
    const user = await requireAuth();
    if (request.headers.get("origin") !== new URL(request.url).origin) {
      return NextResponse.json(
        { error: "Permission changes require a same-origin owner session." },
        { status: 403 },
      );
    }
    const { tokenId } = await params;
    const body = scopeUpdateSchema.parse(await request.json());
    const client = getServerConvexClient(user.ownerUserId);
    const token = await client.mutation(updateAgentTokenScopesMutation, {
      serverSecret: requireAgentTokenIssuerSecret(),
      ownerUserId: user.ownerUserId,
      tokenId: tokenId as Id<"agentTokens">,
      scopes: Array.from(new Set(body.scopes)),
      ...(body.worldIds ? { worldIds: body.worldIds.map((id) => id.replace(/^collection:/, "")) as Id<"folders">[] } : {}),
    });
    return NextResponse.json({ token });
  } catch (error) {
    if (error instanceof Error && error.message === "Not authenticated.") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "Failed to update permissions.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ tokenId: string }> },
) {
  try {
    const user = await requireAuth();
    const { tokenId } = await params;
    const client = getServerConvexClient(user.ownerUserId);
    const result = await client.mutation(revokeAgentTokenMutation, {
      serverSecret: requireAgentTokenIssuerSecret(),
      ownerUserId: user.ownerUserId,
      tokenId: tokenId as Id<"agentTokens">,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof Error && error.message === "Not authenticated.") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Failed to revoke agent token.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
