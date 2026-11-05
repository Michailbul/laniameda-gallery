import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireAgentAuth, AgentAuthError, type AgentTokenScope } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { clientErrorMessage } from "@/lib/server/route-error";
import { editListSchema, editRetrySchema, editReviewSchema, editStartSchema, versionRestoreSchema } from "@/lib/asset-edit-contract";

// In-place edits for agents: send a targeted edit on an image (one job per
// model per take, refused at $30 or more), read its takes, retry a failed one,
// and, when Michael asked for it, approve or discard a landed take or restore
// an earlier version of the asset.
// The same jobs Michael runs from the detail panel and the Inbox zoom.
const actions = ["start", "list", "retry", "review", "restore_version"] as const;
const scopes: Record<(typeof actions)[number], AgentTokenScope> = {
  start: "gallery:write",
  list: "gallery:read",
  retry: "gallery:write",
  review: "gallery:write",
  restore_version: "gallery:write",
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
      return NextResponse.json({ ok: true, ...sent, next: "Poll list_asset_edits {assetId} until each take is done or error. A done take is review: pending, shown only beside its source (resultUrl); Michael approves or discards it." });
    }
    if (action === "review") {
      const input = editReviewSchema.parse(body);
      const jobId = bare(input.jobId, "editJobs") as Id<"editJobs">;
      if (input.decision === "approve") {
        const done = await client.mutation(api.editJobs.approveEdit, { ownerUserId, jobId });
        return NextResponse.json({ ok: true, review: "approved", ...done, asset: `asset:${done.assetId}` });
      }
      return NextResponse.json({ ok: true, ...await client.mutation(api.editJobs.discardEdit, {
        ownerUserId, jobId, reopen: input.decision === "reopen",
      }) });
    }
    if (action === "restore_version") {
      const input = versionRestoreSchema.parse(body);
      const done = await client.mutation(api.editJobs.restoreAssetVersion, {
        ownerUserId, versionId: bare(input.versionId, "assetVersions") as Id<"assetVersions">,
      });
      return NextResponse.json({ ok: true, ...done, asset: `asset:${done.assetId}` });
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
