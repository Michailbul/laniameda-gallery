import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AgentAuthError, requireAgentAuth, type AgentTokenScope } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { clientErrorMessage } from "@/lib/server/route-error";
import { GALLERY_ORIGIN, worldStylesUrl } from "@/lib/gallery-routes";
import {
  parseWhen, projectBriefFileSchema, projectBriefsSchema, projectOpenSchema, projectSaveBriefSchema, projectSetSchema,
} from "@/lib/project-contract";

// Projects for agents: one call opens a project (world, art-director shelves,
// director review, briefs, inspiration), briefs are found by words or read
// whole, saved, and given their files (private bytes: upload, then attach).
// Everything is owner-only and journaled in the world (world_undo reverts).
// Art-director scope first: nothing here reaches the director review or the
// public world page (Michael, 9 Nov 2026).

const actions = ["open", "briefs", "save_brief", "brief_file", "set_project"] as const;

const scopeFor = (action: (typeof actions)[number]): AgentTokenScope =>
  action === "open" || action === "briefs" ? "gallery:read" : "gallery:write";

const absolute = (path: string) => `${GALLERY_ORIGIN}${path}`;
const iso = (at?: number) => (at ? new Date(at).toISOString().slice(0, 10) : undefined);

export async function POST(request: Request) {
  try {
    const body = z.record(z.string(), z.unknown()).parse(await request.json().catch(() => null));
    const action = z.enum(actions).parse(body.action);
    const agent = await requireAgentAuth(request, scopeFor(action));
    const ownerUserId = agent.ownerUserId;
    const client = getServerConvexClient(ownerUserId);
    const actor = `agent:${agent.label || agent.tokenPrefix}`.slice(0, 80);

    if (action === "open") {
      const input = projectOpenSchema.parse(body);
      const [project, inspiration] = await Promise.all([
        client.query(api.projects.getProject, { ownerUserId, world: input.world }),
        client.query(api.projects.projectInspiration, { ownerUserId, world: input.world, limit: 24 }),
      ]);
      const key = project.world.key;
      return NextResponse.json({
        project: project.world.name,
        isProject: project.isProject,
        details: project.details,
        url: absolute(`/w/${key}/project`),
        scope: "Art director only. Nothing here reaches the director review or the public world page until Michael promotes or publishes it.",
        world: { id: project.world.id, key, name: project.world.name, url: absolute(`/w/${key}`), stylesUrl: worldStylesUrl(key), styles: project.styles, members: project.world.memberCount },
        artDirectorShelves: project.shelves.filter((shelf) => shelf.artDirector).map((shelf) => ({ id: shelf.id, name: shelf.name, group: shelf.group, frames: shelf.count })),
        otherShelves: project.shelves.filter((shelf) => !shelf.artDirector).map((shelf) => ({ id: shelf.id, name: shelf.name, group: shelf.group, frames: shelf.count })),
        reviews: project.reviews.map((review) => ({ ...review, url: absolute(`/review/${review.slug}`), lastSeen: undefined })),
        briefs: project.briefs.map((brief) => ({
          id: `brief:${brief.id}`, ingestKey: brief.ingestKey, title: brief.title, kind: brief.kind, from: brief.from,
          received: iso(brief.receivedAt), note: brief.note, topics: brief.topics, reviewFolders: brief.reviewFolders,
          pictures: brief.assetCount, groups: brief.groups,
          files: brief.files.map((file) => ({ key: file.key, name: file.name, size: file.size, pages: file.pages, url: absolute(file.url) })),
        })),
        inspiration: {
          pieces: inspiration.total,
          sample: inspiration.pieces.map((piece) => `asset:${piece.assetId}`),
          takes: inspiration.takes.map((take) => ({ source: `inspiration:${take.sourceId}`, title: take.title, use: take.intendedUse, status: take.status })),
        },
        next: "production_briefs {query} finds briefs by words and returns their pictures and files; save_production_brief adds or updates one.",
      });
    }

    if (action === "briefs") {
      const input = projectBriefsSchema.parse(body);
      const rows = await client.query(api.projects.findBriefs, { ownerUserId, world: input.world, query: input.query, brief: input.brief, limit: input.limit });
      return NextResponse.json({
        count: rows.length,
        briefs: rows.map((brief) => ({
          id: `brief:${brief.id}`, ingestKey: brief.ingestKey, project: brief.world.key, title: brief.title, kind: brief.kind,
          from: brief.from, received: iso(brief.receivedAt), note: brief.note, topics: brief.topics, reviewFolders: brief.reviewFolders,
          groups: brief.groups, revision: brief.revision,
          files: brief.files.map((file) => ({ key: file.key, name: file.name, contentType: file.contentType, size: file.size, pages: file.pages, url: absolute(file.url), coverUrl: file.coverUrl ? absolute(file.coverUrl) : undefined })),
          pictures: brief.assets.map((asset) => ({
            id: `asset:${asset.assetId}`, group: asset.group, description: asset.description, agentDescription: asset.agentDescription,
            thumbUrl: asset.thumbUrl, url: asset.url, width: asset.width, height: asset.height, fileName: asset.fileName, sourceUrl: asset.sourceUrl,
          })),
        })),
        note: "File urls open with this token (Authorization: Bearer) or Michael's session; they are private.",
      });
    }

    if (action === "save_brief") {
      const input = projectSaveBriefSchema.parse(body);
      const result = await client.mutation(api.projects.saveBrief, {
        ownerUserId, world: input.world, ingestKey: input.ingestKey, title: input.title, kind: input.kind,
        from: input.from, receivedAt: parseWhen(input.receivedAt), note: input.note, topics: input.topics, reviewFolders: input.reviewFolders,
        assetIds: input.assetIds, addAssetIds: input.addAssetIds, groups: input.groups, expectedRevision: input.expectedRevision,
        actor, session: input.session,
      });
      return NextResponse.json({ ...result, briefId: `brief:${result.briefId}` });
    }

    if (action === "brief_file") {
      const input = projectBriefFileSchema.parse(body);
      if (input.step === "upload_url") {
        const uploadUrl = await client.mutation(api.projects.briefUploadUrl, { ownerUserId });
        return NextResponse.json({ uploadUrl, how: "curl -sS -X POST -H 'Content-Type: application/pdf' --data-binary @file '<uploadUrl>' answers {storageId}; then step attach." });
      }
      if (!input.brief || !input.storageId || !input.name || !input.sha256) throw new Error("attach needs brief, storageId, name and sha256.");
      const result = await client.mutation(api.projects.attachBriefFile, {
        ownerUserId, brief: input.brief, storageId: input.storageId as Id<"_storage">, name: input.name, sha256: input.sha256,
        contentType: input.contentType, pages: input.pages, coverStorageId: input.coverStorageId as Id<"_storage"> | undefined,
        actor, session: input.session,
      });
      return NextResponse.json({ ...result, url: absolute(result.url) });
    }

    const input = projectSetSchema.parse(body);
    const result = await client.mutation(api.projects.setProjectDetails, {
      ownerUserId, world: input.world, line: input.line, client: input.client, role: input.role, people: input.people,
      reviewSlugs: input.reviewSlugs, status: input.status, actor, session: input.session,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AgentAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") }, { status: 400 });
    return NextResponse.json({ error: clientErrorMessage(error, "Could not do that.") }, { status: 400 });
  }
}
