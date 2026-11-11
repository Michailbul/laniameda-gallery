import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { signedOwnerQuery } from "./actor";
import { resolveUserIdCandidates } from "./authz";

// The owner's private marks on frames, for every grid at once: which frames
// are super liked ("ready to use") and which carry a comment. Two short id
// lists read through their own indexes, so no grid query has to carry them
// and a frame reads the same on every surface (vault, search, world page).

/** Newest super likes kept on the tiles; older ones still answer onlySuperLiked. */
const SUPER_LIKED_LIMIT = 2000;
/** Newest comments whose frames get the mark. */
const COMMENT_SCAN_LIMIT = 500;

export const listFrameMarks = signedOwnerQuery({
  args: { ownerUserId: v.string() },
  returns: v.object({
    superLiked: v.array(v.id("assets")),
    noted: v.array(v.id("assets")),
  }),
  handler: async (ctx, { ownerUserId }) => {
    const superLiked: Id<"assets">[] = [];
    const noted = new Set<Id<"assets">>();
    for (const owner of resolveUserIdCandidates(ownerUserId)) {
      const ready = await ctx.db
        .query("assets")
        .withIndex("by_owner_superLikedAt", (q) => q.eq("ownerUserId", owner).gt("superLikedAt", 0))
        .order("desc")
        .take(SUPER_LIKED_LIMIT);
      for (const asset of ready) superLiked.push(asset._id);
      const comments = await ctx.db
        .query("assetComments")
        .withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", owner))
        .order("desc")
        .take(COMMENT_SCAN_LIMIT);
      for (const comment of comments) noted.add(comment.assetId);
    }
    return { superLiked: superLiked.slice(0, SUPER_LIKED_LIMIT), noted: [...noted] };
  },
});
