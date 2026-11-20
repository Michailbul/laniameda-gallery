import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";
import { canActorAccessOwnerUserId, resolveUserIdCandidates } from "./authz";
import {
  CINEMATIC_SHOTS_SHELF, CINEMATIC_SHOT_LIMITS, parseShotCard, pickShots, shotsBlock, type ShotCard,
} from "../lib/cinematic-shots";

// The shot library of the extension's writer (lib/cinematic-shots.ts): the
// frames on the CINEMATIC SHOTS shelf, read as shot cards, the closest to the
// request picked and laid out as one block for the writer's system prompt.

export const forWriter = internalQuery({
  args: { ownerUserId: v.string(), request: v.string() },
  returns: v.object({ text: v.string(), total: v.number(), picked: v.number() }),
  handler: async (ctx, args) => {
    const none = { text: "", total: 0, picked: 0 };
    let shelf: Doc<"folders"> | null = null;
    for (const candidate of resolveUserIdCandidates(args.ownerUserId)) {
      const rows = await ctx.db.query("folders")
        .withIndex("by_owner_normalizedName", (q) => q.eq("ownerUserId", candidate).eq("normalizedName", CINEMATIC_SHOTS_SHELF))
        .take(4);
      shelf = rows.find((row) => canActorAccessOwnerUserId(args.ownerUserId, row.ownerUserId ?? "")) ?? null;
      if (shelf) break;
    }
    if (!shelf) return none;

    const links = await ctx.db.query("assetFolders")
      .withIndex("by_folder_createdAt", (q) => q.eq("folderId", shelf!._id))
      .take(CINEMATIC_SHOT_LIMITS.scan);
    const tagNames = new Map<Id<"tags">, string>();
    const cards: ShotCard[] = [];
    for (const link of links) {
      const asset = await ctx.db.get(link.assetId);
      if (!asset || !canActorAccessOwnerUserId(args.ownerUserId, asset.ownerUserId ?? "")) continue;
      const tags: string[] = [];
      for (const tagId of asset.tagIds) {
        if (!tagNames.has(tagId)) tagNames.set(tagId, (await ctx.db.get(tagId))?.name ?? "");
        const name = tagNames.get(tagId);
        if (name) tags.push(name);
      }
      const card = parseShotCard(asset._id, asset.description, tags);
      if (card) cards.push(card);
    }
    const picked = pickShots(cards, args.request);
    return { text: shotsBlock(picked, cards), total: cards.length, picked: picked.length };
  },
});
