import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { resolveAssetThumbUrl, resolveAssetUrl } from "./r2_url";
import { bumpTagUsage, canonicalTagKey, normalizeTagName } from "./helpers";
import { RETIRED_FACET_TAGS, decideFacetTags, type FacetAnswers, type FacetTag } from "../lib/facet-tags";

// Storage side of the auto-tagging (the action is convex/tagClassify.ts,
// the questions and the tag rule lib/facet-tags.ts). One row per asset keeps the
// answers and exactly which tags they added, so a bad batch can be taken back.

const answerValidator = v.object({ choice: v.optional(v.string()), confidence: v.optional(v.number()), p: v.optional(v.number()) });
const INSPIRATION_ROLES = new Set(["inspiration_capture", "bookmark"]);

const rowOf = (ctx: { db: QueryCtx["db"] }, assetId: Id<"assets">) =>
  ctx.db.query("assetClassifications").withIndex("by_asset", (q) => q.eq("assetId", assetId)).first();

/** For the action: which picture to read, and whether it was classified already (at this version or later). */
export const getClassifySource = internalQuery({
  args: { assetId: v.id("assets"), version: v.optional(v.number()) },
  returns: v.union(v.null(), v.object({
    imageUrl: v.optional(v.string()),
    kind: v.string(),
    classified: v.boolean(),
  })),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) return null;
    const thumb = await resolveAssetThumbUrl(ctx, asset);
    // A video is read from its poster only; an image falls back to the original.
    const imageUrl = thumb ?? (asset.kind === "image" ? await resolveAssetUrl(ctx, asset) : undefined);
    const row = await ctx.db.query("assetClassifications").withIndex("by_asset", (q) => q.eq("assetId", asset._id)).first();
    return { imageUrl, kind: asset.kind, classified: row?.status === "done" && row.version >= (args.version ?? 0) };
  },
});

const findOrCreateTag = async (ctx: MutationCtx, tag: FacetTag): Promise<Id<"tags">> => {
  const normalized = normalizeTagName(tag.name);
  const canonical = canonicalTagKey(tag.name);
  const existing =
    (await ctx.db.query("tags").withIndex("by_normalized", (q) => q.eq("normalized", normalized)).first()) ??
    (canonical ? await ctx.db.query("tags").withIndex("by_canonicalKey", (q) => q.eq("canonicalKey", canonical)).first() : null);
  if (existing) {
    if (tag.category && !existing.category) await ctx.db.patch(existing._id, { category: tag.category });
    return existing._id;
  }
  return await ctx.db.insert("tags", { name: tag.name, normalized, canonicalKey: canonical, usageCount: 0, category: tag.category, source: "agent" });
};

/** Saves the answers and adds the tags they earn (lib/facet-tags.ts decides). Returns the added tag names. */
export const saveClassification = internalMutation({
  args: {
    assetId: v.id("assets"),
    model: v.string(),
    version: v.number(),
    status: v.union(v.literal("done"), v.literal("error"), v.literal("no_image")),
    answers: v.optional(v.record(v.string(), answerValidator)),
    error: v.optional(v.string()),
    apply: v.optional(v.boolean()),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) return [];
    const links = await ctx.db.query("assetTags").withIndex("by_asset", (q) => q.eq("assetId", asset._id)).collect();
    const linked = new Set(links.map((link) => link.tagId as string));
    const tagNames: string[] = [];
    for (const link of links) {
      const tag = await ctx.db.get(link.tagId);
      if (tag) tagNames.push(tag.name);
    }
    const previous = await rowOf(ctx, asset._id);
    const added: Id<"tags">[] = [...(previous?.addedTagIds ?? [])];
    const addedNames: string[] = [];
    if (args.status === "done" && args.answers && args.apply !== false) {
      const facets = decideFacetTags(args.answers as FacetAnswers, {
        tagNames,
        isInspiration: INSPIRATION_ROLES.has(asset.assetRole ?? ""),
      });
      const now = Date.now();
      const fresh: Id<"tags">[] = [];
      for (const facet of facets) {
        const tagId = await findOrCreateTag(ctx, facet);
        if (linked.has(tagId)) continue;
        linked.add(tagId);
        await ctx.db.insert("assetTags", { assetId: asset._id, tagId, createdAt: now });
        fresh.push(tagId);
        addedNames.push(facet.name);
      }
      if (fresh.length > 0) {
        await ctx.db.patch(asset._id, { tagIds: [...asset.tagIds, ...fresh] });
        await bumpTagUsage(ctx, fresh, 1);
        added.push(...fresh);
      }
    }
    const row = {
      ownerUserId: asset.ownerUserId ?? "",
      assetId: asset._id,
      model: args.model,
      version: args.version,
      status: args.status,
      answers: args.answers ?? previous?.answers,
      addedTagIds: added,
      error: args.error,
      classifiedAt: Date.now(),
    };
    if (previous) await ctx.db.replace(previous._id, row);
    else await ctx.db.insert("assetClassifications", row);
    return addedNames;
  },
});

/** Takes back the tags the classifier added to these assets (and only those). */
export const undoClassificationTags = internalMutation({
  args: { assetIds: v.array(v.id("assets")) },
  returns: v.number(),
  handler: async (ctx, args) => {
    let removed = 0;
    for (const assetId of args.assetIds.slice(0, 200)) {
      const row = await rowOf(ctx, assetId);
      const asset = await ctx.db.get(assetId);
      if (!row || !asset || row.addedTagIds.length === 0) continue;
      const drop = new Set(row.addedTagIds as string[]);
      const links = await ctx.db.query("assetTags").withIndex("by_asset", (q) => q.eq("assetId", assetId)).collect();
      for (const link of links) if (drop.has(link.tagId)) await ctx.db.delete(link._id);
      await ctx.db.patch(assetId, { tagIds: asset.tagIds.filter((id) => !drop.has(id)) });
      await bumpTagUsage(ctx, row.addedTagIds, -1);
      removed += row.addedTagIds.length;
      await ctx.db.patch(row._id, { addedTagIds: [] });
    }
    return removed;
  },
});

/** One page of an owner's assets, newest first, with no finished classification at this version (backfill). */
export const listAssetsUnclassified = internalQuery({
  args: { ownerUserId: v.string(), cursor: v.optional(v.union(v.string(), v.null())), batchSize: v.optional(v.number()), version: v.optional(v.number()) },
  returns: v.object({ assetIds: v.array(v.id("assets")), nextCursor: v.union(v.string(), v.null()), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("assets")
      .withIndex("by_owner_createdAt", (q) => q.eq("ownerUserId", args.ownerUserId).gte("createdAt", 0))
      .order("desc")
      .paginate({ cursor: args.cursor ?? null, numItems: Math.min(100, Math.max(1, args.batchSize ?? 20)) });
    const assetIds: Id<"assets">[] = [];
    for (const asset of page.page) {
      if (asset.kind !== "image" && asset.kind !== "video") continue;
      const row = await rowOf(ctx, asset._id);
      if (row?.status !== "done" || row.version < (args.version ?? 0)) assetIds.push(asset._id);
    }
    return { assetIds, nextCursor: page.continueCursor, isDone: page.isDone };
  },
});

/**
 * Takes the retired tags (lib/facet-tags.ts) off the pictures the classifier
 * put them on; a tag a person or an agent added stays. Walks the rows a page
 * at a time; run until done is true:
 *   convex run assetClassifications:dropRetiredTags '{}'
 */
export const dropRetiredTags = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ removed: v.number(), nextCursor: v.union(v.string(), v.null()), done: v.boolean() }),
  handler: async (ctx, args) => {
    const retired = new Set<string>();
    for (const name of RETIRED_FACET_TAGS) {
      const tag = await ctx.db.query("tags").withIndex("by_normalized", (q) => q.eq("normalized", normalizeTagName(name))).first();
      if (tag) retired.add(tag._id);
    }
    const page = await ctx.db.query("assetClassifications").paginate({ cursor: args.cursor ?? null, numItems: 200 });
    let removed = 0;
    for (const row of page.page) {
      const drop = row.addedTagIds.filter((id) => retired.has(id));
      if (drop.length === 0) continue;
      const dropSet = new Set<string>(drop);
      const asset = await ctx.db.get(row.assetId);
      if (asset) {
        const links = await ctx.db.query("assetTags").withIndex("by_asset", (q) => q.eq("assetId", asset._id)).collect();
        for (const link of links) if (dropSet.has(link.tagId)) await ctx.db.delete(link._id);
        await ctx.db.patch(asset._id, { tagIds: asset.tagIds.filter((id) => !dropSet.has(id)) });
        await bumpTagUsage(ctx, drop, -1);
        removed += drop.length;
      }
      await ctx.db.patch(row._id, { addedTagIds: row.addedTagIds.filter((id) => !dropSet.has(id)) });
    }
    return { removed, nextCursor: page.isDone ? null : page.continueCursor, done: page.isDone };
  },
});

/** Part of the asset delete cascade. */
export const deleteClassificationForAsset = async (ctx: MutationCtx, assetId: Id<"assets">) => {
  const row = await rowOf(ctx, assetId);
  if (row) await ctx.db.delete(row._id);
};
