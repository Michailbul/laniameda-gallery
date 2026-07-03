// One-off cleanup: delete every asset whose modelName is "Sauce" (case-insensitive),
// which was showing up as an unwanted model filter chip in the sidebar. Reuses
// the existing internalDeleteAsset mutation so storage/R2/tags/lineage/semantic
// index cleanup all stay consistent with the normal delete path.
//
// Run once via:
//   CONVEX_DEPLOYMENT=dev:perfect-buffalo-375 bunx convex run removeSauceAssets:deleteSauceModelAssets '{}'
import { v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { Id } from "./_generated/dataModel";

const internalDeleteAssetMutation = makeFunctionReference<"mutation">(
  "assets:internalDeleteAsset",
);

const listSauceModelAssetIdsQuery = makeFunctionReference<"query">(
  "removeSauceAssets:listSauceModelAssetIds",
);

export const listSauceModelAssetIds = internalQuery({
  args: {},
  returns: v.array(v.id("assets")),
  handler: async (ctx) => {
    const assets = await ctx.db.query("assets").collect();
    return assets
      .filter((asset) => asset.modelName?.trim().toLowerCase() === "sauce")
      .map((asset) => asset._id);
  },
});

export const deleteSauceModelAssets = action({
  args: {},
  returns: v.object({
    deletedCount: v.number(),
    deletedIds: v.array(v.id("assets")),
  }),
  handler: async (ctx) => {
    const ids: Id<"assets">[] = await ctx.runQuery(listSauceModelAssetIdsQuery, {});
    for (const id of ids) {
      await ctx.runMutation(internalDeleteAssetMutation, { id });
    }
    return { deletedCount: ids.length, deletedIds: ids };
  },
});
