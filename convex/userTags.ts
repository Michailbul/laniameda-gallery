import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { canonicalTagKey, normalizeTagName } from "./helpers";
import {
  optionalPillarValidator,
  tagCategoryValidator,
  tagSourceValidator,
} from "./validators";
import { resolveUserIdCandidates } from "./authz";
import { ownerMutation, ownerQuery } from "./actor";
import { filterTags, pageRows, projectSlimTag, sortTagsByUsage } from "../lib/agent-read-projections";

type TagCategory = Doc<"tags">["category"];
type TagSource = Doc<"tags">["source"];

const userTagResultValidator = v.object({
  _id: v.optional(v.id("userTags")),
  tagId: v.id("tags"),
  ownerUserId: v.string(),
  name: v.string(),
  label: v.string(),
  normalizedLabel: v.string(),
  description: v.optional(v.string()),
  category: tagCategoryValidator,
  pillar: optionalPillarValidator,
  source: tagSourceValidator,
  color: v.optional(v.string()),
  sortOrder: v.number(),
  archivedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
  usageCount: v.number(),
  isCustomized: v.boolean(),
});

const normalizeOptional = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const normalizeColor = (value: string | undefined) => {
  const trimmed = normalizeOptional(value);
  if (!trimmed) return undefined;
  if (!/^#[0-9a-f]{6}$/i.test(trimmed)) {
    throw new ConvexError("Tag color must be a 6-digit hex value.");
  }
  return trimmed;
};

const findTagByName = async (ctx: QueryCtx | MutationCtx, rawName: string) => {
  const normalized = normalizeTagName(rawName);
  if (!normalized) return null;

  const exact = await ctx.db
    .query("tags")
    .withIndex("by_normalized", (q) => q.eq("normalized", normalized))
    .unique();
  if (exact) return exact;

  const canonical = canonicalTagKey(rawName);
  if (!canonical) return null;

  const allTags = await ctx.db
    .query("tags")
    .withIndex("by_normalized", (q) => q.gte("normalized", ""))
    .collect();
  return allTags.find((tag) => canonicalTagKey(tag.name) === canonical) ?? null;
};

const getOrCreateTag = async (
  ctx: MutationCtx,
  input: {
    name: string;
    category?: TagCategory;
    pillar?: string;
    source?: TagSource;
  },
) => {
  const name = input.name.trim();
  const normalized = normalizeTagName(name);
  if (!normalized) {
    throw new ConvexError("Tag name is required.");
  }

  const existing = await findTagByName(ctx, name);
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
    return existing._id;
  }

  return await ctx.db.insert("tags", {
    name,
    normalized,
    canonicalKey: canonicalTagKey(name),
    usageCount: 0,
    category: input.category,
    pillar: input.pillar,
    source: input.source,
  });
};

const addTagUsage = (
  counts: Map<Id<"tags">, number>,
  tagIds: Id<"tags">[],
) => {
  const seen = new Set<Id<"tags">>();
  for (const tagId of tagIds) {
    if (seen.has(tagId)) continue;
    seen.add(tagId);
    counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
  }
};

const collectOwnerTagUsage = async (ctx: QueryCtx, ownerUserId: string) => {
  const ownerUserIds = resolveUserIdCandidates(ownerUserId);
  const counts = new Map<Id<"tags">, number>();
  const seenRows = new Set<string>();

  for (const ownerCandidate of ownerUserIds) {
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_owner_createdAt", (q) =>
        q.eq("ownerUserId", ownerCandidate).gte("createdAt", 0),
      )
      .collect();
    for (const asset of assets) {
      const rowKey = `asset:${asset._id}`;
      if (seenRows.has(rowKey)) continue;
      seenRows.add(rowKey);
      addTagUsage(counts, asset.tagIds);
    }

    const prompts = await ctx.db
      .query("prompts")
      .withIndex("by_owner_createdAt", (q) =>
        q.eq("ownerUserId", ownerCandidate).gte("createdAt", 0),
      )
      .collect();
    for (const prompt of prompts) {
      const rowKey = `prompt:${prompt._id}`;
      if (seenRows.has(rowKey)) continue;
      seenRows.add(rowKey);
      addTagUsage(counts, prompt.tagIds);
    }

    const designs = await ctx.db
      .query("designInspirations")
      .withIndex("by_owner_createdAt", (q) =>
        q.eq("ownerUserId", ownerCandidate).gte("createdAt", 0),
      )
      .collect();
    for (const design of designs) {
      const rowKey = `design:${design._id}`;
      if (seenRows.has(rowKey)) continue;
      seenRows.add(rowKey);
      addTagUsage(counts, design.tagIds);
    }
  }

  return counts;
};

const hydrateTags = async (ctx: QueryCtx, tagIds: Iterable<Id<"tags">>) => {
  const result = new Map<Id<"tags">, Doc<"tags">>();
  for (const tagId of tagIds) {
    const tag = await ctx.db.get(tagId);
    if (tag) {
      result.set(tagId, tag);
    }
  }
  return result;
};

type UserTagRow = {
  _id?: Id<"userTags">; tagId: Id<"tags">; ownerUserId: string; name: string; label: string; normalizedLabel: string;
  description?: string; category: TagCategory; pillar: Doc<"tags">["pillar"]; source: TagSource; color?: string;
  sortOrder: number; archivedAt?: number; createdAt: number; updatedAt: number; usageCount: number; isCustomized: boolean;
};

// Every tag the owner has customized or used, with its usage count: the rows
// behind list_tags, unsorted. Reads the whole asset table for the counts, so
// callers filter and page the result rather than calling this per tag.
const collectUserTagRows = async (ctx: QueryCtx, ownerUserId: string, includeArchived: boolean | undefined): Promise<UserTagRow[]> => {

    const [customTags, usageCounts] = await Promise.all([
      ctx.db
        .query("userTags")
        .withIndex("by_owner_sortOrder", (q) =>
          q.eq("ownerUserId", ownerUserId).gte("sortOrder", 0),
        )
        .collect(),
      collectOwnerTagUsage(ctx, ownerUserId),
    ]);

    const activeCustomTags = customTags.filter(
      (tag) => includeArchived || !tag.archivedAt,
    );
    const tagIds = new Set<Id<"tags">>();
    for (const tag of activeCustomTags) {
      tagIds.add(tag.tagId);
    }
    for (const tagId of usageCounts.keys()) {
      tagIds.add(tagId);
    }

    const tagDocs = await hydrateTags(ctx, tagIds);
    const customByTagId = new Map(activeCustomTags.map((tag) => [tag.tagId, tag]));
    const rows: UserTagRow[] = [];

    for (const customTag of activeCustomTags) {
      const tag = tagDocs.get(customTag.tagId);
      if (!tag) continue;
      rows.push({
        _id: customTag._id,
        tagId: customTag.tagId,
        ownerUserId,
        name: tag.name,
        label: customTag.label,
        normalizedLabel: customTag.normalizedLabel,
        description: customTag.description,
        category: customTag.category ?? tag.category,
        pillar: customTag.pillar ?? tag.pillar,
        source: customTag.source ?? tag.source,
        color: customTag.color,
        sortOrder: customTag.sortOrder,
        archivedAt: customTag.archivedAt,
        createdAt: customTag.createdAt,
        updatedAt: customTag.updatedAt,
        usageCount: usageCounts.get(customTag.tagId) ?? 0,
        isCustomized: true,
      });
    }

    for (const [tagId, count] of usageCounts.entries()) {
      if (customByTagId.has(tagId)) continue;
      const tag = tagDocs.get(tagId);
      if (!tag) continue;
      rows.push({
        tagId,
        ownerUserId,
        name: tag.name,
        label: tag.name,
        normalizedLabel: tag.normalized,
        description: undefined,
        category: tag.category,
        pillar: tag.pillar,
        source: tag.source,
        color: undefined,
        sortOrder: 1000,
        archivedAt: undefined,
        createdAt: tag._creationTime,
        updatedAt: tag._creationTime,
        usageCount: count,
        isCustomized: false,
      });
    }

    return rows;
};

export const listUserTags = ownerQuery({
  args: {
    ownerUserId: v.string(),
    includeArchived: v.optional(v.boolean()),
  },
  returns: v.array(userTagResultValidator),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const rows = await collectUserTagRows(ctx, ownerUserId, args.includeArchived);
    return rows.sort((left, right) => {
      const orderDiff = left.sortOrder - right.sortOrder;
      if (orderDiff !== 0) return orderDiff;
      return left.label.localeCompare(right.label);
    });
  },
});

const slimTagValidator = v.object({
  name: v.string(), label: v.optional(v.string()), category: v.optional(v.string()), description: v.optional(v.string()),
  usageCount: v.number(), customized: v.optional(v.literal(true)), archived: v.optional(v.literal(true)),
});

// The vocabulary for the agent's list_tags: every tag that is used or that
// Michael customized, with usageCount read from the tag row itself
// (bumpTagUsage keeps it in step with assets, prompts and designs). Reading
// the counts by scanning the owner's assets, as listUserTags does, crossed
// Convex's 16 MB read limit once the gallery passed a few thousand pieces.
const collectTagVocabulary = async (ctx: QueryCtx, ownerUserId: string, includeArchived: boolean | undefined): Promise<UserTagRow[]> => {
  const [customTags, tags] = await Promise.all([
    ctx.db.query("userTags").withIndex("by_owner_sortOrder", (q) => q.eq("ownerUserId", ownerUserId).gte("sortOrder", 0)).collect(),
    ctx.db.query("tags").withIndex("by_normalized", (q) => q.gte("normalized", "")).collect(),
  ]);
  const customByTagId = new Map(customTags.filter((tag) => includeArchived || !tag.archivedAt).map((tag) => [tag.tagId, tag]));
  const rows: UserTagRow[] = [];
  for (const tag of tags) {
    const custom = customByTagId.get(tag._id);
    if (!custom && tag.usageCount <= 0) continue;
    rows.push(custom
      ? {
        _id: custom._id, tagId: tag._id, ownerUserId, name: tag.name, label: custom.label, normalizedLabel: custom.normalizedLabel,
        description: custom.description, category: custom.category ?? tag.category, pillar: custom.pillar ?? tag.pillar, source: custom.source ?? tag.source,
        color: custom.color, sortOrder: custom.sortOrder, archivedAt: custom.archivedAt, createdAt: custom.createdAt, updatedAt: custom.updatedAt,
        usageCount: tag.usageCount, isCustomized: true,
      }
      : {
        tagId: tag._id, ownerUserId, name: tag.name, label: tag.name, normalizedLabel: tag.normalized, description: undefined,
        category: tag.category, pillar: tag.pillar, source: tag.source, color: undefined, sortOrder: 1000, archivedAt: undefined,
        createdAt: tag._creationTime, updatedAt: tag._creationTime, usageCount: tag.usageCount, isCustomized: false,
      });
  }
  return rows;
};

// The agent's list_tags: filtered, most used first, paged, slim by default.
// The vocabulary runs to about a thousand tags, so an unfiltered full read is
// the wrong tool; the cursor is the next offset into the filtered order.
export const listUserTagsPage = ownerQuery({
  args: {
    ownerUserId: v.string(),
    includeArchived: v.optional(v.boolean()),
    search: v.optional(v.string()),
    category: v.optional(v.string()),
    minUsage: v.optional(v.number()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    fields: v.optional(v.union(v.literal("slim"), v.literal("full"))),
  },
  returns: v.object({
    tags: v.array(v.union(slimTagValidator, userTagResultValidator)),
    count: v.number(), total: v.number(), limit: v.number(),
    cursor: v.union(v.string(), v.null()), isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }
    const rows = await collectTagVocabulary(ctx, ownerUserId, args.includeArchived);
    const matching = sortTagsByUsage(filterTags(rows, { search: args.search, category: args.category, minUsage: args.minUsage }));
    const { page, ...paging } = pageRows(matching, args.cursor, args.limit);
    return { tags: args.fields === "full" ? page : page.map(projectSlimTag), ...paging };
  },
});

export const upsertUserTag = ownerMutation({
  args: {
    ownerUserId: v.string(),
    name: v.string(),
    label: v.optional(v.string()),
    description: v.optional(v.string()),
    category: tagCategoryValidator,
    pillar: optionalPillarValidator,
    source: tagSourceValidator,
    color: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
  },
  returns: v.object({
    userTagId: v.id("userTags"),
    tagId: v.id("tags"),
    name: v.string(),
    label: v.string(),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    const name = args.name.trim();
    const label = normalizeOptional(args.label) ?? name;
    const normalizedLabel = normalizeTagName(label);
    if (!name || !normalizedLabel) {
      throw new ConvexError("Tag name is required.");
    }

    const tagId = await getOrCreateTag(ctx, {
      name,
      category: args.category,
      pillar: args.pillar,
      source: args.source ?? "agent",
    });
    const now = Date.now();

    const existingByLabel = await ctx.db
      .query("userTags")
      .withIndex("by_owner_normalizedLabel", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("normalizedLabel", normalizedLabel),
      )
      .unique();
    const existingByTag = await ctx.db
      .query("userTags")
      .withIndex("by_owner_tagId", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("tagId", tagId),
      )
      .unique();
    const existing = existingByLabel ?? existingByTag;
    const patch = {
      tagId,
      label,
      normalizedLabel,
      description: normalizeOptional(args.description),
      category: args.category,
      pillar: args.pillar,
      source: args.source ?? "agent",
      color: normalizeColor(args.color),
      sortOrder: args.sortOrder ?? existing?.sortOrder ?? 100,
      archivedAt: undefined,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return {
        userTagId: existing._id,
        tagId,
        name,
        label,
        created: false,
      };
    }

    const userTagId = await ctx.db.insert("userTags", {
      ownerUserId,
      ...patch,
      createdAt: now,
    });
    return {
      userTagId,
      tagId,
      name,
      label,
      created: true,
    };
  },
});

export const archiveUserTag = ownerMutation({
  args: {
    ownerUserId: v.string(),
    tagId: v.optional(v.id("tags")),
    name: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerUserId = args.ownerUserId.trim();
    if (!ownerUserId) {
      throw new ConvexError("ownerUserId is required.");
    }

    let existing = null;
    if (args.tagId) {
      existing = await ctx.db
        .query("userTags")
        .withIndex("by_owner_tagId", (q) =>
          q.eq("ownerUserId", ownerUserId).eq("tagId", args.tagId as Id<"tags">),
        )
        .unique();
    } else if (args.name) {
      const normalizedLabel = normalizeTagName(args.name);
      if (!normalizedLabel) {
        throw new ConvexError("Tag name is required.");
      }
      existing = await ctx.db
        .query("userTags")
        .withIndex("by_owner_normalizedLabel", (q) =>
          q.eq("ownerUserId", ownerUserId).eq("normalizedLabel", normalizedLabel),
        )
        .unique();
    } else {
      throw new ConvexError("tagId or name is required.");
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        archivedAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});
