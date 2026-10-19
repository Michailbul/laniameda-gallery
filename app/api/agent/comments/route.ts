import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireAgentAuth, AgentAuthError, type AgentTokenScope } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { clientErrorMessage } from "@/lib/server/route-error";
import { commentAddSchema, commentListSchema } from "@/lib/asset-comment-contract";

// Comments on assets: Michael writes them in the detail panel; agents read
// them (one asset's thread, or the newest across the vault) and reply.
const actions = ["list", "add"] as const;
const scopes: Record<(typeof actions)[number], AgentTokenScope> = {
  list: "gallery:read",
  add: "gallery:write",
};

const bare = (value: string) => value.replace(/^asset:/, "").trim();

export async function POST(request: Request) {
  try {
    const body = z.record(z.string(), z.unknown()).parse(await request.json().catch(() => null));
    const action = z.enum(actions).parse(body.action);
    const agent = await requireAgentAuth(request, scopes[action]);
    const ownerUserId = agent.ownerUserId;
    const client = getServerConvexClient(ownerUserId);
    const withHandle = <T extends { assetId: string }>(row: T) => ({ asset: `asset:${row.assetId}`, ...row });

    if (action === "list") {
      const input = commentListSchema.parse(body);
      const rows = input.assetId
        ? await client.query(api.assetComments.listAssetComments, {
            ownerUserId,
            assetId: bare(input.assetId) as Id<"assets">,
          })
        : await client.query(api.assetComments.listRecentAssetComments, {
            ownerUserId,
            since: input.since,
            author: input.author,
            limit: input.limit,
          });
      return NextResponse.json({ count: rows.length, comments: rows.map(withHandle) });
    }
    const input = commentAddSchema.parse(body);
    const comment = await client.mutation(api.assetComments.addAssetComment, {
      ownerUserId,
      assetId: bare(input.assetId) as Id<"assets">,
      body: input.body,
      author: "agent",
    });
    return NextResponse.json({ ok: true, comment: withHandle(comment) });
  } catch (error) {
    if (error instanceof AgentAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: z.prettifyError(error) }, { status: 400 });
    return NextResponse.json({ error: clientErrorMessage(error, "Comment request failed.") }, { status: 400 });
  }
}
