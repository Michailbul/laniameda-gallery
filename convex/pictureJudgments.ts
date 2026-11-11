import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

// What the Decisions model answered when a search asked it about a picture
// ("does this show a car?"). One row per picture and thing asked, so the same
// question is paid for once. The action is convex/searchJudge.ts.

const judgmentValidator = v.object({
  assetId: v.id("assets"),
  phrase: v.string(),
  probability: v.number(),
});

export const getJudgments = internalQuery({
  args: { assetIds: v.array(v.id("assets")), phrases: v.array(v.string()) },
  returns: v.array(judgmentValidator),
  handler: async (ctx, args) => {
    const rows = await Promise.all(args.assetIds.flatMap((assetId) =>
      args.phrases.map((phrase) =>
        ctx.db.query("pictureJudgments")
          .withIndex("by_asset_phrase", (q) => q.eq("assetId", assetId).eq("phrase", phrase))
          .first())));
    return rows.flatMap((row) =>
      row ? [{ assetId: row.assetId, phrase: row.phrase, probability: row.probability }] : []);
  },
});

export const saveJudgments = internalMutation({
  args: { model: v.string(), judgments: v.array(judgmentValidator) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const judgment of args.judgments) {
      const existing = await ctx.db.query("pictureJudgments")
        .withIndex("by_asset_phrase", (q) => q.eq("assetId", judgment.assetId).eq("phrase", judgment.phrase))
        .first();
      // Two searches can ask at once; the first answer stands.
      if (!existing) await ctx.db.insert("pictureJudgments", { ...judgment, model: args.model, judgedAt: now });
    }
    return null;
  },
});
