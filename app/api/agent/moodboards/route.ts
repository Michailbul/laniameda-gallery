import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireAgentAuth, AgentAuthError, type AgentTokenScope } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { clientErrorMessage } from "@/lib/server/route-error";
import {
  bareMoodboardRef, bareOptionalMoodboardRef, moodboardAddSchema, moodboardGenerationsSchema,
  moodboardListSchema, moodboardMidjourneySchema, moodboardRefSchema, moodboardRemoveSchema,
  moodboardReorderSchema, moodboardSaveSchema,
} from "@/lib/moodboard-contract";
import {
  moodboardRef, moodboardSyncState, profileFlagForCode, profileFlagForMoodboardId,
} from "@/lib/moodboards";

const actions = ["list", "get", "generations", "save", "add", "remove", "reorder", "set_midjourney", "delete"] as const;
const scopes: Record<(typeof actions)[number], AgentTokenScope> = {
  list: "gallery:read", get: "gallery:read", generations: "gallery:read",
  save: "gallery:write", add: "gallery:write", remove: "gallery:write", reorder: "gallery:write", set_midjourney: "gallery:write",
  delete: "gallery:delete",
};

type BoardId = Id<"moodboards">;
type AssetId = Id<"assets">;
const board = (value: string) => bareMoodboardRef(value) as BoardId;
const assets = (values: string[]) => values.map((value) => bareMoodboardRef(value) as AssetId);

// Handles an agent can paste straight back: the typed ID and the prompt flags.
const withHandles = <T extends { _id: string; mjCode?: string; mjMoodboardId?: string }>(row: T) => ({
  id: moodboardRef(row._id), ...row,
  profile: row.mjCode ? profileFlagForCode(row.mjCode) : undefined,
  profileById: row.mjMoodboardId ? profileFlagForMoodboardId(row.mjMoodboardId) : undefined,
});

export async function POST(request: Request) {
  try {
    const body = z.record(z.string(), z.unknown()).parse(await request.json().catch(() => null));
    const action = z.enum(actions).parse(body.action);
    const agent = await requireAgentAuth(request, scopes[action]);
    const ownerUserId = agent.ownerUserId;
    const client = getServerConvexClient(ownerUserId);
    const read = async (moodboardId: BoardId) => {
      const result = await client.query(api.moodboards.getMoodboard, { ownerUserId, moodboardId });
      const sync = moodboardSyncState(result.moodboard, result.items.map((item) => item.addedAt));
      return {
        ...result,
        moodboard: withHandles(result.moodboard),
        items: result.items.map((item) => ({ id: `asset:${item.assetId}`, ...item })),
        // Images only, in board order: what a Midjourney moodboard takes.
        imageUrls: result.items.filter((item) => item.kind === "image" && item.url).map((item) => item.url!),
        sync,
      };
    };

    // Writes record the token as their actor in the world journal.
    const journal = {
      actor: `agent:${agent.label || agent.tokenPrefix}`.slice(0, 80),
      session: z.string().trim().max(80).optional().parse(body.session),
    };

    if (action === "list") {
      const world = z.string().trim().min(1).optional().parse(body.world);
      if (world) {
        body.folderId = (await client.query(api.worlds.resolveWorldRef, { ownerUserId, world })).worldId;
        body.includeChildren = true;
      }
      const input = moodboardListSchema.parse(body);
      const rows = await client.query(api.moodboards.listMoodboards, {
        ownerUserId, ...input, folderId: bareOptionalMoodboardRef(input.folderId) as Id<"folders"> | undefined,
      });
      return NextResponse.json({ count: rows.length, moodboards: rows.map(withHandles) });
    }
    if (action === "get") {
      return NextResponse.json(await read(board(moodboardRefSchema.parse(body).moodboardId)));
    }
    if (action === "generations") {
      const input = moodboardGenerationsSchema.parse(body);
      const result = await client.query(api.moodboards.listMoodboardGenerations, { ownerUserId, moodboardId: board(input.moodboardId), limit: input.limit });
      return NextResponse.json({ ...result, assets: result.assets.map((asset) => ({ id: `asset:${asset.assetId}`, ...asset })) });
    }
    if (action === "save") {
      const input = moodboardSaveSchema.parse(body);
      const folderId = bareOptionalMoodboardRef(input.folderId) as Id<"folders"> | undefined;
      if (!input.moodboardId) {
        if (!folderId || !input.name) {
          return NextResponse.json({ error: "Creating a moodboard needs folderId and name; pass moodboardId to patch one." }, { status: 400 });
        }
        if (input.status || input.coverAssetId || input.expectedRevision) {
          return NextResponse.json({ error: "status, coverAssetId and expectedRevision apply to an existing board: create it, then patch it by moodboardId." }, { status: 400 });
        }
        const result = await client.mutation(api.moodboards.createMoodboard, {
          ownerUserId, folderId, name: input.name,
          description: input.description ?? undefined, styleTag: input.styleTag ?? undefined, notes: input.notes ?? undefined,
          mjCode: input.mjCode ?? undefined, mjMoodboardId: input.mjMoodboardId ?? undefined, mjUrl: input.mjUrl ?? undefined,
          ...journal,
        });
        return NextResponse.json({ ok: true, ...result, ...await read(result.moodboardId) });
      }
      const moodboardId = board(input.moodboardId);
      const result = await client.mutation(api.moodboards.updateMoodboard, {
        ownerUserId, moodboardId, folderId,
        expectedRevision: input.expectedRevision, name: input.name, status: input.status,
        description: input.description, styleTag: input.styleTag, notes: input.notes,
        mjCode: input.mjCode, mjMoodboardId: input.mjMoodboardId, mjUrl: input.mjUrl,
        coverAssetId: input.coverAssetId === undefined ? undefined : input.coverAssetId === null ? null : bareMoodboardRef(input.coverAssetId) as AssetId,
        ...journal,
      });
      return NextResponse.json({ ok: true, created: false, ...result });
    }
    if (action === "add") {
      const input = moodboardAddSchema.parse(body);
      const result = await client.mutation(api.moodboards.addMoodboardItems, { ownerUserId, moodboardId: board(input.moodboardId), assetIds: assets(input.assetIds), note: input.note, ...journal });
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "remove") {
      const input = moodboardRemoveSchema.parse(body);
      return NextResponse.json({ ok: true, ...await client.mutation(api.moodboards.removeMoodboardItems, { ownerUserId, moodboardId: board(input.moodboardId), assetIds: assets(input.assetIds), ...journal }) });
    }
    if (action === "reorder") {
      const input = moodboardReorderSchema.parse(body);
      return NextResponse.json({ ok: true, ...await client.mutation(api.moodboards.reorderMoodboardItems, { ownerUserId, moodboardId: board(input.moodboardId), assetIds: assets(input.assetIds), ...journal }) });
    }
    if (action === "set_midjourney") {
      const input = moodboardMidjourneySchema.parse(body);
      const { moodboardId, ...fields } = input;
      return NextResponse.json({ ok: true, ...await client.mutation(api.moodboards.setMoodboardMidjourney, { ownerUserId, moodboardId: board(moodboardId), ...fields, ...journal }) });
    }
    const input = moodboardRefSchema.parse(body);
    return NextResponse.json({ ok: true, ...await client.mutation(api.moodboards.deleteMoodboard, { ownerUserId, moodboardId: board(input.moodboardId), ...journal }) });
  } catch (error) {
    if (error instanceof AgentAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: z.prettifyError(error) }, { status: 400 });
    return NextResponse.json({ error: clientErrorMessage(error, "Moodboard request failed.") }, { status: 400 });
  }
}
