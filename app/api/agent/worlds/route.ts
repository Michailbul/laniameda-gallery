import { NextResponse } from "next/server";
import { ConvexError } from "convex/values";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AgentAuthError, requireAgentAuth, type AgentTokenScope } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { clientErrorMessage } from "@/lib/server/route-error";
import {
  worldDocSchema, worldFileSchema, worldJournalSchema, worldMarkSchema, worldMoveSchema, worldOpenSchema, worldProfileSchema,
  worldShelfSchema, worldUndoSchema,
} from "@/lib/world-contract";

// The world surface: one world's context, its files, filing, shelves,
// Midjourney profiles, the journal and undo. Every write records the agent
// token as its actor and lands in the world journal.

const actions = [
  "open", "doc", "file", "shelf", "move", "mark", "profiles", "journal", "undo",
] as const;

const readOnlyDoc = new Set(["list", "read", "history"]);

const scopeFor = (action: (typeof actions)[number], body: Record<string, unknown>): AgentTokenScope => {
  if (action === "open" || action === "journal") return "gallery:read";
  if (action === "doc") return readOnlyDoc.has(String(body.op ?? body.mode ?? "read")) ? "gallery:read" : "gallery:write";
  if (action === "profiles") return body.op === "save" ? "gallery:write" : "gallery:read";
  return "gallery:write";
};

type UndoReport = {
  dryRun: boolean;
  undone: { changeId: Id<"worldChanges">; summary: string }[];
  blocked: { changeId: Id<"worldChanges">; summary: string; reason: string }[];
};
const undoReport = (error: unknown): UndoReport | null => {
  const data = error instanceof ConvexError ? error.data as (UndoReport & { kind?: string }) : null;
  if (!data || data.kind !== "world-undo-report") return null;
  return { dryRun: data.dryRun, undone: data.undone, blocked: data.blocked };
};

const bare = (value: string, prefix: string) => value.trim().replace(new RegExp(`^${prefix}:`), "");

export async function POST(request: Request) {
  try {
    const body = z.record(z.string(), z.unknown()).parse(await request.json().catch(() => null));
    const action = z.enum(actions).parse(body.action);
    const agent = await requireAgentAuth(request, scopeFor(action, body));
    const ownerUserId = agent.ownerUserId;
    const client = getServerConvexClient(ownerUserId);
    const actor = `agent:${agent.label || agent.tokenPrefix}`.slice(0, 80);

    if (action === "open") {
      const input = worldOpenSchema.parse(body);
      if (!input.world) {
        const worlds = await client.query(api.worlds.listWorlds, { ownerUserId });
        return NextResponse.json({
          count: worlds.length,
          worlds,
          next: "open_world with a world key for its context. Shared shelves (ART, LOVE, DESIGN …) are not worlds; list_collections shows them.",
        });
      }
      const context = await client.query(api.worlds.getWorldContext, { ownerUserId, world: input.world, journalLimit: input.journalLimit });
      return NextResponse.json(context);
    }

    if (action === "doc") {
      const input = worldDocSchema.parse(body);
      const base = { ownerUserId, world: input.world };
      switch (input.op) {
        case "list":
          return NextResponse.json({ docs: await client.query(api.worlds.listWorldDocs, base) });
        case "read": {
          const doc = await client.query(api.worlds.readWorldDoc, { ...base, path: input.path! });
          return NextResponse.json(doc ?? { path: input.path, missing: true, hint: "Not written yet. world_doc write creates it." });
        }
        case "history":
          return NextResponse.json({ versions: await client.query(api.worlds.worldDocHistory, { ...base, path: input.path!, limit: input.limit }) });
        case "write":
          return NextResponse.json({
            ok: true,
            ...await client.mutation(api.worlds.writeWorldDoc, {
              ...base, path: input.path!, body: input.body!, expectedRevision: input.expectedRevision, note: input.note, actor, session: input.session,
            }),
          });
        case "delete":
          return NextResponse.json({
            ok: true,
            ...await client.mutation(api.worlds.deleteWorldDoc, {
              ...base, path: input.path!, expectedRevision: input.expectedRevision, note: input.note, actor, session: input.session,
            }),
          });
      }
    }

    if (action === "file") {
      const input = worldFileSchema.parse(body);
      const result = await client.mutation(api.worlds.fileWorldAssets, {
        ownerUserId, world: input.world,
        assetIds: input.assetIds.map((id) => bare(id, "asset") as Id<"assets">),
        addTo: input.addTo, removeFrom: input.removeFrom, addTags: input.addTags, removeTags: input.removeTags,
        move: input.move, createTags: input.createTags, note: input.note, actor, session: input.session,
      });
      return NextResponse.json({ ok: true, ...result, results: result.results.map((row) => ({ ...row, id: `asset:${row.assetId}` })) });
    }

    if (action === "shelf") {
      const input = worldShelfSchema.parse(body);
      return NextResponse.json({
        ok: true,
        ...await client.mutation(api.worlds.saveWorldShelf, {
          ownerUserId, world: input.world, shelf: input.shelf, name: input.name, kind: input.kind,
          description: input.description, group: input.group, sortOrder: input.sortOrder, actor, session: input.session,
        }),
      });
    }

    if (action === "move") {
      const input = worldMoveSchema.parse(body);
      const result = await client.mutation(api.worlds.moveToWorld, {
        ownerUserId, world: input.world,
        shelf: input.shelf ? bare(input.shelf, "(?:folder|collection|shelf|storybook)") : undefined,
        moodboard: input.moodboard ? bare(input.moodboard, "moodboard") as Id<"moodboards"> : undefined,
        name: input.name, into: input.into, items: input.items, dryRun: input.dryRun, note: input.note, actor, session: input.session,
      });
      return NextResponse.json({
        ok: !result.blocked,
        ...result,
        next: result.dryRun
          ? result.blocked ? `The move would be refused: ${result.blocked}` : "Nothing was changed. Looks right? Call world_move again without dryRun."
          : result.storiesToRepoint.length > 0 ? "Some stories now span two worlds: repoint them with update_story (folderId)." : undefined,
      });
    }

    if (action === "mark") {
      const input = worldMarkSchema.parse(body);
      return NextResponse.json({
        ok: true,
        ...await client.mutation(api.worlds.markWorld, {
          ownerUserId, folderId: bare(input.collectionId, "(?:folder|collection)") as Id<"folders">,
          worldKey: input.worldKey, convertStorybook: input.convertStorybook, actor, session: input.session,
        }),
      });
    }

    if (action === "profiles") {
      const input = worldProfileSchema.parse(body);
      if (input.op === "list") {
        const profiles = await client.query(api.mjProfiles.listProfiles, { ownerUserId, world: input.world, includeRetired: input.includeRetired });
        return NextResponse.json({ count: profiles.length, profiles });
      }
      if (!input.world) return NextResponse.json({ error: "Saving a profile names the world it is for (world)." }, { status: 400 });
      return NextResponse.json({
        ok: true,
        ...await client.mutation(api.mjProfiles.saveProfile, {
          ownerUserId, world: input.world, profile: input.profile, name: input.name, code: input.code, codeNote: input.codeNote,
          mjProfileId: input.mjProfileId, notes: input.notes, status: input.status, role: input.role, styleTag: input.styleTag,
          expectedRevision: input.expectedRevision, actor, session: input.session,
        }),
      });
    }

    if (action === "journal") {
      const input = worldJournalSchema.parse(body);
      if (input.changeId) {
        const change = await client.query(api.worlds.getWorldChange, { ownerUserId, changeId: bare(input.changeId, "change") as Id<"worldChanges"> });
        return NextResponse.json({
          ...change,
          before: change.before ? JSON.parse(change.before) : null,
          after: change.after ? JSON.parse(change.after) : null,
        });
      }
      return NextResponse.json(await client.query(api.worlds.listWorldChanges, {
        ownerUserId, world: input.world, session: input.session, before: input.before, limit: input.limit,
      }));
    }

    const input = worldUndoSchema.parse(body);
    const result = await client.mutation(api.worlds.undoWorldChanges, {
      ownerUserId,
      changeId: input.changeId ? bare(input.changeId, "change") as Id<"worldChanges"> : undefined,
      undoSession: input.session, world: input.world, dryRun: input.dryRun, actor,
    }).catch((error: unknown) => {
      // Dry runs and blocked runs roll back and report through the error.
      const report = undoReport(error);
      if (report) return report;
      throw error;
    });
    return NextResponse.json({
      ok: result.blocked.length === 0,
      ...result,
      next: result.blocked.length > 0
        ? "Nothing was changed: the run stops at a blocked change. Undo or fix the later change first."
        : result.dryRun ? "Nothing was changed. Looks right? Call world_undo again with dryRun: false." : undefined,
    });
  } catch (error) {
    if (error instanceof AgentAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: z.prettifyError(error) }, { status: 400 });
    return NextResponse.json({ error: clientErrorMessage(error, "The world request failed.") }, { status: 400 });
  }
}
