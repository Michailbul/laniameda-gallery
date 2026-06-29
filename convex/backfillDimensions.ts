/**
 * Backfill intrinsic width/height for image assets that were ingested without
 * them — chiefly Midjourney WebP, which Jimp can't decode, so dims were never
 * stored and the gallery masonry renders those cards as 1:1 squares.
 *
 * Run from the CLI (re-run with the returned cursor until `isDone`):
 *   bunx convex run backfillDimensions:backfillImageDimensions '{}'
 *   bunx convex run backfillDimensions:backfillImageDimensions '{"cursor":"<continueCursor>"}'
 */
import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { resolveAssetUrl } from "./r2_url";
import { readImageDimensions } from "./imageDimensions";

const needsDimensions = (asset: {
  kind: "image" | "video";
  width?: number;
  height?: number;
}) =>
  asset.kind === "image" &&
  (typeof asset.width !== "number" ||
    typeof asset.height !== "number" ||
    asset.width <= 0 ||
    asset.height <= 0);

export const listAssetsMissingDimensions = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    batchSize: v.number(),
  },
  returns: v.object({
    items: v.array(
      v.object({
        assetId: v.id("assets"),
        url: v.optional(v.string()),
      }),
    ),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("assets")
      .withIndex("by_createdAt")
      .order("desc")
      .paginate({ cursor: args.cursor, numItems: args.batchSize });

    const items = await Promise.all(
      page.page
        .filter((asset) => needsDimensions(asset))
        .map(async (asset) => ({
          assetId: asset._id,
          url: await resolveAssetUrl(ctx, asset),
        })),
    );

    return {
      items,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const setAssetDimensions = internalMutation({
  args: {
    assetId: v.id("assets"),
    width: v.number(),
    height: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.assetId, {
      width: args.width,
      height: args.height,
    });
    return null;
  },
});

export const backfillImageDimensions = action({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  returns: v.object({
    scanned: v.number(),
    updated: v.number(),
    failed: v.number(),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const batchSize = Math.min(Math.max(args.batchSize ?? 50, 1), 200);
    // Bound work per invocation so a single run stays well inside action limits;
    // re-run with the returned cursor to continue.
    const maxBatches = Math.min(Math.max(args.maxBatches ?? 10, 1), 40);

    let cursor: string | null = args.cursor ?? null;
    let scanned = 0;
    let updated = 0;
    let failed = 0;
    let isDone = false;

    for (let batch = 0; batch < maxBatches; batch += 1) {
      const page: {
        items: Array<{ assetId: import("./_generated/dataModel").Id<"assets">; url?: string }>;
        continueCursor: string;
        isDone: boolean;
      } = await ctx.runQuery(
        internal.backfillDimensions.listAssetsMissingDimensions,
        { cursor, batchSize },
      );

      for (const item of page.items) {
        scanned += 1;
        if (!item.url) {
          failed += 1;
          continue;
        }
        try {
          const res = await fetch(item.url);
          if (!res.ok) throw new Error(`fetch ${res.status}`);
          const bytes = new Uint8Array(await res.arrayBuffer());
          const dims = readImageDimensions(bytes);
          if (!dims) {
            failed += 1;
            continue;
          }
          await ctx.runMutation(
            internal.backfillDimensions.setAssetDimensions,
            { assetId: item.assetId, width: dims.width, height: dims.height },
          );
          updated += 1;
        } catch {
          failed += 1;
        }
      }

      cursor = page.continueCursor;
      isDone = page.isDone;
      if (isDone) break;
    }

    return {
      scanned,
      updated,
      failed,
      isDone,
      continueCursor: isDone ? null : cursor,
    };
  },
});
