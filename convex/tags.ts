import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { normalizeTagName } from "./helpers";
import { Id } from "./_generated/dataModel";

export const getOrCreateTag = mutation({
  args: { name: v.string() },
  returns: v.id("tags"),
  handler: async (ctx, args) => {
    const normalized = normalizeTagName(args.name);
    if (!normalized) {
      throw new ConvexError("Tag name is required.");
    }

    const existing = await ctx.db
      .query("tags")
      .withIndex("by_normalized", (q) => q.eq("normalized", normalized))
      .unique();
    if (existing) return existing._id;

    return await ctx.db.insert("tags", {
      name: args.name.trim(),
      normalized,
      usageCount: 0,
    });
  },
});

export const getOrCreateTags = mutation({
  args: { names: v.array(v.string()) },
  returns: v.array(v.id("tags")),
  handler: async (ctx, args) => {
    const ids: Id<"tags">[] = [];
    for (const raw of args.names) {
      const normalized = normalizeTagName(raw);
      if (!normalized) continue;

      const existing = await ctx.db
        .query("tags")
        .withIndex("by_normalized", (q) => q.eq("normalized", normalized))
        .unique();
      if (existing) {
        ids.push(existing._id);
        continue;
      }

      const id = await ctx.db.insert("tags", {
        name: raw.trim(),
        normalized,
        usageCount: 0,
      });
      ids.push(id);
    }

    return ids;
  },
});

const tagCategoryValidator = v.optional(v.union(
  v.literal("model_name"),
  v.literal("style"),
  v.literal("content_type"),
  v.literal("platform"),
  v.literal("color"),
  v.literal("custom"),
));

export const getOrCreateTagWithCategory = mutation({
  args: { name: v.string(), category: tagCategoryValidator },
  returns: v.id("tags"),
  handler: async (ctx, args) => {
    const normalized = normalizeTagName(args.name);
    if (!normalized) {
      throw new ConvexError("Tag name is required.");
    }

    const existing = await ctx.db
      .query("tags")
      .withIndex("by_normalized", (q) => q.eq("normalized", normalized))
      .unique();
    if (existing) {
      if (args.category && !existing.category) {
        await ctx.db.patch(existing._id, { category: args.category });
      }
      return existing._id;
    }

    return await ctx.db.insert("tags", {
      name: args.name.trim(),
      normalized,
      usageCount: 0,
      category: args.category,
    });
  },
});

export const listTags = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("tags"),
      _creationTime: v.number(),
      name: v.string(),
      normalized: v.string(),
      usageCount: v.number(),
      category: tagCategoryValidator,
    }),
  ),
  handler: async (ctx) => {
    return await ctx.db
      .query("tags")
      .withIndex("by_normalized", (q) => q.gte("normalized", ""))
      .collect();
  },
});
