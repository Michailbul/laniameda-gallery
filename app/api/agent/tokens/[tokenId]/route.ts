import { NextResponse } from "next/server";
import { makeFunctionReference } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import { requireAuth } from "@/lib/server-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { requireAgentTokenIssuerSecret } from "@/lib/server/agent-auth";

const revokeAgentTokenMutation = makeFunctionReference<"mutation">(
  "agentTokens:revokeAgentToken",
);

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ tokenId: string }> },
) {
  try {
    const user = await requireAuth();
    const { tokenId } = await params;
    const client = getServerConvexClient();
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
