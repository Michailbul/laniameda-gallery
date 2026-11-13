// Keyword search over every asset, independent of any embedding provider.
// semanticSearch.ts falls back to it when search by meaning cannot embed the
// request (credit ran out, a refused key, rate limits, or embeddings off), so
// a search by words and tags always answers.

import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { buildAssetTextLane } from "./agentDescriptionText";
import { buildBookmarkSearchText } from "./bookmarkHelpers";
import { dedupeIds } from "./helpers";
import { keywordClauses, keywordSearchString, keywordTerms, rankKeywordCandidates } from "../lib/keyword-ranking";

const backfillRef = makeFunctionReference<"mutation">("assetKeywords:backfillAssetKeywords");

// Everything an asset is findable by in words: its name and file name (job
// IDs such as mj-<job>-<i>), the text lane (agent description, caption,
// prompt, post, tags, model, source domain) and the tags once more, so a
// piece tagged with a word outranks one that only mentions it.
const buildKeywordText = (parts: {
  name?: string;
  fileName?: string;
  tagNames: string[];
  lane: string;
}) => [parts.name, parts.fileName, parts.lane, parts.tagNames.join(", ")]
  .map((part) => part?.trim())
  .filter(Boolean)
  .join("\n");

/** Write, refresh or remove one asset's keyword row. Returns whether it changed. */
export const syncAssetKeywords = async (ctx: MutationCtx, assetId: Id<"assets">) => {
  const [asset, existing] = await Promise.all([
    ctx.db.get(assetId),
    ctx.db.query("assetKeywords").withIndex("by_asset", (q) => q.eq("assetId", assetId)).unique(),
  ]);
  if (!asset?.ownerUserId) {
    if (existing) await ctx.db.delete(existing._id);
    return Boolean(existing);
  }
  const [prompt, design, bookmark, tags] = await Promise.all([
    asset.promptId ? ctx.db.get(asset.promptId) : null,
    asset.designInspirationId ? ctx.db.get(asset.designInspirationId) : null,
    asset.bookmarkId ? ctx.db.get(asset.bookmarkId) : null,
    Promise.all(dedupeIds(asset.tagIds).map((tagId) => ctx.db.get(tagId))),
  ]);
  const tagNames = tags.flatMap((tag) => (tag?.name ? [tag.name] : []));
  const lane = buildAssetTextLane({
    agentDescription: asset.agentDescription,
    description: asset.description,
    promptText: prompt?.text,
    tagNames,
    modelName: asset.modelName,
    designTitle: design?.title,
    designSummary: design?.summary,
    designSourceDomain: design?.sourceDomain,
    bookmarkText: bookmark ? buildBookmarkSearchText(bookmark) : undefined,
    sourceUrl: asset.sourceUrl,
  });
  const row = {
    ownerUserId: asset.ownerUserId,
    assetId,
    isPublic: Boolean(asset.isPublic),
    tagNames,
    text: buildKeywordText({ name: asset.name, fileName: asset.fileName, tagNames, lane }),
  };
  if (
    existing &&
    existing.ownerUserId === row.ownerUserId &&
    existing.isPublic === row.isPublic &&
    existing.text === row.text &&
    existing.tagNames.join("\n") === row.tagNames.join("\n")
  ) {
    return false;
  }
  if (existing) await ctx.db.patch(existing._id, { ...row, updatedAt: Date.now() });
  else await ctx.db.insert("assetKeywords", { ...row, updatedAt: Date.now() });
  return true;
};

export const refreshAssetKeywords = internalMutation({
  args: { assetId: v.id("assets") },
  returns: v.boolean(),
  handler: async (ctx, args) => await syncAssetKeywords(ctx, args.assetId),
});

// Fill or repair every asset's row, oldest first, a batch per transaction.
// Run once after deploying: `bunx convex run assetKeywords:backfillAssetKeywords '{}'`.
// Rows already current are left alone, so it is safe to run again.
export const backfillAssetKeywords = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    seen: v.optional(v.number()),
    written: v.optional(v.number()),
  },
  returns: v.object({ seen: v.number(), written: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const batchSize = Math.min(Math.max(Math.floor(args.batchSize ?? 100), 1), 200);
    const page = await ctx.db.query("assets").paginate({ cursor: args.cursor ?? null, numItems: batchSize });
    let written = args.written ?? 0;
    for (const asset of page.page) {
      if (await syncAssetKeywords(ctx, asset._id)) written += 1;
    }
    const seen = (args.seen ?? 0) + page.page.length;
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, backfillRef, {
        cursor: page.continueCursor, batchSize, seen, written,
      });
    } else {
      console.log(`[assetKeywords] backfill done: ${seen} assets read, ${written} rows written`);
    }
    return { seen, written, done: page.isDone };
  },
});

// Full-text candidates for one owner (or the public reel), at most this many.
// Rows are a few KB; 400 of them stay far below a query's read limit.
const CANDIDATES_PER_OWNER = 400;
// Steps read separately share twice that budget; later steps past this many
// are still scored, they only add no candidates of their own.
const MAX_CLAUSE_READS = 4;

const keywordHitValidator = v.object({ assetId: v.id("assets"), score: v.number() });

/**
 * Pieces whose words or tags hold the request's words, best first (see
 * lib/keyword-ranking.ts). Scope here only picks candidates; the caller still
 * checks each piece's current owner and visibility when it reads it.
 */
export const searchKeywordHits = internalQuery({
  args: {
    query: v.string(),
    scope: v.union(v.literal("mine"), v.literal("public")),
    ownerCandidates: v.array(v.string()),
    take: v.optional(v.number()),
  },
  returns: v.array(keywordHitValidator),
  handler: async (ctx, args) => {
    // One full-text read per step, so a step with many matches cannot crowd
    // another step's pieces out of the candidates.
    const clauses = keywordClauses(args.query);
    const searches = (clauses.length > 1 ? clauses : [keywordTerms(args.query)])
      .map((terms) => keywordSearchString(terms))
      .filter(Boolean)
      .slice(0, MAX_CLAUSE_READS);
    if (searches.length === 0) return [];
    const limit = Math.floor(CANDIDATES_PER_OWNER * 2 / searches.length);
    const take = Math.min(Math.max(Math.floor(args.take ?? limit), 1), Math.min(limit, CANDIDATES_PER_OWNER));
    const lists = (await Promise.all(searches.map((search) => args.scope === "public"
      ? Promise.all([ctx.db.query("assetKeywords")
          .withSearchIndex("search_text", (q) => q.search("text", search).eq("isPublic", true))
          .take(take)])
      : Promise.all([...new Set(args.ownerCandidates)].map((owner) =>
          ctx.db.query("assetKeywords")
            .withSearchIndex("search_text", (q) => q.search("text", search).eq("ownerUserId", owner))
            .take(take)))))).flat();
    const seen = new Set<Id<"assets">>();
    const candidates = lists.flat().flatMap((row) => {
      if (seen.has(row.assetId)) return [];
      seen.add(row.assetId);
      return [{ item: row.assetId, text: row.text, tagNames: row.tagNames }];
    });
    return rankKeywordCandidates(args.query, candidates)
      .map(({ item, score }) => ({ assetId: item, score }));
  },
});
