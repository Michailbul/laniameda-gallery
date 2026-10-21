import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireAgentAuth, AgentAuthError, type AgentTokenScope } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { clientErrorMessage } from "@/lib/server/route-error";
import { GALLERY_SKILL_ORIGIN } from "@/lib/server/gallery-skill-resources";
import { bareInboxRef, inboxCardRef, inboxProgress, inboxStackRef } from "@/lib/inbox";
import {
  bareOptionalInboxRef, inboxCloseSchema, inboxListSchema, inboxPostSchema, inboxStackRefSchema, similarGroupsSchema,
} from "@/lib/inbox-contract";

const actions = ["post", "list", "decisions", "close", "delete", "similar_groups"] as const;
const scopes: Record<(typeof actions)[number], AgentTokenScope> = {
  post: "gallery:write", list: "gallery:read", decisions: "gallery:read", close: "gallery:write", delete: "gallery:delete",
  similar_groups: "gallery:read",
};

type StackId = Id<"inboxStacks">;
const stackIdOf = (value: string) => bareInboxRef(value) as StackId;
const stackUrl = (worldId: string, stackId: string) => `${GALLERY_SKILL_ORIGIN}/inbox/${worldId}/${stackId}`;

export async function POST(request: Request) {
  try {
    const body = z.record(z.string(), z.unknown()).parse(await request.json().catch(() => null));
    const action = z.enum(actions).parse(body.action);
    const agent = await requireAgentAuth(request, scopes[action]);
    const ownerUserId = agent.ownerUserId;
    const client = getServerConvexClient(ownerUserId);

    if (action === "post") {
      const input = inboxPostSchema.parse(body);
      const worldFolderId = bareInboxRef(input.worldFolderId) as Id<"folders">;
      const result = await client.mutation(api.inbox.postInboxCards, {
        ownerUserId, worldFolderId,
        stackId: bareOptionalInboxRef(input.stackId) as StackId | undefined,
        stackTitle: input.stackTitle, ingestKey: input.ingestKey, note: input.note, agent: input.agent,
        cards: input.cards.map((card) => ({
          ...card,
          assetIds: card.assetIds.map((assetId) => bareInboxRef(assetId) as Id<"assets">),
          targets: card.targets?.map((target) => ({
            kind: target.kind, label: target.label,
            moodboardId: bareOptionalInboxRef(target.moodboardId) as Id<"moodboards"> | undefined,
            folderId: bareOptionalInboxRef(target.folderId) as Id<"folders"> | undefined,
          })),
        })),
      });
      return NextResponse.json({
        ok: true, ...result, id: inboxStackRef(result.stackId),
        cards: (result.added ?? []).map(inboxCardRef), url: stackUrl(worldFolderId, result.stackId),
      });
    }

    if (action === "list") {
      const input = inboxListSchema.parse(body);
      const rows = await client.query(api.inbox.listInboxStacks, {
        ownerUserId, status: input.status, limit: input.limit, previewLimit: 0,
        worldFolderId: bareOptionalInboxRef(input.worldFolderId) as Id<"folders"> | undefined,
      });
      return NextResponse.json({
        count: rows.length,
        stacks: rows.map(({ previewItems: _previews, ...row }) => ({
          id: inboxStackRef(row._id), ...row, open: row.cards - row.decided, url: stackUrl(row.worldFolderId, row._id),
        })),
      });
    }

    if (action === "decisions") {
      // Every card with its answer, the card comment and Michael's notes on
      // its images: what the agent applies and learns from.
      const stackId = stackIdOf(inboxStackRefSchema.parse(body).stackId);
      const [view, decisions, notes] = await Promise.all([
        client.query(api.inbox.getInboxStack, { ownerUserId, stackId }),
        client.query(api.inbox.listInboxDecisions, { ownerUserId, stackId }),
        client.query(api.inbox.listInboxNotes, { ownerUserId, stackId }),
      ]);
      const decisionOf = new Map(decisions.map((row) => [row.cardId, row]));
      const notesOf = new Map(notes.map((row) => [row.assetId, row.notes]));
      const cards = view.cards.map((card) => {
        const row = decisionOf.get(card._id);
        const target = row?.targetHotkey !== undefined ? card.targets?.find((entry) => entry.hotkey === row.targetHotkey) : undefined;
        return {
          id: inboxCardRef(card._id), position: card.position + 1, type: card.type, question: card.question,
          ruleText: card.ruleText, evidence: card.evidence, labels: card.labels,
          targets: card.targets?.map(({ previewThumbUrl: _thumb, ...entry }) => entry),
          assets: card.assets.map((asset) => ({ id: `asset:${asset.assetId}`, ...asset, notes: notesOf.get(asset.assetId) ?? [] })),
          decision: row?.choice ? {
            choice: row.choice,
            target: target ? { hotkey: target.hotkey, label: target.label, kind: target.kind, moodboardId: target.moodboardId, folderId: target.folderId } : undefined,
            picked: row.pickedAssetId ? `asset:${row.pickedAssetId}` : undefined,
            cover: row.coverAssetId ? `asset:${row.coverAssetId}` : undefined,
            deleteAssetIds: row.deleteAssetIds?.map((id) => `asset:${id}`),
            applied: row.applied,
            decidedAt: row.decidedAt,
          } : null,
          deleted: row?.deletedAssetIds?.map((id) => `asset:${id}`) ?? [],
          comment: row && (row.commentText || row.audioUrl) ? {
            text: row.commentText, audioUrl: row.audioUrl, audioDurationMs: row.audioDurationMs, audioContentType: row.audioContentType, at: row.commentedAt,
          } : null,
        };
      });
      const progress = inboxProgress(view.cards.map((card) => card._id), decisions);
      return NextResponse.json({
        stack: { id: inboxStackRef(view.stack._id), ...view.stack, worldName: view.worldName, url: stackUrl(view.stack.worldFolderId, view.stack._id) },
        progress, allDecided: progress.pending === 0, cards,
      });
    }

    if (action === "similar_groups") {
      const input = similarGroupsSchema.parse(body);
      const result = await client.query(api.assetHashes.findSimilarGroups, {
        ownerUserId, folderId: bareInboxRef(input.folderId) as Id<"folders">, includeChildren: input.includeChildren,
        maxDistance: input.maxDistance, minSize: input.minSize, limit: input.limit,
      });
      return NextResponse.json({
        ...result,
        groups: result.groups.map((group) => ({
          ...group, size: group.assets.length,
          assets: group.assets.map((asset) => ({ id: `asset:${asset.assetId}`, ...asset })),
          // Ready to post as one duplicates card.
          assetIds: group.assets.map((asset) => `asset:${asset.assetId}`),
          samePrompt: group.assets.every((asset) => asset.promptId && asset.promptId === group.assets[0]!.promptId),
        })),
      });
    }

    if (action === "close") {
      const input = inboxCloseSchema.parse(body);
      return NextResponse.json({ ok: true, ...await client.mutation(api.inbox.closeInboxStack, { ownerUserId, stackId: stackIdOf(input.stackId), reopen: input.reopen }) });
    }
    const input = inboxStackRefSchema.parse(body);
    return NextResponse.json({ ok: true, ...await client.mutation(api.inbox.deleteInboxStack, { ownerUserId, stackId: stackIdOf(input.stackId) }) });
  } catch (error) {
    if (error instanceof AgentAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: z.prettifyError(error) }, { status: 400 });
    return NextResponse.json({ error: clientErrorMessage(error, "Inbox request failed.") }, { status: 400 });
  }
}
