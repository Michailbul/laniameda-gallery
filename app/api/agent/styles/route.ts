import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AgentAuthError, requireAgentAuth, type AgentTokenScope } from "@/lib/server/agent-auth";
import { getServerConvexClient } from "@/lib/server/convex";
import { clientErrorMessage } from "@/lib/server/route-error";
import { galleryPageUrl, worldStylesUrl } from "@/lib/gallery-routes";
import {
  assetLookupSchema, styleFileSchema, styleGetSchema, styleListSchema, styleMergeSchema, styleSaveSchema, styleUniverseSchema,
} from "@/lib/style-contract";
import { STYLE_LIMITS } from "@/lib/world-styles";

// A world's named styles: list a universe's styles, read one with its
// recipes, create or change one, file frames into it, merge two, join a world
// to a universe, and "is this frame in the gallery?" for local boards. Writes
// are journaled in the world (world_journal) and undone with world_undo.

const actions = ["list", "get", "save", "file", "merge", "universe", "lookup"] as const;
const FILE_BATCH = 100;

const scopeFor = (action: (typeof actions)[number], body: Record<string, unknown>): AgentTokenScope => {
  if (action === "list" || action === "get" || action === "lookup") return "gallery:read";
  if (action === "merge" && body.dryRun === true) return "gallery:read";
  return "gallery:write";
};

const bare = (value: string, prefix: string) => value.trim().replace(new RegExp(`^${prefix}:`), "");
const chunks = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

export async function POST(request: Request) {
  try {
    const body = z.record(z.string(), z.unknown()).parse(await request.json().catch(() => null));
    const action = z.enum(actions).parse(body.action);
    const agent = await requireAgentAuth(request, scopeFor(action, body));
    const ownerUserId = agent.ownerUserId;
    const client = getServerConvexClient(ownerUserId);
    const actor = `agent:${agent.label || agent.tokenPrefix}`.slice(0, 80);

    const readStyle = (style: string, world?: string) => client.query(api.worldStyles.getStyle, { ownerUserId, style: bare(style, "style"), world });
    type StyleRead = Awaited<ReturnType<typeof readStyle>>;
    const styleUrl = (style: Pick<StyleRead, "universe" | "slug">) => worldStylesUrl(style.universe.key, style.slug);

    if (action === "list") {
      const input = styleListSchema.parse(body);
      const result = await client.query(api.worldStyles.listStyles, {
        ownerUserId, world: input.world, universe: input.universe, includeArchived: input.includeArchived, coverLimit: input.covers ?? 2,
      });
      return NextResponse.json({
        universe: { ...result.universe, url: worldStylesUrl(result.universe.key) },
        worlds: result.worlds,
        count: result.styles.length,
        styles: result.styles.map((style) => ({
          id: `style:${style.id}`, name: style.name, line: style.line, family: style.family, status: style.status,
          world: style.world.key, shelfId: style.shelfId, frames: style.frameCount, recipe: style.recipe, recipes: style.recipeCount,
          hasLock: style.hasLock, revision: style.revision,
          covers: style.covers.map((cover) => ({ id: `asset:${cover.assetId}`, thumbUrl: cover.thumbUrl })),
          url: worldStylesUrl(result.universe.key, style.slug),
        })),
        unrecordedShelves: result.unrecordedShelves,
        next: result.unrecordedShelves.length
          ? "unrecordedShelves are shelves in the group Styles with no style record: adopt one with save_style {world, name, shelf} once you know its line and recipe."
          : undefined,
      });
    }

    if (action === "get") {
      const input = styleGetSchema.parse(body);
      const style = await readStyle(input.style, input.world);
      const frames = input.frames
        ? (await client.query(api.worldStyles.listStyleFramesPage, {
          ownerUserId, styleId: style.id, withPrompts: true, paginationOpts: { numItems: input.frames, cursor: null },
        })).page.map((frame) => ({ id: `asset:${frame.assetId}`, kind: frame.kind, thumbUrl: frame.thumbUrl, url: frame.url, width: frame.width, height: frame.height, prompt: frame.prompt }))
        : undefined;
      return NextResponse.json({
        ...style,
        id: `style:${style.id}`,
        url: styleUrl(style),
        shelf: style.shelf ? { ...style.shelf, url: galleryPageUrl({ kind: "world", world: style.world.key, shelf: style.shelf.id }) } : null,
        covers: style.covers.map((cover) => ({ id: `asset:${cover.assetId}`, thumbUrl: cover.thumbUrl, url: cover.url, width: cover.width, height: cover.height })),
        coverAssetIds: style.coverAssetIds.map((id) => `asset:${id}`),
        recipes: style.recipes.map((recipe) => ({
          ...recipe,
          moodboards: recipe.moodboards.map((board) => ({
            id: `moodboard:${board.id}`, name: board.name, status: board.status, items: board.itemCount, code: board.mjCode,
            profileFlag: board.profileFlag, otherWorld: board.otherWorld, url: galleryPageUrl({ kind: "moodboards", id: board.id }),
          })),
          profiles: recipe.profiles.map((profile) => ({ ...profile, id: `profile:${profile.id}` })),
        })),
        lock: style.lock ? { ...style.lock, id: `story:${style.lock.id}`, url: galleryPageUrl({ kind: "stories", id: style.lock.id }) } : null,
        mergedInto: style.mergedInto ? { ...style.mergedInto, id: `style:${style.mergedInto.id}` } : null,
        mergedFrom: style.mergedFrom.map((row) => ({ ...row, id: `style:${row.id}` })),
        frames,
      });
    }

    if (action === "save") {
      const input = styleSaveSchema.parse(body);
      const result = await client.mutation(api.worldStyles.saveStyle, {
        ownerUserId, world: input.world, style: input.style ? bare(input.style, "style") : undefined,
        name: input.name, line: input.line, family: input.family, status: input.status, shelf: input.shelf,
        coverAssetIds: input.coverAssetIds, addCoverAssetIds: input.addCoverAssetIds, recipes: input.recipes,
        raises: input.raises, lowers: input.lowers, lockStoryId: input.lockStoryId, notes: input.notes,
        sortOrder: input.sortOrder, expectedRevision: input.expectedRevision, actor, session: input.session,
      });
      const style = await readStyle(result.styleId);
      return NextResponse.json({ ok: true, ...result, styleId: `style:${result.styleId}`, name: style.name, url: styleUrl(style) });
    }

    if (action === "file") {
      const input = styleFileSchema.parse(body);
      const style = await readStyle(input.style, input.world);
      if (!style.shelf) {
        return NextResponse.json({ error: `"${style.name}" has no shelf for its frames yet. Give it one with save_style {style, shelf} first.` }, { status: 400 });
      }
      const assetIds = [...new Set(input.assetIds.map((id) => bare(id, "asset")))];
      const changes = [];
      let changed = 0;
      for (const batch of chunks(assetIds, FILE_BATCH)) {
        const result = await client.mutation(api.worlds.fileWorldAssets, {
          ownerUserId, world: style.world.key, assetIds: batch as Id<"assets">[],
          ...(input.remove ? { removeFrom: [style.shelf.id] } : { addTo: [style.shelf.id] }),
          move: input.move, note: input.note ?? `${input.remove ? "Off" : "Into"} the style ${style.name}`, actor, session: input.session,
        });
        changed += result.changed;
        if (result.changeId) changes.push(result.changeId);
      }
      let covers: string[] | undefined;
      if (input.covers && !input.remove) {
        await client.mutation(api.worldStyles.saveStyle, {
          ownerUserId, world: style.world.key, style: style.id, addCoverAssetIds: assetIds.slice(0, STYLE_LIMITS.covers), actor, session: input.session,
        });
        covers = (await readStyle(style.id)).coverAssetIds.map((id) => `asset:${id}`);
      }
      return NextResponse.json({ ok: true, style: `style:${style.id}`, shelf: style.shelf.name, sent: assetIds.length, changed, changeIds: changes, covers, url: styleUrl(style) });
    }

    if (action === "merge") {
      const input = styleMergeSchema.parse(body);
      const from = await readStyle(input.from, input.world);
      const into = await readStyle(input.into, input.world);
      const crossWorld = from.world.id !== into.world.id;
      if (crossWorld && from.universe.id !== into.universe.id) {
        return NextResponse.json({ error: `"${from.name}" and "${into.name}" are in different universes; styles merge only inside one.` }, { status: 400 });
      }
      if (crossWorld && !input.move) {
        return NextResponse.json({ error: `"${from.name}" is in ${from.world.name} and "${into.name}" in ${into.world.name}: merging moves its frames across worlds. Pass move: true only on Michael's word.` }, { status: 400 });
      }
      if (from.shelf && !into.shelf) {
        return NextResponse.json({ error: `"${into.name}" has no shelf to take the frames. Give it one with save_style {style, shelf} first.` }, { status: 400 });
      }
      const frameIds: string[] = [];
      if (from.shelf) {
        let cursor: string | null = null;
        for (;;) {
          const page: { assetIds: string[]; isDone: boolean; continueCursor: string } = await client.query(api.worldStyles.listStyleFrameIds, { ownerUserId, styleId: from.id, cursor });
          frameIds.push(...page.assetIds);
          if (page.isDone) break;
          cursor = page.continueCursor;
        }
      }
      const records = await client.mutation(api.worldStyles.mergeStyleRecords, { ownerUserId, from: from.id, into: into.id, dryRun: true });
      if (input.dryRun) {
        return NextResponse.json({
          ok: true, dryRun: true, from: from.name, into: into.name, frames: frameIds.length, crossWorld,
          recipesAdded: records.recipesAdded, coversAdded: records.coversAdded,
          next: "Nothing was changed. Looks right? Call merge_styles again without dryRun.",
        });
      }
      const changeIds = [];
      let moved = 0;
      for (const batch of chunks(frameIds, FILE_BATCH)) {
        const result = await client.mutation(api.worlds.fileWorldAssets, {
          ownerUserId, world: into.world.key, assetIds: batch as Id<"assets">[], addTo: [into.shelf!.id],
          ...(crossWorld ? { move: true } : { removeFrom: [from.shelf!.id] }),
          note: `Merging the style ${from.name} into ${into.name}`, actor, session: input.session,
        });
        moved += result.changed;
        if (result.changeId) changeIds.push(result.changeId);
      }
      const merged = await client.mutation(api.worldStyles.mergeStyleRecords, { ownerUserId, from: from.id, into: into.id, actor, session: input.session });
      if (merged.changeId) changeIds.push(merged.changeId);
      return NextResponse.json({
        ok: true, from: from.name, into: into.name, frames: frameIds.length, moved, recipesAdded: merged.recipesAdded, coversAdded: merged.coversAdded,
        changeIds, url: styleUrl(into),
        next: "The merged style stays as a record pointing at the one it joined; its empty shelf moved to the group Merged (nothing deleted). world_undo with this session reverts it all.",
      });
    }

    if (action === "universe") {
      const input = styleUniverseSchema.parse(body);
      const result = await client.mutation(api.worldStyles.setWorldUniverse, { ownerUserId, world: input.world, universe: input.universe, actor, session: input.session });
      return NextResponse.json({ ok: true, ...result, url: worldStylesUrl(result.universe ?? result.world) });
    }

    const input = assetLookupSchema.parse(body);
    const results = [];
    for (const batch of chunks(input.items, STYLE_LIMITS.lookupChunk)) {
      results.push(...await client.query(api.worldStyles.findAssets, { ownerUserId, items: batch }));
    }
    const found = results.filter((row) => row.found).length;
    return NextResponse.json({
      count: results.length, found, missing: results.length - found,
      results: results.map((row) => ({
        ...row,
        matches: row.matches.map((match) => ({ ...match, id: `asset:${match.assetId}`, assetId: undefined, styles: match.styles.map((s) => ({ ...s, id: `style:${s.id}` })) })),
      })),
    });
  } catch (error) {
    if (error instanceof AgentAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: z.prettifyError(error) }, { status: 400 });
    return NextResponse.json({ error: clientErrorMessage(error, "The styles request failed.") }, { status: 400 });
  }
}
