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

// Drop results whose score is below this fraction of its lane's top score.
// e.g. 0.85 means "keep results within 85% of the best match". Applied only
// when no metadata filter narrows the search: with filters, the caller already
// said what they want and the best in-filter matches should come back even
// when they score lower than something the filter excludes.
// Per lane: the pixel lane's cross-modal scores bunch tightly (≈0.3–0.4), so
// it keeps a strict cutoff; text-to-text scores spread wider, so a good match
// can sit well below the top one.
const RELATIVE_SCORE_CUTOFF = { visual: 0.85, text: 0.75 } as const;
// Reciprocal-rank fusion constant. The pixel lane (cross-modal) and the text
// lane (text-to-text) score on different scales, so the lanes are merged by
// rank rather than by raw score.
const RRF_K = 60;
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
};

const toKeys = (names?: string[]) =>
  (names ?? []).map((name) => canonicalTagKey(name)).filter(Boolean);

const hasMetadataFilters = (filters: AssetFilters) =>
  Boolean(
    filters.folderId ||
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

// Reciprocal-rank fusion over the lanes, normalized so a piece ranked first
// in every lane it can appear in scores 1. A text-only piece is judged on the
// text lane alone; it is never marked down for missing the pixel lane.
export const fuseLanes = (lanes: Partial<Record<LaneName, LaneHit[]>>) => {
  const active = (Object.entries(lanes) as Array<[LaneName, LaneHit[] | undefined]>)
    .filter((entry): entry is [LaneName, LaneHit[]] => Array.isArray(entry[1]));
  const visualActive = active.some(([lane]) => lane === "visual");
  const fused = new Map<Id<"assets">, FusedHit & { textOnly?: boolean }>();
  for (const [lane, hits] of active) {
    hits.forEach((hit, index) => {
      const entry = fused.get(hit.assetId) ?? { assetId: hit.assetId, score: 0 };
      entry.score += 1 / (RRF_K + index + 1);
      if (hit.textOnly) entry.textOnly = true;
      if (lane === "visual") entry.visualScore = hit.score;
      else entry.textScore = hit.score;
      fused.set(hit.assetId, entry);
    });
  }
  return Array.from(fused.values())
    .map(({ textOnly, ...entry }) => {
      const eligibleLanes = active.length - (textOnly && visualActive ? 1 : 0);
      return { ...entry, score: entry.score / (eligibleLanes / (RRF_K + 1)) };
    })
    .sort((left, right) => right.score - left.score);
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

const applyRelativeCutoff = (hits: LaneHit[], cutoff: number) =>
  cutRelative(hits, (hit) => hit.score, cutoff);

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

// How a search spends reads. Each lane first asks for `firstTake` hits; when
// that cannot fill `limit` and a lane came back full above its cutoff, the
// lanes are asked again for `widenTake`, and only hits and assets not seen in
// the first pass are read.
type SearchPlan = {
  storage: Storage;
  firstTake: (limit: number, filtered: boolean) => number;
  widenTake?: number;
  // Cut each lane by score before mapping its hits. Safe only where a lane
  // holds nothing but eligible rows: a legacy pixel lane also holds videos'
  // text vectors, whose scores would set the bar.
  cutoffBeforeResolve: boolean;
  hydrateChunk: (remaining: number, filtered: boolean) => number;
};

// Unfiltered results come from the top of both lanes, so twice the request
// covers them; filters reject an unknown share, so they start at the cap and
// may widen to Convex's 256-hit maximum.
const FIRST_TAKE_MIN = 32;
const FIRST_TAKE_MAX = 96;
const WIDEN_TAKE = 256;

const productionPlan = (storage: Storage): SearchPlan => ({
  storage,
  firstTake: (limit, filtered) =>
    filtered ? FIRST_TAKE_MAX : Math.min(Math.max(limit * 2, FIRST_TAKE_MIN), FIRST_TAKE_MAX),
  widenTake: WIDEN_TAKE,
  cutoffBeforeResolve: storage === "split",
  // Without filters nearly every candidate is kept: read what the limit needs.
  hydrateChunk: (remaining, filtered) =>
    filtered ? HYDRATE_CHUNK : Math.min(HYDRATE_CHUNK, remaining + 4),
});

// The read pattern before 18 October 2026, kept for the eval's baseline.
const previousPlan: SearchPlan = {
  storage: "legacy",
  firstTake: (limit, filtered) => (filtered ? 256 : Math.min(limit * 6, 256)),
  cutoffBeforeResolve: false,
  hydrateChunk: () => HYDRATE_CHUNK,
};

type ScoredAsset = Infer<typeof scoredGalleryAssetResultValidator>;

// Hydrate fused hits in order, chunk by chunk, keeping only those that pass
// the filters, until `limit` survive or the candidates run out. Assets read
// by an earlier pass are reused with this pass's scores.
const hydrateFiltered = async (
  ctx: ActionCtx,
  fused: FusedHit[],
  keep: (asset: FilterableAsset) => boolean,
  limit: number,
  spec: ScopeSpec,
  plan: SearchPlan,
  filtered: boolean,
  cache: Map<Id<"assets">, ScoredAsset | null>,
  trace?: SearchTrace,
): Promise<ScoredAsset[]> => {
  const results: ScoredAsset[] = [];
  let index = 0;
  while (index < fused.length && results.length < limit) {
    const chunk: FusedHit[] = [];
    const chunkSize = plan.hydrateChunk(limit - results.length, filtered);
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
  return results;
};

type SearchInput = {
  vectors: Partial<Record<LaneName, number[]>>;
  spec: ScopeSpec;
  limit: number;
  filtered: boolean;
  cutoffFor: (lane: LaneName) => number;
  keep: (asset: FilterableAsset) => boolean;
  // Hybrid search degrades to its text lane if the pixel lane fails.
  optionalVisual?: boolean;
  excludeAssetId?: Id<"assets">;
  excludeHitIds?: Set<string>;
  plan: SearchPlan;
  trace?: SearchTrace;
};

const runAssetSearch = async (ctx: ActionCtx, input: SearchInput): Promise<ScoredAsset[]> => {
  const lanes = (["visual", "text"] as const).filter((lane) => input.vectors[lane]);
  const resolved = new Map<string, ResolvedHit | null>();
  const hydrated = new Map<Id<"assets">, ScoredAsset | null>();
  let take = input.plan.firstTake(input.limit, input.filtered);
  for (;;) {
    if (input.trace) input.trace.rounds += 1;
    const raw = await Promise.all(lanes.map((lane) =>
      runLane(ctx, input.plan.storage, lane, input.vectors[lane]!, take, input.spec, input.trace)
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
      if (!hits) return;
      laneHits[lane] = input.plan.cutoffBeforeResolve
        ? cutRelative(hits, (hit) => hit._score, input.cutoffFor(lane))
        : hits;
    });
    await resolveHits(ctx, input.plan.storage, laneHits, resolved, input.trace);

    // The pixel lane is for pixels. An imageless asset (a video) stores a short
    // text there in legacy storage, and query-text against that text outscores
    // every real cross-modal match, so it would crowd the images out of the
    // lane. Those assets are found by their words in the text lane instead.
    const scored: Partial<Record<LaneName, LaneHit[]>> = {};
    const laneTop: Partial<Record<LaneName, number>> = {};
    for (const lane of lanes) {
      const hits = laneHits[lane];
      if (!hits) continue;
      const eligible = dedupeScoredAssets(hits.flatMap((hit) => {
        const doc = resolved.get(hit._id);
        if (!doc?.assetId || doc.assetId === input.excludeAssetId ||
            (lane === "visual" && doc.modality !== "multimodal_image")) return [];
        return [{
          assetId: doc.assetId, score: hit._score,
          ...(doc.modality === "text_only" ? { textOnly: true } : {}),
        }];
      }));
      laneTop[lane] = eligible[0]?.score;
      scored[lane] = input.plan.cutoffBeforeResolve
        ? eligible
        : applyRelativeCutoff(eligible, input.cutoffFor(lane));
    }

    const fused = fuseLanes(scored);
    const results = fused.length === 0 ? [] : await hydrateFiltered(
      ctx, fused, input.keep, input.limit, input.spec, input.plan, input.filtered, hydrated, input.trace,
    );
    // Deeper hits can only help when a lane returned all it was asked for and
    // its last hit still cleared the cutoff.
    const canWiden = lanes.some((lane, index) => {
      const hits = raw[index];
      if (!hits || hits.length < take) return false;
      const top = laneTop[lane];
      const cutoff = input.cutoffFor(lane);
      return top === undefined || cutoff <= 0 || hits[hits.length - 1]!._score >= top * cutoff - 1e-9;
    });
    if (results.length >= input.limit || !input.plan.widenTake || take >= input.plan.widenTake || !canWiden) {
      return results;
    }
    take = input.plan.widenTake;
  }
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

const cutoffForFilters = (filters: AssetFilters, minRelativeScore?: number) => {
  const filtered = hasMetadataFilters(filters);
  return (lane: LaneName) => minRelativeScore ?? (filtered ? 0 : RELATIVE_SCORE_CUTOFF[lane]);
};

const searchByQuery = async (ctx: ActionCtx, input: {
  query: string;
  mode: SearchMode;
  spec: ScopeSpec;
  limit: number;
  filters: AssetFilters;
  minRelativeScore?: number;
  plan: SearchPlan;
  trace?: SearchTrace;
}): Promise<ScoredAsset[]> => {
  // Each lane embeds the query with its own model. In hybrid mode a
  // rate-limited pixel model degrades the search to the text lane rather
  // than failing it.
  const { storage } = input.plan;
  const [visual, text] = await Promise.all([
    input.mode === "text"
      ? undefined
      : getQueryEmbedding(ctx, input.query, pixelQueryModel(), storage, input.trace)
          .catch((error: unknown) => {
            if (input.mode === "visual") throw error;
            console.warn(
              `[semanticSearch] pixel lane unavailable, text lane only: ${
                error instanceof Error ? error.message : error
              }`,
            );
            return undefined;
          }),
    input.mode === "visual"
      ? undefined
      : getQueryEmbedding(ctx, input.query, textQueryModel(), storage, input.trace),
  ]);
  return await runAssetSearch(ctx, {
    vectors: { visual, text },
    spec: input.spec,
    limit: input.limit,
    filtered: hasMetadataFilters(input.filters),
    cutoffFor: cutoffForFilters(input.filters, input.minRelativeScore),
    keep: buildAssetFilter(input.filters, input.spec.scope),
    optionalVisual: input.mode === "hybrid",
    plan: input.plan,
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
    // Override the relative score cutoff (0–1). Defaults to 0.85 without
    // filters and 0 (off) with filters.
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
      plan: productionPlan(readStorage()),
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
    const plan = productionPlan(readStorage());
    const source = await loadSimilaritySource(ctx, {
      assetId: args.assetId, scope: args.scope, ownerCandidates,
      mode: args.mode ?? "visual", storage: plan.storage,
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
    return await runAssetSearch(ctx, {
      vectors: source.vectors,
      spec: { scope: args.scope, ownerCandidates, pillar: source.pillar },
      limit: Math.min(Math.max(args.limit ?? 12, 1), 100),
      filtered: hasMetadataFilters(filters),
      cutoffFor: cutoffForFilters(filters, args.minRelativeScore),
      keep: (asset) => asset._id !== args.assetId && keep(asset),
      excludeAssetId: args.assetId,
      excludeHitIds: source.hitIds,
      plan,
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

const evalPlans = {
  before: previousPlan,
  tuned: productionPlan("legacy"),
  split: productionPlan("split"),
} as const;

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

// Runs the same queries (and "more like this" sources) through several read
// plans, so a change in reads can be weighed against a change in results:
//   before - the read pattern before 18 October 2026 (legacy storage)
//   tuned  - current lane depths on legacy storage
//   split  - current lane depths on split storage (needs the migration)
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
    const runs: Array<{ query: string; run: (plan: SearchPlan, trace: SearchTrace) => Promise<ScoredAsset[]> }> = [
      ...queries.map((query) => ({
        query,
        run: (plan: SearchPlan, trace: SearchTrace) => searchByQuery(ctx, {
          query, mode: mode ?? "hybrid", spec: { scope: "mine", ownerCandidates }, limit, filters, plan, trace,
        }),
      })),
      ...(similarTo ?? []).map((assetId) => ({
        query: `similar:${assetId}`,
        run: async (plan: SearchPlan, trace: SearchTrace) => {
          const source = await loadSimilaritySource(ctx, {
            assetId, scope: "mine", ownerCandidates, mode: mode ?? "visual", storage: plan.storage, trace,
          });
          if (!source) return [];
          return await runAssetSearch(ctx, {
            vectors: source.vectors,
            spec: { scope: "mine", ownerCandidates, pillar: source.pillar },
            limit,
            filtered: hasMetadataFilters(filters),
            cutoffFor: cutoffForFilters(filters),
            keep: (asset) => asset._id !== assetId && keep(asset),
            excludeAssetId: assetId,
            excludeHitIds: source.hitIds,
            plan,
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
          const results = await run(evalPlans[name], trace);
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
