import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { resolveUserIdCandidates } from "./authz";

const positionReturnValidator = v.object({
  _id: v.id("canvasPositions"),
  _creationTime: v.number(),
  assetId: v.id("assets"),
  ownerUserId: v.string(),
  x: v.number(),
  y: v.number(),
  zIndex: v.optional(v.number()),
  updatedAt: v.number(),
});

export const listPositions = query({
  args: { ownerUserId: v.string() },
  returns: v.array(positionReturnValidator),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) return [];
    const candidates = resolveUserIdCandidates(ownerUserId);
    const results: Array<typeof positionReturnValidator.type> = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const rows = await ctx.db
        .query("canvasPositions")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", candidate))
        .collect();
      for (const row of rows) {
        if (!seen.has(row._id)) {
          seen.add(row._id);
          results.push(row);
        }
      }
    }
    return results;
  },
});

export const upsertPosition = mutation({
  args: {
    ownerUserId: v.string(),
    assetId: v.id("assets"),
    x: v.number(),
    y: v.number(),
    zIndex: v.optional(v.number()),
  },
  returns: v.id("canvasPositions"),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const existing = await ctx.db
      .query("canvasPositions")
      .withIndex("by_owner_asset", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("assetId", args.assetId),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        x: args.x,
        y: args.y,
        zIndex: args.zIndex,
        updatedAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("canvasPositions", {
      assetId: args.assetId,
      ownerUserId,
      x: args.x,
      y: args.y,
      zIndex: args.zIndex,
      updatedAt: Date.now(),
    });
  },
});

export const batchUpsertPositions = mutation({
  args: {
    ownerUserId: v.string(),
    positions: v.array(
      v.object({
        assetId: v.id("assets"),
        x: v.number(),
        y: v.number(),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    let count = 0;
    for (const pos of args.positions) {
      const existing = await ctx.db
        .query("canvasPositions")
        .withIndex("by_owner_asset", (q) =>
          q.eq("ownerUserId", ownerUserId).eq("assetId", pos.assetId),
        )
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          x: pos.x,
          y: pos.y,
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.insert("canvasPositions", {
          assetId: pos.assetId,
          ownerUserId,
          x: pos.x,
          y: pos.y,
          updatedAt: Date.now(),
        });
      }
      count++;
    }
    return count;
  },
});
