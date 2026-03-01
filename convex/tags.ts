import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { canonicalTagKey, normalizeTagName } from "./helpers";
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

    const canonical = canonicalTagKey(args.name);
    if (canonical) {
      const allTags = await ctx.db
        .query("tags")
        .withIndex("by_normalized", (q) => q.gte("normalized", ""))
        .collect();
      const canonicalMatch = allTags.find(
        (tag) => canonicalTagKey(tag.name) === canonical,
      );
      if (canonicalMatch) return canonicalMatch._id;
    }

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
    const allTags = await ctx.db
      .query("tags")
      .withIndex("by_normalized", (q) => q.gte("normalized", ""))
      .collect();
    const byNormalized = new Map<string, (typeof allTags)[number]>();
    const byCanonical = new Map<string, (typeof allTags)[number]>();
    for (const tag of allTags) {
      byNormalized.set(tag.normalized, tag);
      const canonical = canonicalTagKey(tag.name);
      if (canonical) byCanonical.set(canonical, tag);
    }

    for (const raw of args.names) {
      const normalized = normalizeTagName(raw);
      if (!normalized) continue;
      const canonical = canonicalTagKey(raw);

      const existing =
        byNormalized.get(normalized) ||
        (canonical ? byCanonical.get(canonical) : undefined);
      if (existing) {
        ids.push(existing._id);
        continue;
      }

      const id = await ctx.db.insert("tags", {
        name: raw.trim(),
        normalized,
        usageCount: 0,
      });
      const insertedTag: (typeof allTags)[number] = {
        _id: id,
        _creationTime: Date.now(),
        name: raw.trim(),
        normalized,
        usageCount: 0,
      };
      byNormalized.set(normalized, insertedTag);
      if (canonical) byCanonical.set(canonical, insertedTag);
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
    let match = existing ?? null;

    if (!match) {
      const canonical = canonicalTagKey(args.name);
      if (canonical) {
        const allTags = await ctx.db
          .query("tags")
          .withIndex("by_normalized", (q) => q.gte("normalized", ""))
          .collect();
        match = allTags.find((tag) => canonicalTagKey(tag.name) === canonical) ?? null;
      }
    }

    if (match) {
      if (args.category && !match.category) {
        await ctx.db.patch(match._id, { category: args.category });
      }
      return match._id;
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
