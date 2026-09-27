import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
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
  pillar?: string;
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

// Index tags for name lookup: exact normalized name, then canonical key, then
// aliases (tags.aliases). A real tag name always wins over an alias, so an
// alias can only redirect spellings that aren't tags in their own right.
const indexTagsForLookup = (allTags: TagDocLike[]) => {
  const byNormalized = new Map<string, TagDocLike>();
  const byCanonical = new Map<string, TagDocLike>();
  for (const tag of allTags) {
    byNormalized.set(tag.normalized, tag);
    const canonical = canonicalTagKey(tag.name);
    if (canonical) byCanonical.set(canonical, tag);
  }
  for (const tag of allTags) {
    for (const alias of tag.aliases ?? []) {
      const key = canonicalTagKey(alias);
      if (key && !byCanonical.has(key)) byCanonical.set(key, tag);
    }
  }
  return { byNormalized, byCanonical };
};

export const getOrCreateTags = mutation({
  args: { names: v.array(v.string()) },
  returns: v.array(v.id("tags")),
  handler: async (ctx, args) => {
    const ids: Id<"tags">[] = [];
    const allTags = await ctx.db
      .query("tags")
      .withIndex("by_normalized", (q) => q.gte("normalized", ""))
      .collect();
    const { byNormalized, byCanonical } = indexTagsForLookup(allTags);

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
        canonicalKey: canonicalTagKey(raw),
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
    const { byNormalized, byCanonical } = indexTagsForLookup(allTags);

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
        canonicalKey: canonicalTagKey(input.name),
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

// Point alternate spellings at one canonical tag ("filmic" -> "cinematic"),
// so future saves reuse it instead of minting a synonym. Aliases that are
// already real tags are reported and ignored: merging two live tags is a
// separate, deliberate operation.
export const addTagAliases = mutation({
  args: {
    name: v.string(),
    aliases: v.array(v.string()),
  },
  returns: v.object({
    tagId: v.optional(v.id("tags")),
    aliases: v.array(v.string()),
    ignoredExistingTags: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const key = canonicalTagKey(args.name);
    const tag = key
      ? await ctx.db
          .query("tags")
          .withIndex("by_canonicalKey", (q) => q.eq("canonicalKey", key))
          .first()
      : null;
    if (!tag) {
      return { aliases: [], ignoredExistingTags: [] };
    }

    const current = tag.aliases ?? [];
    const seen = new Set([key, ...current.map((alias) => canonicalTagKey(alias))]);
    const added: string[] = [];
    const ignored: string[] = [];
    for (const raw of args.aliases) {
      const alias = raw.trim();
      const aliasKey = canonicalTagKey(alias);
      if (!aliasKey || seen.has(aliasKey)) continue;
      const clash = await ctx.db
        .query("tags")
        .withIndex("by_canonicalKey", (q) => q.eq("canonicalKey", aliasKey))
        .first();
      if (clash) {
        ignored.push(alias);
        continue;
      }
      seen.add(aliasKey);
      added.push(alias);
    }
    const aliases = [...current, ...added];
    if (added.length > 0) {
      await ctx.db.patch(tag._id, { aliases });
    }
    return { tagId: tag._id, aliases, ignoredExistingTags: ignored };
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
      canonicalKey: v.optional(v.string()),
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

// Backfill/repair for tags.canonicalKey (see schema comment). Safe to re-run:
//   bunx convex run tags:backfillCanonicalKeys
export const backfillCanonicalKeys = internalMutation({
  args: {},
  returns: v.object({ scanned: v.number(), patched: v.number() }),
  handler: async (ctx) => {
    const tags = await ctx.db.query("tags").collect();
    let patched = 0;
    for (const tag of tags) {
      const canonicalKey = canonicalTagKey(tag.name);
      if (tag.canonicalKey === canonicalKey) continue;
      await ctx.db.patch(tag._id, { canonicalKey });
      patched += 1;
    }
    return { scanned: tags.length, patched };
  },
});
