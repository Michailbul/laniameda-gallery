import { MutationCtx } from "./_generated/server";
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
