import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { r2 } from "./r2";
import { resolveAssetUrl } from "./r2_url";
import { HERO_RENDITION_WIDTH } from "../lib/topaz";

// The data side of a hero frame's high-resolution rendition (the upscale
// itself runs in convex/heroRendition.ts or scripts/upscale-hero.ts).
// Operator functions only: `convex run` with deploy access, or the action.

const variantValidator = v.object({ r2Key: v.string(), width: v.number(), height: v.number() });

/** What to upscale: the original still, or null when there is nothing to do. */
export const heroSource = internalQuery({
  args: { assetId: v.id("assets"), force: v.optional(v.boolean()) },
  returns: v.union(
    v.null(),
    v.object({
      url: v.string(),
      fileName: v.string(),
      width: v.number(),
      height: v.number(),
      reason: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { assetId, force }) => {
    const asset = await ctx.db.get(assetId);
    if (!asset || asset.kind !== "image") return null;
    if (asset.heroRendition && !force) return null;
    if ((asset.width ?? 0) >= HERO_RENDITION_WIDTH && !force) return null;
    const url = await resolveAssetUrl(ctx, asset);
    if (!url) return null;
    return {
      url,
      fileName: asset.fileName ?? `${assetId}.png`,
      width: asset.width ?? 0,
      height: asset.height ?? 0,
    };
  },
});

/** Hero-insert stills of a world (by slug) that still lack a rendition. */
export const heroStillsOfWorld = internalQuery({
  args: { slug: v.string() },
  returns: v.array(v.id("assets")),
  handler: async (ctx, { slug }) => {
    const root = await ctx.db
      .query("folders")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!root) throw new ConvexError(`No world at /w/${slug}.`);
    const out: Id<"assets">[] = [];
    for (const insert of root.worldPage?.heroInserts ?? []) {
      for (const assetId of insert.assetIds) {
        const asset = await ctx.db.get(assetId);
        if (asset?.kind === "image" && !asset.heroRendition) out.push(assetId);
      }
    }
    return out;
  },
});

/** Signed R2 upload URLs for the script's renditions. */
export const prepareUploads = internalMutation({
  args: { count: v.number() },
  returns: v.array(v.object({ key: v.string(), url: v.string() })),
  handler: async (_ctx, { count }) => {
    const out: Array<{ key: string; url: string }> = [];
    for (let i = 0; i < Math.min(Math.max(count, 1), 4); i++) {
      out.push(await r2.generateUploadUrl());
    }
    return out;
  },
});

/** Record the renditions on the asset (replaces an older set; idempotent). */
export const recordHeroRendition = internalMutation({
  args: {
    assetId: v.id("assets"),
    variants: v.array(variantValidator),
    model: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { assetId, variants, model }) => {
    const asset = await ctx.db.get(assetId);
    if (!asset) throw new ConvexError("Frame not found.");
    await ctx.db.patch(assetId, {
      heroRendition: {
        variants: [...variants].sort((a, b) => a.width - b.width),
        model,
        createdAt: Date.now(),
      },
    });
    return null;
  },
});
