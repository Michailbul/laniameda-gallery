import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { addAssetFolderLink, replaceAssetFolderLinks } from "./assets";
import { decideShelves, isShelfGroup, type Shelf, type ShelfAnswers, type ShelfGroup } from "../lib/shelf-rules";

// Storage side of auto-shelving (the action is convex/shelfClassify.ts, the
// questions and rule lib/shelf-rules.ts). One row per asset keeps the answers
// and exactly which shelves they added, so a bad pick can be taken back.

const answerValidator = v.object({ choice: v.optional(v.string()), confidence: v.optional(v.number()), p: v.optional(v.number()) });
const shelfValidator = v.object({ id: v.string(), name: v.string(), group: v.string(), description: v.optional(v.string()) });

const rowOf = (ctx: { db: QueryCtx["db"] }, assetId: Id<"assets">) =>
  ctx.db.query("assetShelfFilings").withIndex("by_asset", (q) => q.eq("assetId", assetId)).first();

type World = { world: Doc<"folders">; shelves: Shelf[]; skipGroups: ShelfGroup[] };

/** The world the asset was saved into, its auto-filable shelves, and the groups it already has a shelf in. */
const worldOf = async (ctx: QueryCtx, asset: Doc<"assets">): Promise<World | null> => {
  const links = await ctx.db.query("assetFolders").withIndex("by_asset", (q) => q.eq("assetId", asset._id)).collect();
  const folderIds = new Set<Id<"folders">>(links.map((link) => link.folderId));
  if (asset.folderId) folderIds.add(asset.folderId);
  const folders = (await Promise.all([...folderIds].map((id) => ctx.db.get(id)))).filter((row): row is Doc<"folders"> => Boolean(row));
  // Art-director scope (9 Nov 2026): a piece Michael keeps on an art-director
  // shelf is placed by hand only; auto-shelving never moves it anywhere.
  if (folders.some((folder) => folder.scope === "art_director")) return null;
  for (const folder of folders) {
    const world = folder.parentFolderId ? await ctx.db.get(folder.parentFolderId) : folder;
    if (!world || !world.worldKey) continue;
    const children = await ctx.db.query("folders").withIndex("by_parent", (q) => q.eq("parentFolderId", world._id)).collect();
    const shelves: Shelf[] = children
      .filter((child) => isShelfGroup(child.group) && child.kind !== "storybook" && child.scope !== "art_director")
      .map((child) => ({ id: child._id, name: child.name, group: child.group as ShelfGroup, description: child.description }));
    if (shelves.length === 0) continue;
    const skip = new Set<ShelfGroup>();
    for (const child of children) if (folderIds.has(child._id) && isShelfGroup(child.group)) skip.add(child.group);
    return { world, shelves, skipGroups: [...skip] };
  }
  return null;
};

/** For the action: the world, its shelves and the picture to read. Null when there is nothing to file. */
export const getShelfContext = internalQuery({
  args: { assetId: v.id("assets") },
  returns: v.union(v.null(), v.object({
    worldId: v.id("folders"),
    worldName: v.string(),
    shelves: v.array(shelfValidator),
    skipGroups: v.array(v.string()),
    filed: v.boolean(),
  })),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset || (asset.kind !== "image" && asset.kind !== "video")) return null;
    const found = await worldOf(ctx, asset);
    if (!found) return null;
    const row = await rowOf(ctx, asset._id);
    return {
      worldId: found.world._id,
      worldName: found.world.name,
      shelves: found.shelves,
      skipGroups: found.skipGroups,
      filed: row?.status === "done",
    };
  },
});

/** Saves the answers and puts the asset on the shelves they earn. Returns the shelf names added. */
export const saveShelfFiling = internalMutation({
  args: {
    assetId: v.id("assets"),
    model: v.string(),
    version: v.number(),
    status: v.union(v.literal("done"), v.literal("error")),
    answers: v.optional(v.record(v.string(), answerValidator)),
    error: v.optional(v.string()),
    apply: v.optional(v.boolean()),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) return [];
    // Re-read the world now: the asset may have moved while the model was answering.
    const found = await worldOf(ctx, asset);
    if (!found) return [];
    const previous = await rowOf(ctx, asset._id);
    const added: Id<"folders">[] = [...(previous?.addedFolderIds ?? [])];
    const names: string[] = [];
    if (args.status === "done" && args.answers && args.apply !== false) {
      const picks = decideShelves(found.shelves, args.answers as ShelfAnswers, new Set(found.skipGroups));
      for (const id of picks) {
        const folderId = id as Id<"folders">;
        if (added.includes(folderId)) continue;
        await addAssetFolderLink(ctx, asset.ownerUserId ?? "", asset._id, folderId);
        added.push(folderId);
        names.push(found.shelves.find((shelf) => shelf.id === id)?.name ?? id);
      }
    }
    const row = {
      ownerUserId: asset.ownerUserId ?? "",
      assetId: asset._id,
      worldId: found.world._id,
      model: args.model,
      version: args.version,
      status: args.status,
      answers: args.answers ?? previous?.answers,
      addedFolderIds: added,
      error: args.error,
      filedAt: Date.now(),
    };
    if (previous) await ctx.db.replace(previous._id, row);
    else await ctx.db.insert("assetShelfFilings", row);
    return names;
  },
});

/** Takes the auto-picked shelves back off these assets (and only those). */
export const undoShelfFilings = internalMutation({
  args: { assetIds: v.array(v.id("assets")) },
  returns: v.number(),
  handler: async (ctx, args) => {
    let removed = 0;
    for (const assetId of args.assetIds.slice(0, 200)) {
      const row = await rowOf(ctx, assetId);
      const asset = await ctx.db.get(assetId);
      if (!row || !asset || row.addedFolderIds.length === 0) continue;
      const drop = new Set<string>(row.addedFolderIds);
      const links = await ctx.db.query("assetFolders").withIndex("by_asset", (q) => q.eq("assetId", assetId)).collect();
      // The primary collection stays first, so it stays the primary.
      const keep = links.map((link) => link.folderId).filter((id) => !drop.has(id))
        .sort((a, b) => Number(b === asset.folderId) - Number(a === asset.folderId));
      await replaceAssetFolderLinks(ctx, asset.ownerUserId ?? "", asset, keep);
      removed += row.addedFolderIds.length;
      await ctx.db.patch(row._id, { addedFolderIds: [] });
    }
    return removed;
  },
});
