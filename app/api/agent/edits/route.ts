import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireAgentAuth, AgentAuthError, type AgentTokenScope } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { clientErrorMessage } from "@/lib/server/route-error";
import { editListSchema, editRetrySchema, editStartSchema } from "@/lib/asset-edit-contract";

// In-place edits for agents: send a targeted edit on an image (one job per
// model per take, refused at $30 or more), read its takes, retry a failed one.
// The same jobs Michael runs from the detail panel and the Inbox zoom.
const actions = ["start", "list", "retry"] as const;
const scopes: Record<(typeof actions)[number], AgentTokenScope> = {
  start: "gallery:write",
  list: "gallery:read",
  retry: "gallery:write",
};

const bare = (value: string, prefix: string) => value.replace(new RegExp(`^${prefix}:`), "").trim();

export async function POST(request: Request) {
  try {
    const body = z.record(z.string(), z.unknown()).parse(await request.json().catch(() => null));
    const action = z.enum(actions).parse(body.action);
    const agent = await requireAgentAuth(request, scopes[action]);
    const ownerUserId = agent.ownerUserId;
    const client = getServerConvexClient(ownerUserId);

    if (action === "start") {
      const input = editStartSchema.parse(body);
      const sent = await client.mutation(api.editJobs.startEdit, {
        ownerUserId,
        assetId: bare(input.assetId, "asset") as Id<"assets">,
        prompt: input.prompt,
        models: input.models,
        takes: input.takes,
        refs: input.refs?.map((ref) => ({ assetId: bare(ref.assetId, "asset") as Id<"assets">, name: ref.name })),
        createdBy: "agent",
      });
      return NextResponse.json({ ok: true, ...sent, next: "Poll list_asset_edits {assetId} until each take is done or error; a done take has resultAssetId." });
    }
    if (action === "retry") {
      const input = editRetrySchema.parse(body);
      return NextResponse.json({ ok: true, ...await client.mutation(api.editJobs.retryEdit, {
        ownerUserId, jobId: bare(input.jobId, "editJobs") as Id<"editJobs">,
      }) });
    }
    const input = editListSchema.parse(body);
    if (input.assetId) {
      const result = await client.query(api.editJobs.listAssetEdits, { ownerUserId, assetId: bare(input.assetId, "asset") as Id<"assets"> });
      return NextResponse.json({ asset: `asset:${bare(input.assetId, "asset")}`, ...result });
    }
    const jobs = await client.query(api.editJobs.listRecentEdits, { ownerUserId, limit: input.limit });
    return NextResponse.json({ count: jobs.length, jobs });
  } catch (error) {
    if (error instanceof AgentAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: z.prettifyError(error) }, { status: 400 });
    return NextResponse.json({ error: clientErrorMessage(error, "Edit request failed.") }, { status: 400 });
  }
}
