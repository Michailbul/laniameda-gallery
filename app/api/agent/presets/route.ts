import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireAgentAuth, AgentAuthError } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { presetFiltersSchema } from "@/lib/story-contract";

export async function POST(request: Request) {
  try {
    const body = z.record(z.string(), z.unknown()).parse(await request.json());
    const action = z.enum(["list", "save", "delete", "seed"]).parse(body.action);
    const agent = await requireAgentAuth(request, action === "list" ? "gallery:read" : action === "delete" ? "gallery:delete" : "gallery:write");
    const ownerUserId = agent.ownerUserId;
    const client = getServerConvexClient(ownerUserId);
    if (action === "list") return NextResponse.json({ presets: await client.query(api.galleryPresets.listPresets, { ownerUserId }) });
    if (action === "seed") return NextResponse.json({ ids: await client.mutation(api.galleryPresets.seedPresets, { ownerUserId }) });
    if (action === "delete") {
      await client.mutation(api.galleryPresets.deletePreset, { ownerUserId, id: z.string().min(1).parse(body.id).replace(/^preset:/, "") as Id<"galleryPresets"> });
      return NextResponse.json({ ok: true });
    }
    const input = presetFiltersSchema.parse(body.filters);
    const id = await client.mutation(api.galleryPresets.savePreset, { ownerUserId, name: z.string().trim().min(1).max(80).parse(body.name), filters: { ...input, folderId: input.folderId as Id<"folders"> | undefined, selectedFilterIds: input.selectedFilterIds as Id<"menuFilters">[], excludedFilterIds: input.excludedFilterIds as Id<"menuFilters">[] } });
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    if (error instanceof AgentAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid preset request." }, { status: 400 });
  }
}
