import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireAgentAuth, AgentAuthError, type AgentTokenScope } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { storyInputSchema, storyPatchSchema } from "@/lib/story-contract";
import { galleryPageUrl } from "@/lib/gallery-routes";
import { z } from "zod";

const scopes: Record<string, AgentTokenScope> = { list: "gallery:read", get: "gallery:read", revisions: "gallery:read", save: "gallery:write", update: "gallery:write", delete: "gallery:delete" };
const idSchema = z.string().min(1).transform((id) => id.replace(/^story:/, "") as Id<"stories">);
// The story's page in the gallery (/stories/<id>), for Michael to open.
const withUrl = <T extends { _id: string }>(story: T | null) => (story ? { ...story, url: galleryPageUrl({ kind: "stories", id: story._id }) } : story);

export async function POST(request: Request) {
  try {
    const body = z.record(z.string(), z.unknown()).parse(await request.json());
    const action = z.enum(["list", "get", "revisions", "save", "update", "delete"]).parse(body.action);
    const agent = await requireAgentAuth(request, scopes[action]);
    const ownerUserId = agent.ownerUserId;
    const client = getServerConvexClient(ownerUserId);
    if (action === "list") {
      const world = z.string().trim().min(1).optional().parse(body.world);
      if (world) body.folderId = (await client.query(api.worlds.resolveWorldRef, { ownerUserId, world })).worldId;
      const filters = z.object({ folderId: z.string().optional(), kind: z.enum(["idea", "script", "style-lock"]).optional(), status: z.enum(["idea", "draft", "ready", "archived"]).optional(), search: z.string().optional(), limit: z.number().int().min(1).max(500).optional() }).parse(body);
      const stories = await client.query(api.stories.listStories, { ownerUserId, ...filters, folderId: filters.folderId as Id<"folders"> | undefined });
      return NextResponse.json({ count: stories.length, stories });
    }
    if (action === "save" || action === "update") {
      const existing = action === "update" ? await client.query(api.stories.getStory, { ownerUserId, id: idSchema.parse(body.id) }) : undefined;
      const patch = existing ? storyPatchSchema.parse(body) : undefined;
      const merged = existing ? { ...existing, ...patch } : body;
      const input = storyInputSchema.parse({ ...merged, folderId: merged.folderId ?? undefined, storybookId: merged.storybookId ?? undefined });
      const ingestKey = existing?.ingestKey ?? z.string().trim().min(1).max(300).parse(body.ingestKey);
      const expectedRevision = action === "update"
        ? z.number().int().positive().parse(body.expectedRevision)
        : body.expectedRevision === undefined ? undefined : z.number().int().nonnegative().parse(body.expectedRevision);
      const result = await client.mutation(api.stories.saveStory, { ownerUserId, ...input, folderId: input.folderId as Id<"folders"> | undefined, storybookId: input.storybookId as Id<"folders"> | undefined, assetIds: input.assetIds.map((id) => id.replace(/^asset:/, "") as Id<"assets">), ingestKey, expectedRevision, actor: `agent:${agent.label || agent.tokenPrefix}`.slice(0, 80), session: z.string().trim().max(80).optional().parse(body.session) });
      const story = await client.query(api.stories.getStory, { ownerUserId, id: result.id });
      return NextResponse.json({ ok: true, ...result, story: withUrl(story) });
    }
    const id = idSchema.parse(body.id);
    if (action === "get") {
      const [story, linkStatus] = await Promise.all([client.query(api.stories.getStory, { ownerUserId, id }), client.query(api.stories.getStoryLinkStatus, { ownerUserId, id })]);
      return NextResponse.json({ story: withUrl(story), linkStatus });
    }
    if (action === "revisions") return NextResponse.json({ revisions: await client.query(api.stories.listStoryRevisions, { ownerUserId, id }) });
    await client.mutation(api.stories.deleteStory, { ownerUserId, id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AgentAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid story request." }, { status: 400 });
  }
}
