import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { ownerQuery } from "./actor";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import { canonicalFolderName } from "./folderHelpers";
import {
  CINEMATIC_SHOTS_PARENT, CINEMATIC_SHOTS_SHELF, CINEMATIC_SHOT_LIMITS, looseShotCard, parseShotCard, pickShots, randomShots, shotsBlock,
  type ShotCard,
} from "../lib/cinematic-shots";

// The shot library of the extension's writer (lib/cinematic-shots.ts): the
// frames of a cinematic collection (the CINEMATIC SHOTS shelf unless the
// Grow card's "from" names another), read as shot cards, the closest to the
// request or a random draw picked and laid out as one block for the writer.

// A child is stored by "<parent id>/<canonical name>", a root by its own name (convex/folders.ts).
async function folderByName(ctx: QueryCtx, actor: string, candidate: string, normalizedName: string) {
  return (await ctx.db.query("folders")
    .withIndex("by_owner_normalizedName", (q) => q.eq("ownerUserId", candidate).eq("normalizedName", normalizedName))
    .take(4)).find((row) => canActorAccessOwnerUserId(actor, row.ownerUserId ?? "")) ?? null;
}

/** CINEMATIC and its CINEMATIC SHOTS shelf, either missing. */
async function shotRoots(ctx: QueryCtx, actor: string) {
  const shelfName = canonicalFolderName(CINEMATIC_SHOTS_SHELF);
  for (const candidate of resolveUserIdCandidates(actor)) {
    const parent = await folderByName(ctx, actor, candidate, canonicalFolderName(CINEMATIC_SHOTS_PARENT));
    const shelf = (parent ? await folderByName(ctx, actor, candidate, `${parent._id}/${shelfName}`) : null) ?? await folderByName(ctx, actor, candidate, shelfName);
    if (parent || shelf) return { parent, shelf };
  }
  return { parent: null, shelf: null };
}

/** A folder and the folders under it, depth first, at most `limit`. */
async function withDescendants(ctx: QueryCtx, actor: string, root: Doc<"folders">, limit = 40) {
  const out: Array<{ folder: Doc<"folders">; depth: number }> = [];
  const walk = async (folder: Doc<"folders">, depth: number) => {
    if (out.length >= limit || depth > 4) return;
    out.push({ folder, depth });
    const children = await ctx.db.query("folders").withIndex("by_parent", (q) => q.eq("parentFolderId", folder._id)).take(limit);
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      if (canActorAccessOwnerUserId(actor, child.ownerUserId ?? "")) await walk(child, depth + 1);
    }
  };
  await walk(root, 0);
  return out;
}

/** The collection a "from" names, when it is the actor's; else null. */
async function folderOf(ctx: QueryCtx, actor: string, from: string | undefined) {
  const id = from ? ctx.db.normalizeId("folders", from) : null;
  const folder = id ? await ctx.db.get(id) : null;
  return folder && canActorAccessOwnerUserId(actor, folder.ownerUserId ?? "") ? folder : null;
}

/** The shot cards of a collection and the collections under it; frames without a card stand in with their own words. */
async function cardsOf(ctx: QueryCtx, actor: string, root: Doc<"folders">) {
  const tagNames = new Map<Id<"tags">, string>();
  const seen = new Set<Id<"assets">>();
  const cards: ShotCard[] = [];
  for (const { folder } of await withDescendants(ctx, actor, root)) {
    const links = await ctx.db.query("assetFolders")
      .withIndex("by_folder_createdAt", (q) => q.eq("folderId", folder._id))
      .take(CINEMATIC_SHOT_LIMITS.scan);
    for (const link of links) {
      if (seen.has(link.assetId) || seen.size >= CINEMATIC_SHOT_LIMITS.scan * 2) continue;
      seen.add(link.assetId);
      const asset = await ctx.db.get(link.assetId);
      if (!asset || !canActorAccessOwnerUserId(actor, asset.ownerUserId ?? "")) continue;
      const tags: string[] = [];
      for (const tagId of asset.tagIds) {
        if (!tagNames.has(tagId)) tagNames.set(tagId, (await ctx.db.get(tagId))?.name ?? "");
        const name = tagNames.get(tagId);
        if (name) tags.push(name);
      }
      const card = parseShotCard(asset._id, asset.description, tags)
        ?? looseShotCard(asset._id, { title: asset.fileName, agentDescription: asset.agentDescription, description: asset.description }, tags);
      if (card) cards.push(card);
    }
  }
  return cards;
}

export const forWriter = internalQuery({
  args: {
    ownerUserId: v.string(),
    request: v.string(),
    // The collection the shots come from (a folder id); the CINEMATIC SHOTS shelf when empty.
    from: v.optional(v.string()),
    // "random" draws `count` shots with `seed`; otherwise the closest to the request.
    mode: v.optional(v.string()),
    count: v.optional(v.number()),
    seed: v.optional(v.number()),
  },
  returns: v.object({ text: v.string(), total: v.number(), picked: v.number(), from: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const none = { text: "", total: 0, picked: 0 };
    const chosen = await folderOf(ctx, args.ownerUserId, args.from);
    const root = chosen ?? (await shotRoots(ctx, args.ownerUserId)).shelf;
    if (!root) return none;
    const cards = await cardsOf(ctx, args.ownerUserId, root);
    const random = args.mode === "random";
    const picked = random ? randomShots(cards, args.count ?? 4, args.seed ?? Date.now()) : pickShots(cards, args.request);
    const from = chosen ? chosen.name : undefined;
    return { text: shotsBlock(picked, cards, { random, from }), total: cards.length, picked: picked.length, from: root.name };
  },
});

/**
 * The collections the Grow card offers under "from": the CINEMATIC SHOTS
 * shelf first (the default), then CINEMATIC and every collection under it,
 * with how many frames each holds.
 */
export const sources = ownerQuery({
  args: { ownerUserId: v.string() },
  returns: v.object({
    shelf: v.optional(v.string()),
    sources: v.array(v.object({ id: v.string(), name: v.string(), depth: v.number(), count: v.number() })),
  }),
  handler: async (ctx, args) => {
    const { parent, shelf } = await shotRoots(ctx, args.ownerUserId);
    const rows: Array<{ id: string; name: string; depth: number; count: number }> = [];
    const count = async (folder: Doc<"folders">) => (await ctx.db.query("assetFolders")
      .withIndex("by_folder_createdAt", (q) => q.eq("folderId", folder._id)).take(CINEMATIC_SHOT_LIMITS.scan + 1)).length;
    const add = async (folder: Doc<"folders">, depth: number) => {
      if (rows.some((row) => row.id === folder._id)) return;
      rows.push({ id: folder._id, name: folder.name, depth, count: await count(folder) });
    };
    if (shelf) for (const { folder, depth } of await withDescendants(ctx, args.ownerUserId, shelf, 20)) await add(folder, depth);
    if (parent) for (const { folder, depth } of await withDescendants(ctx, args.ownerUserId, parent, 40)) await add(folder, depth);
    return { shelf: shelf?._id, sources: rows };
  },
});
