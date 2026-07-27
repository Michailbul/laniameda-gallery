import { MutationCtx, QueryCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";

export const normalizeTagName = (name: string) =>
  name.trim().toLowerCase().replace(/\s+/g, " ");

export const canonicalTagKey = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export const dedupeIds = <T extends string>(ids: T[]) => {
  return Array.from(new Set(ids));
};

export const bumpTagUsage = async (
  ctx: MutationCtx,
  tagIds: Id<"tags">[],
  delta: number,
) => {
  for (const tagId of tagIds) {
    const tag = await ctx.db.get(tagId);
    if (tag) {
      await ctx.db.patch(tagId, {
        usageCount: Math.max(0, tag.usageCount + delta),
      });
    }
  }
};

// Index-backed lookup of tag docs by canonical key (tags.by_canonicalKey).
// Replaces the full tags-table scans that predated the canonicalKey column.
// Duplicate tag docs sharing a key are all returned — callers that count or
// filter must union them, exactly like the old scan-and-collect did.
export const findTagIdsByCanonicalKeys = async (
  ctx: { db: QueryCtx["db"] },
  keys: Iterable<string>,
) => {
  const map = new Map<string, Id<"tags">[]>();
  for (const key of new Set(keys)) {
    if (!key) continue;
    const matches = await ctx.db
      .query("tags")
      .withIndex("by_canonicalKey", (q) => q.eq("canonicalKey", key))
      .collect();
    if (matches.length > 0) {
      map.set(key, matches.map((tag) => tag._id));
    }
  }
  return map;
};
