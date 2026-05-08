import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { canonicalTagKey, normalizeTagName } from "./helpers";
import { Id } from "./_generated/dataModel";
import {
  optionalPillarValidator,
  tagCategoryValidator,
  tagSourceValidator,
  typedTagInputValidator,
} from "./validators";

type TagDocLike = {
  _id: Id<"tags">;
  name: string;
  normalized: string;
  usageCount: number;
  category?: string;
  pillar?: "creators" | "designs" | "dump";
  source?: "user" | "agent" | "system";
  aliases?: string[];
};

const findByName = (
  byNormalized: Map<string, TagDocLike>,
  byCanonical: Map<string, TagDocLike>,
  name: string,
) => {
  const normalized = normalizeTagName(name);
  if (!normalized) {
    return null;
  }
  const canonical = canonicalTagKey(name);
  const match =
    byNormalized.get(normalized) ||
    (canonical ? byCanonical.get(canonical) : undefined);
  return match ?? null;
};

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
    const byNormalized = new Map<string, TagDocLike>();
    const byCanonical = new Map<string, TagDocLike>();
    for (const tag of allTags) {
      byNormalized.set(tag.normalized, tag);
      const canonical = canonicalTagKey(tag.name);
      if (canonical) byCanonical.set(canonical, tag);
    }

    for (const raw of args.names) {
      const normalized = normalizeTagName(raw);
      if (!normalized) continue;

      const existing = findByName(byNormalized, byCanonical, raw);
      if (existing) {
        ids.push(existing._id);
        continue;
      }

      const id = await ctx.db.insert("tags", {
        name: raw.trim(),
        normalized,
        usageCount: 0,
      });
      const insertedTag: TagDocLike = {
        _id: id,
        name: raw.trim(),
        normalized,
        usageCount: 0,
      };
      byNormalized.set(normalized, insertedTag);
      const canonical = canonicalTagKey(raw);
      if (canonical) byCanonical.set(canonical, insertedTag);
      ids.push(id);
    }

    return ids;
  },
});

export const getOrCreateTagWithCategory = mutation({
  args: {
    name: v.string(),
    category: tagCategoryValidator,
    pillar: optionalPillarValidator,
    source: tagSourceValidator,
  },
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
      const patch: {
        category?: typeof args.category;
        pillar?: typeof args.pillar;
        source?: typeof args.source;
      } = {};
      if (args.category && !match.category) patch.category = args.category;
      if (args.pillar && !match.pillar) patch.pillar = args.pillar;
      if (args.source && !match.source) patch.source = args.source;
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(match._id, patch);
      }
      return match._id;
    }

    return await ctx.db.insert("tags", {
      name: args.name.trim(),
      normalized,
      usageCount: 0,
      category: args.category,
      pillar: args.pillar,
      source: args.source,
    });
  },
});

export const getOrCreateTagsWithMetadata = mutation({
  args: {
    tags: v.array(typedTagInputValidator),
  },
  returns: v.array(v.id("tags")),
  handler: async (ctx, args) => {
    const ids: Id<"tags">[] = [];
    const allTags = await ctx.db
      .query("tags")
      .withIndex("by_normalized", (q) => q.gte("normalized", ""))
      .collect();
    const byNormalized = new Map<string, TagDocLike>();
    const byCanonical = new Map<string, TagDocLike>();
    for (const tag of allTags) {
      byNormalized.set(tag.normalized, tag);
      const canonical = canonicalTagKey(tag.name);
      if (canonical) byCanonical.set(canonical, tag);
    }

    for (const input of args.tags) {
      const normalized = normalizeTagName(input.name);
      if (!normalized) continue;

      const existing = findByName(byNormalized, byCanonical, input.name);
      if (existing) {
        const patch: {
          category?: typeof input.category;
          pillar?: typeof input.pillar;
          source?: typeof input.source;
        } = {};
        if (input.category && !existing.category) patch.category = input.category;
        if (input.pillar && !existing.pillar) patch.pillar = input.pillar;
        if (input.source && !existing.source) patch.source = input.source;
        if (Object.keys(patch).length > 0) {
          await ctx.db.patch(existing._id, patch);
        }
        ids.push(existing._id);
        continue;
      }

      const id = await ctx.db.insert("tags", {
        name: input.name.trim(),
        normalized,
        usageCount: 0,
        category: input.category,
        pillar: input.pillar,
        source: input.source,
      });
      const insertedTag: TagDocLike = {
        _id: id,
        name: input.name.trim(),
        normalized,
        usageCount: 0,
        category: input.category ?? undefined,
        pillar: input.pillar ?? undefined,
        source: input.source ?? undefined,
      };
      byNormalized.set(normalized, insertedTag);
      const canonical = canonicalTagKey(input.name);
      if (canonical) byCanonical.set(canonical, insertedTag);
      ids.push(id);
    }

    return ids;
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
      pillar: optionalPillarValidator,
      source: tagSourceValidator,
      aliases: v.optional(v.array(v.string())),
    }),
  ),
  handler: async (ctx) => {
    return await ctx.db
      .query("tags")
      .withIndex("by_normalized", (q) => q.gte("normalized", ""))
      .collect();
  },
});
