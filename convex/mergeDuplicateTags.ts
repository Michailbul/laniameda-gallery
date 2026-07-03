// One-off data-cleanup migration. The extension save route used to attach both
// "midjourney-personalize" and "personalize" on Midjourney teach-page saves
// (see app/api/extension/save/route.ts). That's now fixed to only add
// "personalize", but existing assets/prompts/design inspirations may still
// carry the old "midjourney-personalize" tag. This merges it into
// "personalize" everywhere it's referenced, then deletes the duplicate tag.
//
// Run once via:
//   CONVEX_DEPLOYMENT=dev:perfect-buffalo-375 bunx convex run mergeDuplicateTags:mergePersonalizeTag '{}'
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { canonicalTagKey } from "./helpers";

async function mergeTagIdInArray(
  ids: Id<"tags">[],
  fromTagId: Id<"tags">,
  toTagId: Id<"tags">,
) {
  const withoutFrom = ids.filter((id) => id !== fromTagId);
  if (withoutFrom.includes(toTagId)) return withoutFrom;
  return [...withoutFrom, toTagId];
}

export const mergePersonalizeTag = internalMutation({
  args: {},
  returns: v.object({
    merged: v.boolean(),
    assetLinksMoved: v.number(),
    promptLinksMoved: v.number(),
    designInspirationLinksMoved: v.number(),
  }),
  handler: async (ctx) => {
    const allTags = await ctx.db.query("tags").collect();
    const fromTag = allTags.find(
      (tag) => canonicalTagKey(tag.name) === "midjourney personalize",
    );
    const toTag = allTags.find((tag) => tag.normalized === "personalize");

    if (!fromTag) {
      return {
        merged: false,
        assetLinksMoved: 0,
        promptLinksMoved: 0,
        designInspirationLinksMoved: 0,
      };
    }
    if (!toTag) {
      throw new Error(
        "Canonical 'personalize' tag not found; refusing to merge without a destination.",
      );
    }

    const assetLinks = await ctx.db
      .query("assetTags")
      .withIndex("by_tag_createdAt", (q) => q.eq("tagId", fromTag._id))
      .collect();
    for (const link of assetLinks) {
      const siblings = await ctx.db
        .query("assetTags")
        .withIndex("by_asset", (q) => q.eq("assetId", link.assetId))
        .collect();
      if (!siblings.some((s) => s.tagId === toTag._id)) {
        await ctx.db.insert("assetTags", {
          assetId: link.assetId,
          tagId: toTag._id,
          createdAt: link.createdAt,
        });
      }
      await ctx.db.delete(link._id);

      const asset = await ctx.db.get(link.assetId);
      if (asset) {
        await ctx.db.patch(link.assetId, {
          tagIds: await mergeTagIdInArray(asset.tagIds, fromTag._id, toTag._id),
        });
      }
    }

    const promptLinks = await ctx.db
      .query("promptTags")
      .withIndex("by_tag_createdAt", (q) => q.eq("tagId", fromTag._id))
      .collect();
    for (const link of promptLinks) {
      const siblings = await ctx.db
        .query("promptTags")
        .withIndex("by_prompt", (q) => q.eq("promptId", link.promptId))
        .collect();
      if (!siblings.some((s) => s.tagId === toTag._id)) {
        await ctx.db.insert("promptTags", {
          promptId: link.promptId,
          tagId: toTag._id,
          createdAt: link.createdAt,
        });
      }
      await ctx.db.delete(link._id);

      const prompt = await ctx.db.get(link.promptId);
      if (prompt) {
        await ctx.db.patch(link.promptId, {
          tagIds: await mergeTagIdInArray(prompt.tagIds, fromTag._id, toTag._id),
        });
      }
    }

    const designInspirationLinks = await ctx.db
      .query("designInspirationTags")
      .withIndex("by_tag_createdAt", (q) => q.eq("tagId", fromTag._id))
      .collect();
    for (const link of designInspirationLinks) {
      const siblings = await ctx.db
        .query("designInspirationTags")
        .withIndex("by_designInspiration", (q) =>
          q.eq("designInspirationId", link.designInspirationId),
        )
        .collect();
      if (!siblings.some((s) => s.tagId === toTag._id)) {
        await ctx.db.insert("designInspirationTags", {
          designInspirationId: link.designInspirationId,
          tagId: toTag._id,
          createdAt: link.createdAt,
        });
      }
      await ctx.db.delete(link._id);

      const designInspiration = await ctx.db.get(link.designInspirationId);
      if (designInspiration) {
        await ctx.db.patch(link.designInspirationId, {
          tagIds: await mergeTagIdInArray(
            designInspiration.tagIds,
            fromTag._id,
            toTag._id,
          ),
        });
      }
    }

    // assetPacks and workflows only carry a denormalized tagIds array (no join table).
    for (const table of ["assetPacks", "workflows"] as const) {
      const rows = await ctx.db.query(table).collect();
      for (const row of rows) {
        if (row.tagIds.includes(fromTag._id)) {
          await ctx.db.patch(row._id, {
            tagIds: await mergeTagIdInArray(row.tagIds, fromTag._id, toTag._id),
          });
        }
      }
    }

    await ctx.db.patch(toTag._id, {
      usageCount: toTag.usageCount + fromTag.usageCount,
    });
    await ctx.db.delete(fromTag._id);

    return {
      merged: true,
      assetLinksMoved: assetLinks.length,
      promptLinksMoved: promptLinks.length,
      designInspirationLinksMoved: designInspirationLinks.length,
    };
  },
});
