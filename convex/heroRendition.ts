"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { storeBlobToR2 } from "./r2_store";
import {
  HERO_RENDITION_STEP_WIDTH,
  TOPAZ_HERO_MODEL,
  topazEnhance,
} from "../lib/topaz";

// A hero frame's high-resolution rendition, made when the owner promotes a
// still to hero (worldPage.setHeroInsert schedules this). Runs only when
// TOPAZ_API_KEY is set on the deployment; otherwise it does nothing and an
// agent runs scripts/upscale-hero.ts with a local key.

export const upscale = internalAction({
  args: { assetId: v.id("assets"), force: v.optional(v.boolean()) },
  returns: v.union(v.literal("no-key"), v.literal("skipped"), v.literal("done")),
  handler: async (ctx, { assetId, force }) => {
    const apiKey = process.env.TOPAZ_API_KEY?.trim();
    if (!apiKey) return "no-key" as const;
    const source = await ctx.runQuery(internal.heroRenditionData.heroSource, { assetId, force });
    if (!source) return "skipped" as const;
    const original = await fetch(source.url);
    if (!original.ok) throw new Error(`Could not read the original (${original.status}).`);
    const big = await topazEnhance({ apiKey, image: await original.blob(), fileName: source.fileName });
    const sharp = (await import("sharp")).default;
    const bigBuffer = Buffer.from(await big.arrayBuffer());
    const bigMeta = await sharp(bigBuffer).metadata();
    const step = await sharp(bigBuffer)
      .resize({ width: HERO_RENDITION_STEP_WIDTH })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    const [bigKey, stepKey] = await Promise.all([
      storeBlobToR2(ctx, new Blob([bigBuffer], { type: "image/jpeg" }), { type: "image/jpeg" }),
      storeBlobToR2(ctx, new Blob([step.data], { type: "image/jpeg" }), { type: "image/jpeg" }),
    ]);
    await ctx.runMutation(internal.heroRenditionData.recordHeroRendition, {
      assetId,
      model: `topaz ${TOPAZ_HERO_MODEL}`,
      variants: [
        { r2Key: stepKey, width: step.info.width, height: step.info.height },
        { r2Key: bigKey, width: bigMeta.width ?? 0, height: bigMeta.height ?? 0 },
      ],
    });
    return "done" as const;
  },
});
