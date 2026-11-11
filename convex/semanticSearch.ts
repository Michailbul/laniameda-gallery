import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v, type Infer } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";
import {
  scoredGalleryAssetResultValidator,
} from "./galleryAssetResults";
import { resolveUserIdCandidates } from "./authz";
import { canonicalTagKey } from "./helpers";
import { ANIMATION_TAG_KEY, PIECE_TYPE_KEYS } from "./tagFilters";
import {
  assetRoleValidator,
  optionalPillarValidator,
} from "./validators";
import { ownerAction } from "./actor";
import { skillCardValidator } from "./skills";
import { galleryWordMatcher } from "../lib/gallery-search";
import {
  SEMANTIC_VECTOR_DIMENSIONS,
  convexValueSize,
  semanticStorageMode,
  sha256Hex,
  toStoredVector,
} from "./semanticStorage";

const getSemanticDocumentsByIdsQueryRef = makeFunctionReference<"query">(
  "semanticIndex:getSemanticDocumentsByIds",
);
const getLegacySemanticDocumentsByIdsQueryRef = makeFunctionReference<"query">(
  "semanticIndex:getLegacySemanticDocumentsByIds",
);
const getSemanticDocumentForAssetQueryRef = makeFunctionReference<"query">(
  "semanticIndex:getSemanticDocumentForAsset",
);
const listScoredGalleryAssetsByIdsQueryRef = makeFunctionReference<"query">(
  "galleryAssetResults:listScoredGalleryAssetsByIds",
);
const getSemanticEntriesByVectorIdsQueryRef = makeFunctionReference<"query">(
  "semanticIndex:getSemanticEntriesByVectorIds",
);
const getSemanticVectorsForAssetQueryRef = makeFunctionReference<"query">(
  "semanticIndex:getSemanticVectorsForAsset",
);

const DEFAULT_LIMIT = 24;

const normalizeOptionalString = (value?: string | null) => {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
};

const isSemanticEmbeddingsEnabled = () =>
  process.env.SEMANTIC_EMBEDDINGS_ENABLED?.trim().toLowerCase() === "true";

const getSemanticEmbeddingModel = () =>
  normalizeOptionalString(process.env.SEMANTIC_EMBEDDING_MODEL) ??
  "gemini-embedding-2-preview";

const getSemanticEmbeddingDimensions = () => {
  const raw = normalizeOptionalString(process.env.SEMANTIC_EMBEDDING_DIMENSIONS);
  if (!raw) {
    return 3072;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("SEMANTIC_EMBEDDING_DIMENSIONS must be a positive integer.");
  }

  return parsed;
};

const getGeminiApiKey = () => {
  const key = normalizeOptionalString(process.env.GEMINI_API_KEY);
  if (!key || key.length < 10) {
    throw new Error("GEMINI_API_KEY is missing or invalid for semantic search.");
  }
  return key;
};

const getDefaultLimit = () => {
  const raw = normalizeOptionalString(process.env.SEMANTIC_SEARCH_LIMIT_DEFAULT);
  if (!raw) {
    return DEFAULT_LIMIT;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }

  return parsed;
};

const normalizeQueryForCache = (query: string) =>
  query.trim().toLowerCase().replace(/\s+/g, " ");

// Gemini's RPM quota for the embedding model is small; a burst of searches
// (or a running backfill) trips 429s. Retry short transient failures before
// giving up so a single throttled request doesn't surface to visitors.
const RETRYABLE_EMBED_STATUSES = new Set([429, 500, 503]);
const EMBED_RETRY_DELAYS_MS = [1000, 2500];

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const getTextEmbeddingModel = () =>
  normalizeOptionalString(process.env.TEXT_EMBEDDING_MODEL) ?? "gemini-embedding-001";

type QueryModel = { model: string; taskType?: string };
const pixelQueryModel = (): QueryModel => ({ model: getSemanticEmbeddingModel() });
// gemini-embedding-001 takes a task type; the text lane is indexed as
// RETRIEVAL_DOCUMENT, so queries embed as RETRIEVAL_QUERY.
const textQueryModel = (): QueryModel => ({
  model: getTextEmbeddingModel(),
  taskType: "RETRIEVAL_QUERY",
});

const embedQueryOnce = async (query: string, target: QueryModel) => {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${target.model}:embedContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": getGeminiApiKey(),
      },
      body: JSON.stringify({
        content: {
          parts: [{ text: query }],
        },
        ...(target.taskType ? { taskType: target.taskType } : {}),
        outputDimensionality: getSemanticEmbeddingDimensions(),
      }),
    },
  );

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    const error = new Error(
      `Gemini search embedding request failed (${response.status}): ${bodyText || "unknown error"}`,
    );
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  const payload = (await response.json()) as {
    embedding?: { values?: number[] };
  };
  const values = payload.embedding?.values;
  if (!values || values.length === 0) {
    throw new Error("Gemini search embedding response did not contain values.");
  }
  if (values.length !== getSemanticEmbeddingDimensions()) {
    throw new Error(
      `Gemini search embedding dimension mismatch. Expected ${getSemanticEmbeddingDimensions()}, received ${values.length}.`,
    );
  }

  return values;
};

const embedQuery = async (query: string, target: QueryModel) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await embedQueryOnce(query, target);
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (
        status !== undefined &&
        RETRYABLE_EMBED_STATUSES.has(status) &&
        attempt < EMBED_RETRY_DELAYS_MS.length
      ) {
        await sleep(EMBED_RETRY_DELAYS_MS[attempt]!);
        continue;
      }
      if (status === 429) {
        throw new ConvexError(
          "Search is briefly rate-limited. Try again in a minute.",
        );
      }
      throw error;
    }
  }
};

export const getCachedQueryEmbedding = internalQuery({
  args: { queryHash: v.string() },
  returns: v.union(v.null(), v.array(v.float64())),
  handler: async (ctx, args) => {
    const cached = await ctx.db
      .query("semanticQueryEmbeddings")
      .withIndex("by_queryHash", (q) => q.eq("queryHash", args.queryHash))
      .first();
    return cached?.embedding ?? null;
  },
});

export const cacheQueryEmbedding = internalMutation({
  args: {
    queryHash: v.string(),
    embeddingModel: v.string(),
    embeddingDimensions: v.number(),
    embedding: v.array(v.float64()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("semanticQueryEmbeddings")
      .withIndex("by_queryHash", (q) => q.eq("queryHash", args.queryHash))
      .first();
    if (existing) {
      return null;
    }
    await ctx.db.insert("semanticQueryEmbeddings", {
      queryHash: args.queryHash,
      embeddingModel: args.embeddingModel,
      embeddingDimensions: args.embeddingDimensions,
      embedding: args.embedding,
      createdAt: Date.now(),
    });
    return null;
  },
});

// Reads follow SEMANTIC_STORAGE: only split mode reads the split tables.
type Storage = "legacy" | "split";
const readStorage = (): Storage => (semanticStorageMode() === "split" ? "split" : "legacy");

// Row counts for one search, so the eval can turn them into bytes read.
type SearchTrace = {
  rounds: number;
  queryEmbeddingReads: number;
  providerCalls: number;
  vectorSearches: number;
  vectorHits: number;
  resolvedHits: number;
  legacyDocumentReads: number;
  vectorRowReads: number;
  hydratedAssets: number;
  hydrationCalls: number;
};

const newTrace = (): SearchTrace => ({
  rounds: 0, queryEmbeddingReads: 0, providerCalls: 0, vectorSearches: 0, vectorHits: 0,
  resolvedHits: 0, legacyDocumentReads: 0, vectorRowReads: 0, hydratedAssets: 0, hydrationCalls: 0,
});

const getQueryEmbedding = async (
  ctx: ActionCtx,
  query: string,
  target: QueryModel = pixelQueryModel(),
  storage: Storage = "legacy",
  trace?: SearchTrace,
): Promise<number[]> => {
  const model = target.model;
  const dimensions = getSemanticEmbeddingDimensions();
  // The pixel model keeps its original key so the existing cache stays warm.
  const queryKey = target.taskType
    ? `${model}:${target.taskType}:${dimensions}:${normalizeQueryForCache(query)}`
    : `${model}:${dimensions}:${normalizeQueryForCache(query)}`;
  const readCache = async (queryHash: string): Promise<number[] | null> => {
    if (trace) trace.queryEmbeddingReads += 1;
    return await ctx.runQuery(internal.semanticSearch.getCachedQueryEmbedding, { queryHash });
  };
  const embed = async () => {
    if (trace) trace.providerCalls += 1;
    return await embedQuery(query, target);
  };
  const legacyHash = await sha256Hex(queryKey);

  if (storage === "legacy") {
    const cached = await readCache(legacyHash);
    if (cached) {
      return cached;
    }
    const embedding = await embed();
    await ctx.runMutation(internal.semanticSearch.cacheQueryEmbedding, {
      queryHash: legacyHash,
      embeddingModel: model,
      embeddingDimensions: dimensions,
      embedding,
    });
    return embedding;
  }

  // Split vectors are the normalized 768-value prefix, and so is their query
  // (~7 KB a cache row instead of ~28 KB). A query already cached for the
  // legacy lanes holds that prefix, so it never costs another provider call.
  const splitHash = await sha256Hex(`${queryKey}:prefix-${SEMANTIC_VECTOR_DIMENSIONS}`);
  const cached = await readCache(splitHash);
  if (cached) {
    return cached;
  }
  const embedding = toStoredVector((await readCache(legacyHash)) ?? (await embed()));
  await ctx.runMutation(internal.semanticSearch.cacheQueryEmbedding, {
    queryHash: splitHash,
    embeddingModel: model,
    embeddingDimensions: SEMANTIC_VECTOR_DIMENSIONS,
    embedding,
  });
  return embedding;
};

// Convex returns at most 256 hits a lane, and every search asks for all of
// them in one pass: the blend needs the whole lane to tell whether the two
// lanes agree (blendLanes), and mapping a hit costs one slim row.
const LANE_TAKE = 256;
const HYDRATE_CHUNK = 60;

type SearchMode = "hybrid" | "visual" | "text";
type LaneName = "visual" | "text";
// textOnly: the asset has no pixels (a video), so it can only ever be found by
// the text lane.
type LaneHit = { assetId: Id<"assets">; score: number; textOnly?: boolean };
type FusedHit = {
  assetId: Id<"assets">;
  score: number;
  visualScore?: number;
  textScore?: number;
};

const searchModeValidator = v.optional(
  v.union(v.literal("hybrid"), v.literal("visual"), v.literal("text")),
);
const pieceTypeValidator = v.optional(
  v.union(
    v.literal("character"),
    v.literal("location"),
    v.literal("scene"),
    v.literal("inspiration"),
  ),
);
const mediumValidator = v.optional(
  v.union(v.literal("animation"), v.literal("live-action")),
);

// Metadata filters shared by search and "more like this". Tag names match
// canonically (case, "-", "_" and punctuation fold), like the gallery UI.
const assetFilterArgs = {
  folderId: v.optional(v.id("folders")),
  // Any of these collections: a world is its root plus every shelf.
  folderIds: v.optional(v.array(v.id("folders"))),
  modelName: v.optional(v.string()),
  assetRole: assetRoleValidator,
  kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
  // Every listed tag must be present.
  tagNames: v.optional(v.array(v.string())),
  // At least one listed tag must be present.
  anyTagNames: v.optional(v.array(v.string())),
  // None of the listed tags may be present.
  excludeTagNames: v.optional(v.array(v.string())),
  // What the piece IS: the four section tags (plural / "still" spellings count).
  pieceType: pieceTypeValidator,
  // "animation" = tagged animation; "live-action" = everything else.
  medium: mediumValidator,
  onlyLiked: v.optional(v.boolean()),
  // Starred = featured on the public reel.
  onlyStarred: v.optional(v.boolean()),
};

type AssetFilters = {
  folderId?: Id<"folders">;
  folderIds?: Id<"folders">[];
  modelName?: string;
  assetRole?: string;
  kind?: "image" | "video";
  tagNames?: string[];
  anyTagNames?: string[];
  excludeTagNames?: string[];
  pieceType?: "character" | "location" | "scene" | "inspiration";
  medium?: "animation" | "live-action";
  onlyLiked?: boolean;
  onlyStarred?: boolean;
};

type FilterableAsset = {
  _id: Id<"assets">;
  folderId?: Id<"folders">;
  folderIds?: Id<"folders">[];
  modelName?: string;
  assetRole?: string;
  kind: "image" | "video";
  tagNames: string[];
  isLiked?: boolean;
  starredAt?: number;
  agentDescription?: string;
  description?: string;
  promptText?: string;
};

// "no cars": a piece is out when what it is said to show names the thing.
// The description and tags say what is in the picture. A prompt may say
// "empty street, no cars", so it is read only when there is no description.
const MAX_EXCLUDED_PHRASES = 6;
const normalizeExcluded = (phrases?: string[]) => {
  const cleaned = [...new Set((phrases ?? []).map((phrase) => phrase.trim().toLowerCase()).filter(Boolean))];
  if (cleaned.length > MAX_EXCLUDED_PHRASES) {
    throw new ConvexError(`A search takes at most ${MAX_EXCLUDED_PHRASES} things to leave out.`);
  }
  return cleaned;
};

export const buildExcludedWordsFilter = (phrases: string[]) => {
  const matchers = phrases.map((phrase) => galleryWordMatcher(phrase));
  if (matchers.length === 0) return () => true;
  return (asset: FilterableAsset) => {
    const said = asset.agentDescription ?? asset.description ?? asset.promptText ?? "";
    const text = `${said}\n${asset.tagNames.join("\n")}`;
    return !matchers.some((matches) => matches(text));
  };
};

const toKeys = (names?: string[]) =>
  (names ?? []).map((name) => canonicalTagKey(name)).filter(Boolean);

const hasMetadataFilters = (filters: AssetFilters) =>
  Boolean(
    filters.folderId ||
      filters.folderIds?.length ||
      filters.modelName ||
      filters.assetRole ||
      filters.kind ||
      filters.tagNames?.length ||
      filters.anyTagNames?.length ||
      filters.excludeTagNames?.length ||
      filters.pieceType ||
      filters.medium ||
      filters.onlyLiked ||
      filters.onlyStarred,
  );

export const buildAssetFilter = (filters: AssetFilters, scope: "mine" | "public") => {
  const allKeys = toKeys(filters.tagNames);
  const anyKeys = toKeys(filters.anyTagNames);
  const excludeKeys = toKeys(filters.excludeTagNames);
  const pieceKeys = filters.pieceType ? PIECE_TYPE_KEYS[filters.pieceType] : [];

  return (asset: FilterableAsset) => {
    if (
      scope === "mine" &&
      filters.folderId &&
      !(asset.folderIds ?? [asset.folderId]).includes(filters.folderId)
    ) {
      return false;
    }
    if (
      scope === "mine" &&
      filters.folderIds?.length &&
      !(asset.folderIds ?? [asset.folderId]).some((id) => id !== undefined && filters.folderIds!.includes(id))
    ) {
      return false;
    }
    // Skill examples live inside their Skill; search returns them only when the
    // caller asks for that role, so a Skill never shows up twice.
    const isExample = asset.assetRole === "skill_example" || asset.assetRole === "workflow_asset";
    const wantsExamples = filters.assetRole === "skill_example" || filters.assetRole === "workflow_asset";
    if (isExample && !wantsExamples) return false;
    if (filters.modelName && asset.modelName !== filters.modelName) return false;
    if (filters.assetRole && asset.assetRole !== filters.assetRole && !(["workflow_asset", "skill_example"].includes(filters.assetRole) && ["workflow_asset", "skill_example"].includes(asset.assetRole ?? ""))) return false;
    if (filters.kind && asset.kind !== filters.kind) return false;
    if (filters.onlyLiked && asset.isLiked !== true) return false;
    if (filters.onlyStarred && !asset.starredAt) return false;

    const keys = new Set(asset.tagNames.map((name) => canonicalTagKey(name)));
    if (allKeys.some((key) => !keys.has(key))) return false;
    if (anyKeys.length > 0 && !anyKeys.some((key) => keys.has(key))) return false;
    if (excludeKeys.some((key) => keys.has(key))) return false;
    if (pieceKeys.length > 0 && !pieceKeys.some((key) => keys.has(key))) return false;
    if (filters.medium) {
      const animated = keys.has(ANIMATION_TAG_KEY);
      if (filters.medium === "animation" ? !animated : animated) return false;
    }
    return true;
  };
};

// ── Blending the lanes ──────────────────────────────────────────────────
// A hit's strength is where its score sits between its lane's best and worst
// returned hit (1 to 0), so a match that stands clear of the rest stays on top
// instead of being outvoted by pieces that are mediocre in both lanes, which
// is what ranking by position did.
//
// The text lane leads: nearly every piece has a written description, and it
// knows names ("Dari", "Cassandra") the pixel model has never seen. For such
// a query the pixel lane still returns 256 pictures, all noise. The lanes'
// agreement tells the two cases apart: when the pixel lane's best hits are
// also text hits it found the same thing by look and gets its full weight;
// when almost none are, it is dropped for that query. Measured on 42 live
// queries with 256 hits a lane (11 Nov 2026): name queries agree on 0-2 of 40,
// every query about something visible on 7 or more.
const AGREEMENT_WINDOW = 40;
const AGREEMENT_NONE = 0.05;
const AGREEMENT_FULL = 0.25;
const VISUAL_WEIGHT = 0.75;
// A video has no pixels to match. It is credited part of its text strength in
// the pixel lane, so it neither loses to every picture nor outranks them all.
const IMAGELESS_VISUAL_SHARE = 0.6;

const laneStrengths = (hits: LaneHit[]) => {
  const top = hits[0]?.score ?? 0;
  const span = top - (hits[hits.length - 1]?.score ?? 0);
  return new Map(hits.map((hit) => [hit.assetId, span > 0 ? (hit.score - (top - span)) / span : 1]));
};

// How much the pixel lane counts for this query, 0 to 1. Lanes are sorted
// best first.
export const visualLaneWeight = (visual: LaneHit[], text: LaneHit[]) => {
  const window = visual.slice(0, AGREEMENT_WINDOW);
  if (window.length === 0 || text.length === 0) return 0;
  const inText = new Set(text.map((hit) => hit.assetId));
  const agreement = window.filter((hit) => inText.has(hit.assetId)).length / window.length;
  return Math.min(Math.max((agreement - AGREEMENT_NONE) / (AGREEMENT_FULL - AGREEMENT_NONE), 0), 1);
};

export const blendLanes = (lanes: Partial<Record<LaneName, LaneHit[]>>): FusedHit[] => {
  const visual = lanes.visual;
  const text = lanes.text;
  const single = !visual ? text : !text ? visual : undefined;
  if (single || !visual || !text) {
    const strengths = laneStrengths(single ?? []);
    return (single ?? []).map((hit) => ({
      assetId: hit.assetId,
      score: strengths.get(hit.assetId) ?? 0,
      ...(visual ? { visualScore: hit.score } : { textScore: hit.score }),
    }));
  }

  const weight = VISUAL_WEIGHT * visualLaneWeight(visual, text);
  const visualStrength = laneStrengths(visual);
  const textStrength = laneStrengths(text);
  const visualScore = new Map(visual.map((hit) => [hit.assetId, hit.score]));
  const blended: FusedHit[] = text.map((hit) => {
    const words = textStrength.get(hit.assetId) ?? 0;
    const look = hit.textOnly ? IMAGELESS_VISUAL_SHARE * words : (visualStrength.get(hit.assetId) ?? 0);
    const seen = visualScore.get(hit.assetId);
    return {
      assetId: hit.assetId,
      score: (words + weight * look) / (1 + weight),
      textScore: hit.score,
      ...(seen !== undefined ? { visualScore: seen } : {}),
    };
  });
  if (weight > 0) {
    const inText = new Set(text.map((hit) => hit.assetId));
    for (const hit of visual) {
      if (inText.has(hit.assetId)) continue;
      blended.push({
        assetId: hit.assetId,
        score: (weight * (visualStrength.get(hit.assetId) ?? 0)) / (1 + weight),
        visualScore: hit.score,
      });
    }
  }
  return blended.sort((left, right) => right.score - left.score);
};

const dedupeScoredAssets = (items: LaneHit[]) => {
  const byAssetId = new Map<Id<"assets">, LaneHit>();
  for (const item of items) {
    const existing = byAssetId.get(item.assetId);
    if (existing === undefined || item.score > existing.score) {
      byAssetId.set(item.assetId, item);
    }
  }

  return Array.from(byAssetId.values()).sort((left, right) => right.score - left.score);
};

// Keep hits within `cutoff` of the best one. Hits must be sorted best first.
const cutRelative = <T>(hits: T[], scoreOf: (hit: T) => number, cutoff: number) => {
  if (hits.length === 0 || cutoff <= 0) return hits;
  // Small tolerance so a score exactly at the line isn't lost to float error.
  const minScore = scoreOf(hits[0]!) * cutoff - 1e-9;
  return hits.filter((hit) => scoreOf(hit) >= minScore);
};

type ScopeSpec = {
  scope: "mine" | "public";
  ownerCandidates: string[];
  pillar?: string;
};

// A vector hit from any lane table: semanticDocuments (legacy) or a split
// vector table. IDs are opaque strings here; each storage resolves its own.
type VectorHit = { _id: string; _score: number };
type SemanticHitIdentity = {
  _id: Id<"semanticDocuments">;
  sourceType: string;
  sourceId: string;
  assetId?: Id<"assets">;
  skillId?: Id<"skills">;
  modality: "multimodal_image" | "text_only";
};
type ResolvedHit = {
  assetId?: Id<"assets">;
  skillId?: Id<"skills">;
  modality: "multimodal_image" | "text_only";
};

const resolveSemanticIdentities = async (
  ctx: ActionCtx, hitIds: Id<"semanticDocuments">[], trace?: SearchTrace,
): Promise<SemanticHitIdentity[]> => {
  const ids = [...new Set(hitIds)];
  if (ids.length === 0) return [];
  const compact = await ctx.runQuery(getSemanticDocumentsByIdsQueryRef, {
    ids, metadataOnly: true,
  }) as SemanticHitIdentity[];
  const found = new Set(compact.map((doc) => doc._id));
  const missing = ids.filter((id) => !found.has(id));
  if (trace) {
    trace.resolvedHits += ids.length;
    trace.legacyDocumentReads += missing.length;
  }
  // Compact rows share one read pass. Only migration-period misses read full
  // documents, in <=8-document queries (~8 MiB worst-case, including text).
  // Resolving the union before batching still deduplicates across both lanes.
  const batches: Array<Promise<SemanticHitIdentity[]>> = [];
  for (let start = 0; start < missing.length; start += 8) {
    batches.push(ctx.runQuery(getLegacySemanticDocumentsByIdsQueryRef, {
      ids: missing.slice(start, start + 8),
    }) as Promise<SemanticHitIdentity[]>);
  }
  return [...compact, ...(await Promise.all(batches)).flat()];
};

// Map hit IDs not seen yet to their sources. Legacy storage reads its slim
// identity rows (full documents only for unbackfilled misses); split storage
// reads one entry per hit. Unmappable hits resolve to null.
const resolveHits = async (
  ctx: ActionCtx,
  storage: Storage,
  lanes: Partial<Record<LaneName, VectorHit[]>>,
  resolved: Map<string, ResolvedHit | null>,
  trace?: SearchTrace,
) => {
  const unseen = (hits?: VectorHit[]) =>
    [...new Set((hits ?? []).map((hit) => hit._id))].filter((id) => !resolved.has(id));
  if (storage === "legacy") {
    const ids = [...new Set([...unseen(lanes.visual), ...unseen(lanes.text)])];
    if (ids.length === 0) return;
    const docs = await resolveSemanticIdentities(ctx, ids as Id<"semanticDocuments">[], trace);
    const byId = new Map(docs.map((doc) => [doc._id as string, doc]));
    for (const id of ids) resolved.set(id, byId.get(id) ?? null);
    return;
  }
  const pixelIds = unseen(lanes.visual);
  const textIds = unseen(lanes.text);
  if (pixelIds.length === 0 && textIds.length === 0) return;
  const entries = await ctx.runQuery(getSemanticEntriesByVectorIdsQueryRef, { pixelIds, textIds }) as {
    pixel: Array<ResolvedHit & { vectorId: string }>;
    text: Array<ResolvedHit & { vectorId: string }>;
  };
  if (trace) trace.resolvedHits += pixelIds.length + textIds.length;
  for (const id of [...pixelIds, ...textIds]) resolved.set(id, null);
  for (const { vectorId, ...hit } of [...entries.pixel, ...entries.text]) resolved.set(vectorId, hit);
};

const runLane = async (
  ctx: ActionCtx,
  storage: Storage,
  lane: LaneName,
  vector: number[],
  take: number,
  spec: ScopeSpec,
  trace?: SearchTrace,
): Promise<VectorHit[]> => {
  const filter = (q: {
    eq: (field: "scopeKey" | "scopePillarKey" | "publicScopeKey" | "publicScopePillarKey", value: string) => unknown;
    or: (...filters: unknown[]) => unknown;
  }) => {
    if (spec.scope === "public") {
      const key = spec.pillar ? `public:asset:${spec.pillar}` : "public:asset";
      return q.eq(spec.pillar ? "publicScopePillarKey" : "publicScopeKey", key);
    }

    const field = spec.pillar ? "scopePillarKey" : "scopeKey";
    return q.or(
      ...spec.ownerCandidates.map((ownerCandidate) =>
        q.eq(
          field,
          spec.pillar
            ? `owner:${ownerCandidate}:asset:${spec.pillar}`
            : `owner:${ownerCandidate}:asset`,
        ),
      ),
    );
  };
  if (trace) trace.vectorSearches += 1;
  const options = { vector, limit: take, filter: filter as never };
  const hits = storage === "split"
    ? await ctx.vectorSearch(lane === "visual" ? "semanticPixelVectors" : "semanticTextVectors", "by_embedding", options)
    : await ctx.vectorSearch("semanticDocuments", lane === "visual" ? "by_embedding" : "by_text_embedding", options);
  if (trace) trace.vectorHits += hits.length;
  return hits;
};

type ScoredAsset = Infer<typeof scoredGalleryAssetResultValidator>;

// Hydrate ranked hits in order, chunk by chunk, keeping only those that pass
// the filters, until `limit` survive or the candidates run out. Without
// filters nearly every candidate is kept, so a chunk is what the limit still
// needs; filters reject an unknown share, so they read full chunks.
const hydrateFiltered = async (
  ctx: ActionCtx,
  fused: FusedHit[],
  keep: (asset: FilterableAsset) => boolean,
  limit: number,
  spec: ScopeSpec,
  filtered: boolean,
  trace?: SearchTrace,
): Promise<{ results: ScoredAsset[]; consumed: number }> => {
  const results: ScoredAsset[] = [];
  const cache = new Map<Id<"assets">, ScoredAsset | null>();
  let index = 0;
  while (index < fused.length && results.length < limit) {
    const chunk: FusedHit[] = [];
    const chunkSize = filtered ? HYDRATE_CHUNK : Math.min(HYDRATE_CHUNK, limit - results.length);
    for (let scan = index; scan < fused.length && chunk.length < chunkSize; scan += 1) {
      if (!cache.has(fused[scan]!.assetId)) chunk.push(fused[scan]!);
    }
    if (chunk.length > 0) {
      const hydrated = (await ctx.runQuery(listScoredGalleryAssetsByIdsQueryRef, {
        items: chunk,
      })) as ScoredAsset[];
      if (trace) {
        trace.hydrationCalls += 1;
        trace.hydratedAssets += chunk.length;
      }
      const byId = new Map(hydrated.map((asset) => [asset._id, asset]));
      for (const item of chunk) cache.set(item.assetId, byId.get(item.assetId) ?? null);
    }
    while (index < fused.length && results.length < limit && cache.has(fused[index]!.assetId)) {
      const item = fused[index]!;
      index += 1;
      const asset = cache.get(item.assetId);
      if (!asset) continue;
      // Reindexing is asynchronous. Vector/identity scope is only candidate
      // selection; current asset visibility is the final authority.
      const inScope = spec.scope === "public"
        ? asset.isPublic === true
        : Boolean(asset.ownerUserId && spec.ownerCandidates.includes(asset.ownerUserId));
      if (!inScope || !keep(asset)) continue;
      const { score: _score, visualScore: _visual, textScore: _text, ...fields } = asset;
      results.push({
        ...fields,
        score: item.score,
        ...(item.visualScore !== undefined ? { visualScore: item.visualScore } : {}),
        ...(item.textScore !== undefined ? { textScore: item.textScore } : {}),
      });
    }
  }
  // `consumed` hits were judged; the ones after it have not been read.
  return { results, consumed: index };
};

// The pixel lane is for pixels. An imageless asset (a video) stores a short
// text there in legacy storage, and query-text against that text outscores
// every real cross-modal match, so it would crowd the images out of the
// lane. Those assets are found by their words in the text lane instead.
const eligibleLaneHits = (
  lane: LaneName,
  hits: VectorHit[],
  resolved: Map<string, ResolvedHit | null>,
  excludeAssetId?: Id<"assets">,
) => dedupeScoredAssets(hits.flatMap((hit) => {
  const doc = resolved.get(hit._id);
  if (!doc?.assetId || doc.assetId === excludeAssetId ||
      (lane === "visual" && doc.modality !== "multimodal_image")) return [];
  return [{
    assetId: doc.assetId, score: hit._score,
    ...(doc.modality === "text_only" ? { textOnly: true } : {}),
  }];
}));

type RankInput = {
  vectors: Partial<Record<LaneName, number[]>>;
  spec: ScopeSpec;
  storage: Storage;
  // Keep hits within this fraction of the best blended score (0 = all).
  minRelativeScore?: number;
  // Hybrid search degrades to its text lane if the pixel lane fails.
  optionalVisual?: boolean;
  excludeAssetId?: Id<"assets">;
  excludeHitIds?: Set<string>;
  trace?: SearchTrace;
};

// Every candidate the lanes give, blended best first.
const rankAllCandidates = async (ctx: ActionCtx, input: RankInput): Promise<FusedHit[]> => {
  const lanes = (["visual", "text"] as const).filter((lane) => input.vectors[lane]);
  if (input.trace) input.trace.rounds += 1;
  const raw = await Promise.all(lanes.map((lane) =>
    runLane(ctx, input.storage, lane, input.vectors[lane]!, LANE_TAKE, input.spec, input.trace)
      .catch((error: unknown) => {
        if (lane !== "visual" || !input.optionalVisual) throw error;
        console.warn(`[semanticSearch] pixel lane unavailable, text lane only: ${
          error instanceof Error ? error.message : error
        }`);
        return undefined;
      })));
  const laneHits: Partial<Record<LaneName, VectorHit[]>> = {};
  lanes.forEach((lane, index) => {
    const hits = raw[index]?.filter((hit) => !input.excludeHitIds?.has(hit._id));
    if (hits) laneHits[lane] = hits;
  });
  const resolved = new Map<string, ResolvedHit | null>();
  await resolveHits(ctx, input.storage, laneHits, resolved, input.trace);

  const eligible: Partial<Record<LaneName, LaneHit[]>> = {};
  for (const lane of lanes) {
    const hits = laneHits[lane];
    if (hits) eligible[lane] = eligibleLaneHits(lane, hits, resolved, input.excludeAssetId);
  }
  return cutRelative(blendLanes(eligible), (hit) => hit.score, input.minRelativeScore ?? 0);
};

// The best `limit` candidates that pass scope and filters.
const searchRanked = async (ctx: ActionCtx, input: RankInput & {
  limit: number;
  filtered: boolean;
  keep: (asset: FilterableAsset) => boolean;
}): Promise<ScoredAsset[]> => {
  const ranked = await rankAllCandidates(ctx, input);
  return (await hydrateFiltered(
    ctx, ranked, input.keep, input.limit, input.spec, input.filtered, input.trace,
  )).results;
};

const resolveScope = (
  scope: "mine" | "public",
  ownerUserId: string | undefined,
): ScopeSpec["ownerCandidates"] => {
  const ownerCandidates =
    scope === "mine" ? resolveUserIdCandidates(ownerUserId?.trim() ?? "") : [];
  if (scope === "mine" && ownerCandidates.length === 0) {
    throw new ConvexError("ownerUserId is required for mine scope semantic search.");
  }
  return ownerCandidates;
};

// Each lane embeds the query with its own model. In hybrid mode a
// rate-limited pixel model degrades the search to the text lane rather
// than failing it.
const embedQueryLanes = async (
  ctx: ActionCtx, query: string, mode: SearchMode, storage: Storage, trace?: SearchTrace,
  // Words for the text lane only, such as the name of the world the search is
  // limited to: descriptions and tags carry it, pictures do not.
  textHint?: string,
): Promise<Partial<Record<LaneName, number[]>>> => {
  const [visual, text] = await Promise.all([
    mode === "text"
      ? undefined
      : getQueryEmbedding(ctx, query, pixelQueryModel(), storage, trace)
          .catch((error: unknown) => {
            if (mode === "visual") throw error;
            console.warn(
              `[semanticSearch] pixel lane unavailable, text lane only: ${
                error instanceof Error ? error.message : error
              }`,
            );
            return undefined;
          }),
    mode === "visual"
      ? undefined
      : getQueryEmbedding(ctx, textHint ? `${query}, ${textHint}` : query, textQueryModel(), storage, trace),
  ]);
  return { visual, text };
};

const searchByQuery = async (ctx: ActionCtx, input: {
  query: string;
  mode: SearchMode;
  spec: ScopeSpec;
  limit: number;
  filters: AssetFilters;
  minRelativeScore?: number;
  storage: Storage;
  trace?: SearchTrace;
}): Promise<ScoredAsset[]> => {
  const vectors = await embedQueryLanes(ctx, input.query, input.mode, input.storage, input.trace);
  return await searchRanked(ctx, {
    vectors,
    spec: input.spec,
    storage: input.storage,
    limit: input.limit,
    filtered: hasMetadataFilters(input.filters),
    minRelativeScore: input.minRelativeScore,
    keep: buildAssetFilter(input.filters, input.spec.scope),
    optionalVisual: input.mode === "hybrid",
    trace: input.trace,
  });
};

export const searchAssets = ownerAction({
  args: {
    ownerUserId: v.optional(v.string()),
    scope: v.union(v.literal("mine"), v.literal("public")),
    query: v.string(),
    pillar: optionalPillarValidator,
    // "hybrid" (default) matches pixels AND words; "visual" pixels only;
    // "text" the words only (agent description, description, prompt, tags).
    mode: searchModeValidator,
    ...assetFilterArgs,
    // Keep only hits within this fraction (0–1) of the best blended score.
    // Off by default.
    minRelativeScore: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.array(scoredGalleryAssetResultValidator),
  handler: async (ctx, args) => {
    const query = args.query.trim();
    if (!query || !isSemanticEmbeddingsEnabled()) {
      return [];
    }

    const ownerCandidates = resolveScope(args.scope, args.ownerUserId);
    return await searchByQuery(ctx, {
      query,
      mode: args.mode ?? "hybrid",
      spec: { scope: args.scope, ownerCandidates, pillar: args.pillar },
      limit: Math.min(Math.max(args.limit ?? getDefaultLimit(), 1), 100),
      filters: args,
      minRelativeScore: args.minRelativeScore,
      storage: readStorage(),
    });
  },
});

// The vectors a similarity search starts from, after checking the source
// asset's current owner/visibility. Legacy storage reads the source's whole
// semanticDocuments row (~56 KB); split storage reads only the lane rows the
// mode uses (~7 KB each).
const loadSimilaritySource = async (ctx: ActionCtx, input: {
  assetId: Id<"assets">;
  scope: "mine" | "public";
  ownerCandidates: string[];
  mode: SearchMode;
  storage: Storage;
  trace?: SearchTrace;
}) => {
  if (input.storage === "split") {
    const source = await ctx.runQuery(getSemanticVectorsForAssetQueryRef, {
      assetId: input.assetId, scope: input.scope, ownerCandidates: input.ownerCandidates, mode: input.mode,
    }) as {
      ownerUserId: string; isPublic: boolean; pillar?: string;
      pixelVectorId?: string; pixel?: number[]; textVectorId?: string; text?: number[];
    } | null;
    if (!source) return null;
    if (input.trace) input.trace.vectorRowReads += (source.pixel ? 1 : 0) + (source.text ? 1 : 0);
    return {
      ownerUserId: source.ownerUserId,
      isPublic: source.isPublic,
      pillar: source.pillar,
      vectors: { visual: source.pixel, text: source.text },
      hitIds: new Set([source.pixelVectorId, source.textVectorId].filter((id): id is string => Boolean(id))),
    };
  }
  const sourceDoc = await ctx.runQuery(getSemanticDocumentForAssetQueryRef, {
    assetId: input.assetId, scope: input.scope, ownerCandidates: input.ownerCandidates,
  });
  if (!sourceDoc) return null;
  if (input.trace) input.trace.legacyDocumentReads += 1;
  const textVector = sourceDoc.textEmbedding;
  // A video's pixel-lane vector is an embedding of its prompt, not of pixels.
  const pixelVector =
    sourceDoc.modality === "multimodal_image" ? sourceDoc.embedding : undefined;
  return {
    ownerUserId: sourceDoc.ownerUserId,
    isPublic: sourceDoc.isPublic,
    pillar: sourceDoc.pillar,
    vectors: {
      visual: input.mode === "text" || !pixelVector ? undefined : pixelVector,
      // Visual mode falls back to the text lane while the pixel lane is pending
      // or the source has no pixels.
      text: !textVector || (input.mode === "visual" && pixelVector) ? undefined : textVector,
    },
    hitIds: new Set<string>(sourceDoc._id ? [sourceDoc._id] : []),
  };
};

export const findSimilarAssets = ownerAction({
  args: {
    ownerUserId: v.optional(v.string()),
    scope: v.union(v.literal("mine"), v.literal("public")),
    assetId: v.id("assets"),
    // "visual" (default) = looks alike; "hybrid" also weighs what the pieces
    // are about; "text" = described alike.
    mode: searchModeValidator,
    ...assetFilterArgs,
    minRelativeScore: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.array(scoredGalleryAssetResultValidator),
  handler: async (ctx, args) => {
    if (!isSemanticEmbeddingsEnabled()) {
      return [];
    }

    const ownerCandidates = resolveScope(args.scope, args.ownerUserId);
    const storage = readStorage();
    const source = await loadSimilaritySource(ctx, {
      assetId: args.assetId, scope: args.scope, ownerCandidates,
      mode: args.mode ?? "visual", storage,
    });
    if (!source) {
      return [];
    }
    if (args.scope === "mine" && !ownerCandidates.includes(source.ownerUserId)) {
      return [];
    }
    if (args.scope === "public" && !source.isPublic) {
      return [];
    }

    const filters: AssetFilters = args;
    const keep = buildAssetFilter(filters, args.scope);
    return await searchRanked(ctx, {
      vectors: source.vectors,
      spec: { scope: args.scope, ownerCandidates, pillar: source.pillar },
      storage,
      limit: Math.min(Math.max(args.limit ?? 12, 1), 100),
      filtered: hasMetadataFilters(filters),
      minRelativeScore: args.minRelativeScore,
      keep: (asset) => asset._id !== args.assetId && keep(asset),
      excludeAssetId: args.assetId,
      excludeHitIds: source.hitIds,
    });
  },
});

// ── Paged search for the grid ───────────────────────────────────────────
// searchAssets answers one request with at most 100 pieces. The grid instead
// keeps the whole blended ranking, shows the first page, and reads the next
// page each time the scroll reaches the end, so a search is never cut short.
const rankedHitValidator = v.object({
  assetId: v.id("assets"),
  score: v.number(),
  visualScore: v.optional(v.number()),
  textScore: v.optional(v.number()),
});
const searchPageValidator = v.object({
  results: v.array(scoredGalleryAssetResultValidator),
  // Ranked hits not read yet, best first. Pass them to loadSearchHits.
  remaining: v.array(rankedHitValidator),
});
const SEARCH_PAGE_DEFAULT = 60;
const SEARCH_PAGE_MAX = 120;
// A search may be said in a few ways at once ("interiors / city street").
const MAX_SEARCH_PHRASINGS = 3;
// Two lanes of at most LANE_TAKE hits for each phrasing.
const RANKED_HITS_MAX = MAX_SEARCH_PHRASINGS * 2 * LANE_TAKE;
// A piece this strong for something the search leaves out ("no cars") is
// dropped. On live data at least four in five pieces above it name the thing
// in their description; the rest mostly show it without naming it.
const EXCLUDED_STRENGTH = 0.4;

// One ranking from several: a piece keeps its best score.
const mergeBest = (lists: FusedHit[][]) => {
  if (lists.length === 1) return lists[0]!;
  const best = new Map<Id<"assets">, FusedHit>();
  for (const hit of lists.flat()) {
    const current = best.get(hit.assetId);
    if (!current || hit.score > current.score) best.set(hit.assetId, hit);
  }
  return [...best.values()].sort((left, right) => right.score - left.score);
};
const searchPageSize = (pageSize?: number) =>
  Math.min(Math.max(Math.floor(pageSize ?? SEARCH_PAGE_DEFAULT), 1), SEARCH_PAGE_MAX);

// Read ranked hits in order until a page of them passes scope and filters.
const readSearchPage = async (ctx: ActionCtx, hits: FusedHit[], input: {
  spec: ScopeSpec;
  storage: Storage;
  filtered: boolean;
  keep: (asset: FilterableAsset) => boolean;
  pageSize: number;
}) => {
  const { results, consumed } = await hydrateFiltered(
    ctx, hits, input.keep, input.pageSize, input.spec, input.filtered,
  );
  return { results, remaining: hits.slice(consumed) };
};

// First page of a grid search: by words (`query`) or by look
// (`similarToAssetId`), plus the ranked hits still to read.
export const searchAssetsPage = ownerAction({
  args: {
    ownerUserId: v.optional(v.string()),
    scope: v.union(v.literal("mine"), v.literal("public")),
    query: v.optional(v.string()),
    // Other ways to say what is wanted ("interiors / city street"): a piece
    // that matches any of them is found. At most three phrasings in all.
    alternatives: v.optional(v.array(v.string())),
    // Things to leave out ("no cars"): pieces described or tagged with them,
    // and pieces that clearly show them.
    exclude: v.optional(v.array(v.string())),
    // Words for the text lane only, such as the name of the world the search
    // is limited to.
    textHint: v.optional(v.string()),
    similarToAssetId: v.optional(v.id("assets")),
    pillar: optionalPillarValidator,
    // Defaults: "hybrid" for a query, "visual" for look-alikes.
    mode: searchModeValidator,
    ...assetFilterArgs,
    minRelativeScore: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  returns: searchPageValidator,
  handler: async (ctx, args) => {
    const empty = { results: [], remaining: [] };
    if (!isSemanticEmbeddingsEnabled()) {
      return empty;
    }

    const ownerCandidates = resolveScope(args.scope, args.ownerUserId);
    const storage = readStorage();
    const filters: AssetFilters = args;
    const keep = buildAssetFilter(filters, args.scope);
    const page = {
      storage,
      filtered: hasMetadataFilters(filters),
      pageSize: searchPageSize(args.pageSize),
    };
    const minRelativeScore = args.minRelativeScore;

    const sourceId = args.similarToAssetId;
    if (sourceId) {
      const source = await loadSimilaritySource(ctx, {
        assetId: sourceId, scope: args.scope, ownerCandidates,
        mode: args.mode ?? "visual", storage,
      });
      if (!source ||
          (args.scope === "mine" && !ownerCandidates.includes(source.ownerUserId)) ||
          (args.scope === "public" && !source.isPublic)) {
        return empty;
      }
      const spec: ScopeSpec = { scope: args.scope, ownerCandidates, pillar: source.pillar };
      const ranked = await rankAllCandidates(ctx, {
        vectors: source.vectors, spec, storage, minRelativeScore,
        excludeAssetId: sourceId, excludeHitIds: source.hitIds,
      });
      return await readSearchPage(ctx, ranked, {
        ...page, spec, keep: (asset) => asset._id !== sourceId && keep(asset),
      });
    }

    const phrasings = [...new Set(
      [args.query, ...(args.alternatives ?? [])]
        .map((phrasing) => phrasing?.trim())
        .filter((phrasing): phrasing is string => Boolean(phrasing)),
    )];
    if (phrasings.length === 0) {
      return empty;
    }
    if (phrasings.length > MAX_SEARCH_PHRASINGS) {
      throw new ConvexError(`A search takes at most ${MAX_SEARCH_PHRASINGS} alternatives.`);
    }
    const excluded = normalizeExcluded(args.exclude);
    const textHint = normalizeOptionalString(args.textHint);
    const mode: SearchMode = args.mode ?? "hybrid";
    const spec: ScopeSpec = { scope: args.scope, ownerCandidates, pillar: args.pillar };
    const rank = async (text: string, hint?: string) => await rankAllCandidates(ctx, {
      vectors: await embedQueryLanes(ctx, text, mode, storage, undefined, hint),
      spec, storage, optionalVisual: mode === "hybrid",
    });
    const [wanted, unwanted] = await Promise.all([
      Promise.all(phrasings.map((phrasing) => rank(phrasing, textHint))),
      Promise.all(excluded.map((phrase) => rank(phrase))),
    ]);
    const shown = new Set(unwanted.flatMap((list) =>
      list.filter((hit) => hit.score >= EXCLUDED_STRENGTH).map((hit) => hit.assetId)));
    const ranked = cutRelative(
      mergeBest(wanted).filter((hit) => !shown.has(hit.assetId)),
      (hit) => hit.score,
      minRelativeScore ?? 0,
    );
    const named = buildExcludedWordsFilter(excluded);
    return await readSearchPage(ctx, ranked, {
      ...page,
      spec,
      filtered: page.filtered || excluded.length > 0,
      keep: (asset) => keep(asset) && named(asset),
    });
  },
});

// Next page of a grid search. `hits` come back from the caller, so they are
// only candidates: every piece is checked against the caller's scope and the
// filters again before it is returned.
export const loadSearchHits = ownerAction({
  args: {
    ownerUserId: v.optional(v.string()),
    scope: v.union(v.literal("mine"), v.literal("public")),
    hits: v.array(rankedHitValidator),
    // The look-alike source, so it never lists itself.
    similarToAssetId: v.optional(v.id("assets")),
    // The same things the first page left out.
    exclude: v.optional(v.array(v.string())),
    ...assetFilterArgs,
    pageSize: v.optional(v.number()),
  },
  returns: searchPageValidator,
  handler: async (ctx, args) => {
    if (args.hits.length > RANKED_HITS_MAX) {
      throw new ConvexError("Too many search hits in one request.");
    }
    const ownerCandidates = resolveScope(args.scope, args.ownerUserId);
    const filters: AssetFilters = args;
    const keep = buildAssetFilter(filters, args.scope);
    const excluded = normalizeExcluded(args.exclude);
    const named = buildExcludedWordsFilter(excluded);
    return await readSearchPage(ctx, args.hits, {
      spec: { scope: args.scope, ownerCandidates },
      storage: readStorage(),
      filtered: hasMetadataFilters(filters) || excluded.length > 0,
      keep: (asset) => asset._id !== args.similarToAssetId && keep(asset) && named(asset),
      pageSize: searchPageSize(args.pageSize),
    });
  },
});

const getSkillCardsByIdsQueryRef = makeFunctionReference<"query">(
  "skills:getSkillCardsByIds",
);
const listSkillsQueryRef = makeFunctionReference<"query">(
  "skills:listSkills",
);
const scoredSkillCardValidator = v.object({
  ...skillCardValidator.fields,
  score: v.optional(v.number()),
});

// Skills ranked by meaning. Skills are embedded on their words only (title,
// description, tags, models, step labels, markdown body), so this runs the
// text lane alone. Keyword matches the embedding missed follow the ranked
// hits, and with embeddings off the keyword match is the whole answer.
export const searchSkills = ownerAction({
  args: {
    ownerUserId: v.optional(v.string()),
    query: v.string(),
    tagNames: v.optional(v.array(v.string())),
    excludeTagNames: v.optional(v.array(v.string())),
    folderId: v.optional(v.id("folders")),
    minRelativeScore: v.optional(v.number()),
    limit: v.optional(v.number()),
    previewLimit: v.optional(v.number()),
  },
  // Same shape as skills:listSkills cards, plus the text-lane score.
  returns: v.array(scoredSkillCardValidator),
  handler: async (ctx, args) => {
    const query = args.query.trim();
    const ownerCandidates = resolveScope("mine", args.ownerUserId);
    const ownerUserId = args.ownerUserId?.trim() || ownerCandidates[0]!;
    const limit = Math.min(Math.max(args.limit ?? 24, 1), 100);
    const previewLimit = args.previewLimit ?? 6;
    if (!query) return [];

    const scored = new Map<string, number>();
    if (isSemanticEmbeddingsEnabled()) {
      const storage = readStorage();
      const vector = await getQueryEmbedding(ctx, query, textQueryModel(), storage);
      const options = {
        vector,
        limit: Math.min(limit * 4, 256),
        filter: ((q: { eq: (field: "scopeKey", value: string) => unknown; or: (...filters: unknown[]) => unknown }) =>
          q.or(
            ...ownerCandidates.map((owner) => q.eq("scopeKey", `owner:${owner}:skill`)),
          )) as never,
      };
      const hits: VectorHit[] = storage === "split"
        ? await ctx.vectorSearch("semanticTextVectors", "by_embedding", options)
        : await ctx.vectorSearch("semanticDocuments", "by_text_embedding", options);
      // The cutoff is relative to the best raw hit, so hits below it are
      // dropped before any of them is mapped to its Skill.
      const top = hits[0]?._score ?? 0;
      const cutoff = args.minRelativeScore ?? 0.8;
      const kept = top > 0 ? hits.filter((hit) => hit._score >= top * cutoff) : hits;
      const resolved = new Map<string, ResolvedHit | null>();
      await resolveHits(ctx, storage, { text: kept }, resolved);
      for (const hit of kept) {
        const skillId = resolved.get(hit._id)?.skillId;
        if (skillId && !scored.has(skillId)) scored.set(skillId, hit._score);
      }
    }

    const ranked = (await ctx.runQuery(getSkillCardsByIdsQueryRef, {
      ownerUserId,
      ids: [...scored.keys()] as Id<"skills">[],
      tagNames: args.tagNames,
      excludeTagNames: args.excludeTagNames,
      folderId: args.folderId,
      previewLimit,
    })) as Array<Infer<typeof skillCardValidator>>;
    const results: Array<Infer<typeof scoredSkillCardValidator>> = ranked.map((card) => ({
      ...card,
      score: scored.get(card._id),
    }));

    if (results.length < limit) {
      const lexical = (await ctx.runQuery(listSkillsQueryRef, {
        ownerUserId,
        search: query,
        tagNames: args.tagNames,
        excludeTagNames: args.excludeTagNames,
        folderId: args.folderId,
        limit,
        previewLimit,
      })) as Array<Infer<typeof skillCardValidator>>;
      const seen = new Set(results.map((card) => card._id as string));
      for (const card of lexical) {
        if (results.length >= limit) break;
        if (!seen.has(card._id)) results.push(card);
      }
    }
    return results.slice(0, limit);
  },
});

// What each lane returns for a query before anything is dropped: every raw
// vector hit with its score and what it resolved to. For diagnosing a search
// from a trusted machine (`bunx convex run semanticSearch:inspectLanes`);
// reads slim identity rows only.
export const inspectLanes = internalAction({
  args: { ownerUserId: v.string(), query: v.string() },
  returns: v.record(v.string(), v.array(v.object({
    score: v.number(),
    resolvedAs: v.string(),
    assetId: v.optional(v.id("assets")),
  }))),
  handler: async (ctx, args) => {
    const storage = readStorage();
    const spec: ScopeSpec = { scope: "mine", ownerCandidates: resolveScope("mine", args.ownerUserId) };
    const vectors = await embedQueryLanes(ctx, args.query.trim(), "hybrid", storage);
    const resolved = new Map<string, ResolvedHit | null>();
    const out: Record<string, Array<{ score: number; resolvedAs: string; assetId?: Id<"assets"> }>> = {};
    for (const lane of ["visual", "text"] as const) {
      const vector = vectors[lane];
      if (!vector) continue;
      const hits = await runLane(ctx, storage, lane, vector, LANE_TAKE, spec);
      await resolveHits(ctx, storage, { [lane]: hits }, resolved);
      out[lane] = hits.map((hit) => {
        const doc = resolved.get(hit._id);
        return {
          score: hit._score,
          resolvedAs: !doc ? "unresolved" : doc.assetId ? doc.modality : doc.skillId ? "skill" : "other",
          ...(doc?.assetId ? { assetId: doc.assetId } : {}),
        };
      });
    }
    return out;
  },
});

// `before` and `tuned` were two read patterns on legacy storage until
// 11 Nov 2026, when every search moved to one 256-hit pass a lane. Both names
// still run, as today's search on legacy storage, so the runbook's commands
// and old reports keep working.
const evalStorage: Record<"before" | "tuned" | "split", Storage> = {
  before: "legacy",
  tuned: "legacy",
  split: "split",
};

const searchTraceValidator = v.object({
  rounds: v.number(),
  queryEmbeddingReads: v.number(),
  providerCalls: v.number(),
  vectorSearches: v.number(),
  vectorHits: v.number(),
  resolvedHits: v.number(),
  legacyDocumentReads: v.number(),
  vectorRowReads: v.number(),
  hydratedAssets: v.number(),
  hydrationCalls: v.number(),
});

// Runs the same queries (and "more like this" sources) on each storage
// layout, so a change in reads can be weighed against a change in results:
//   before, tuned - today's search on legacy storage (see evalStorage)
//   split         - today's search on split storage (needs the migration)
// Reads like ordinary searches and may add query-embedding cache rows; it
// changes nothing else. Run it from a trusted machine with
// scripts/semantic-search-eval.ts.
export const evaluateSearchPlans = internalAction({
  args: {
    ownerUserId: v.string(),
    queries: v.array(v.string()),
    similarTo: v.optional(v.array(v.id("assets"))),
    plans: v.array(v.union(v.literal("before"), v.literal("tuned"), v.literal("split"))),
    mode: searchModeValidator,
    limit: v.optional(v.number()),
    ...assetFilterArgs,
  },
  returns: v.array(v.object({
    query: v.string(),
    plan: v.string(),
    results: v.array(v.object({ assetId: v.id("assets"), score: v.number() })),
    trace: searchTraceValidator,
    error: v.optional(v.string()),
  })),
  handler: async (ctx, args) => {
    const { ownerUserId, queries, similarTo, plans, mode, limit: rawLimit, ...filters } = args;
    const ownerCandidates = resolveScope("mine", ownerUserId);
    const limit = Math.min(Math.max(rawLimit ?? getDefaultLimit(), 1), 100);
    const keep = buildAssetFilter(filters, "mine");
    const runs: Array<{ query: string; run: (storage: Storage, trace: SearchTrace) => Promise<ScoredAsset[]> }> = [
      ...queries.map((query) => ({
        query,
        run: (storage: Storage, trace: SearchTrace) => searchByQuery(ctx, {
          query, mode: mode ?? "hybrid", spec: { scope: "mine", ownerCandidates }, limit, filters, storage, trace,
        }),
      })),
      ...(similarTo ?? []).map((assetId) => ({
        query: `similar:${assetId}`,
        run: async (storage: Storage, trace: SearchTrace) => {
          const source = await loadSimilaritySource(ctx, {
            assetId, scope: "mine", ownerCandidates, mode: mode ?? "visual", storage, trace,
          });
          if (!source) return [];
          return await searchRanked(ctx, {
            vectors: source.vectors,
            spec: { scope: "mine", ownerCandidates, pillar: source.pillar },
            storage,
            limit,
            filtered: hasMetadataFilters(filters),
            keep: (asset) => asset._id !== assetId && keep(asset),
            excludeAssetId: assetId,
            excludeHitIds: source.hitIds,
            trace,
          });
        },
      })),
    ];
    const rows = [];
    for (const { query, run } of runs) {
      for (const name of plans) {
        const trace = newTrace();
        try {
          const results = await run(evalStorage[name], trace);
          rows.push({
            query, plan: name, trace,
            results: results.map((result) => ({ assetId: result._id, score: result.score })),
          });
        } catch (error) {
          rows.push({
            query, plan: name, trace, results: [],
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    return rows;
  },
});

// Average Convex sizes (convexValueSize) of the rows a search reads, from the
// newest few of each table. The eval multiplies its row counts by these.
// Hydration is per asset: the asset, its prompt, collection links, tags and
// bookmark, with tags not shared between assets (an upper bound).
export const measureSearchRowSizes = internalQuery({
  args: { sample: v.optional(v.number()) },
  returns: v.object({
    legacyDocument: v.number(),
    identity: v.number(),
    entry: v.number(),
    pixelVector: v.number(),
    textVector: v.number(),
    queryEmbeddingFull: v.number(),
    queryEmbeddingSplit: v.number(),
    hydratedAsset: v.number(),
    sampled: v.record(v.string(), v.number()),
  }),
  handler: async (ctx, args) => {
    const sample = Math.min(Math.max(Math.floor(args.sample ?? 10), 1), 25);
    const average = (rows: unknown[]) =>
      rows.length === 0 ? 0 : Math.round(rows.reduce((sum: number, row) => sum + convexValueSize(row), 0) / rows.length);
    // Legacy and vector rows are the large ones; a handful is enough.
    const few = Math.min(sample, 5);
    const [legacy, identities, entries, pixel, text, queries, assets] = await Promise.all([
      ctx.db.query("semanticDocuments").order("desc").take(few),
      ctx.db.query("semanticDocumentIdentities").order("desc").take(sample),
      ctx.db.query("semanticEntries").order("desc").take(sample),
      ctx.db.query("semanticPixelVectors").order("desc").take(few),
      ctx.db.query("semanticTextVectors").order("desc").take(few),
      ctx.db.query("semanticQueryEmbeddings").order("desc").take(sample),
      ctx.db.query("assets").order("desc").take(sample),
    ]);
    let hydrated = 0;
    for (const asset of assets) {
      const [prompt, links, tags, bookmark] = await Promise.all([
        asset.promptId ? ctx.db.get(asset.promptId) : null,
        ctx.db.query("assetFolders").withIndex("by_asset", (q) => q.eq("assetId", asset._id)).take(50),
        Promise.all(asset.tagIds.map((tagId) => ctx.db.get(tagId))),
        asset.bookmarkId ? ctx.db.get(asset.bookmarkId) : null,
      ]);
      hydrated += convexValueSize(asset) + convexValueSize(prompt ?? undefined) +
        convexValueSize(links) - 2 + convexValueSize(tags.filter(Boolean)) - 2 +
        convexValueSize(bookmark ?? undefined);
    }
    const splitQueries = queries.filter((row) => row.embeddingDimensions === SEMANTIC_VECTOR_DIMENSIONS);
    const fullQueries = queries.filter((row) => row.embeddingDimensions !== SEMANTIC_VECTOR_DIMENSIONS);
    return {
      legacyDocument: average(legacy),
      identity: average(identities),
      entry: average(entries),
      pixelVector: average(pixel),
      textVector: average(text),
      queryEmbeddingFull: average(fullQueries),
      queryEmbeddingSplit: average(splitQueries),
      hydratedAsset: assets.length === 0 ? 0 : Math.round(hydrated / assets.length),
      sampled: {
        legacyDocument: legacy.length, identity: identities.length, entry: entries.length,
        pixelVector: pixel.length, textVector: text.length,
        queryEmbeddingFull: fullQueries.length, queryEmbeddingSplit: splitQueries.length,
        hydratedAsset: assets.length,
      },
    };
  },
});
