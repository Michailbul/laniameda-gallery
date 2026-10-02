import {
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

const getSemanticDocumentsByIdsQueryRef = makeFunctionReference<"query">(
  "semanticIndex:getSemanticDocumentsByIds",
);
const getSemanticDocumentForAssetQueryRef = makeFunctionReference<"query">(
  "semanticIndex:getSemanticDocumentForAsset",
);
const listScoredGalleryAssetsByIdsQueryRef = makeFunctionReference<"query">(
  "galleryAssetResults:listScoredGalleryAssetsByIds",
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

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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

const getQueryEmbedding = async (
  ctx: ActionCtx,
  query: string,
  target: QueryModel = pixelQueryModel(),
) => {
  const model = target.model;
  const dimensions = getSemanticEmbeddingDimensions();
  // The pixel model keeps its original key so the existing cache stays warm.
  const queryHash = await sha256Hex(
    target.taskType
      ? `${model}:${target.taskType}:${dimensions}:${normalizeQueryForCache(query)}`
      : `${model}:${dimensions}:${normalizeQueryForCache(query)}`,
  );

  const cached = await ctx.runQuery(
    internal.semanticSearch.getCachedQueryEmbedding,
    { queryHash },
  );
  if (cached) {
    return cached;
  }

  const embedding = await embedQuery(query, target);
  await ctx.runMutation(internal.semanticSearch.cacheQueryEmbedding, {
    queryHash,
    embeddingModel: model,
    embeddingDimensions: dimensions,
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
    if (filters.modelName && asset.modelName !== filters.modelName) return false;
    if (filters.assetRole && asset.assetRole !== filters.assetRole) return false;
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

const applyRelativeCutoff = (hits: LaneHit[], cutoff: number) => {
  if (hits.length === 0 || cutoff <= 0) return hits;
  // Small tolerance so a score exactly at the line isn't lost to float error.
  const minScore = hits[0]!.score * cutoff - 1e-9;
  return hits.filter((hit) => hit.score >= minScore);
};

type ScopeSpec = {
  scope: "mine" | "public";
  ownerCandidates: string[];
  pillar?: string;
};

const runLane = async (
  ctx: ActionCtx,
  index: "by_embedding" | "by_text_embedding",
  vector: number[],
  take: number,
  spec: ScopeSpec,
  excludeAssetId?: Id<"assets">,
): Promise<LaneHit[]> => {
  const vectorResults = await ctx.vectorSearch("semanticDocuments", index, {
    vector,
    limit: take,
    filter: (q) => {
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
    },
  });
  if (vectorResults.length === 0) {
    return [];
  }

  const semanticDocs = (await ctx.runQuery(getSemanticDocumentsByIdsQueryRef, {
    ids: vectorResults.map((result) => result._id),
  })) as Array<{
    _id: Id<"semanticDocuments">;
    assetId?: Id<"assets">;
    modality: "multimodal_image" | "text_only";
  }>;
  // The pixel lane is for pixels. An imageless asset (a video) stores a short
  // text there, and query-text against that text outscores every real
  // cross-modal match, so it would crowd the images out of the lane. Those
  // assets are found by their words in the text lane instead.
  const docById = new Map(
    semanticDocs
      .filter((doc) => index !== "by_embedding" || doc.modality === "multimodal_image")
      .map((doc) => [doc._id, doc] as const),
  );

  return dedupeScoredAssets(
    vectorResults.flatMap((result) => {
      const doc = docById.get(result._id);
      if (!doc?.assetId || doc.assetId === excludeAssetId) {
        return [];
      }
      return [
        {
          assetId: doc.assetId,
          score: result._score,
          ...(doc.modality === "text_only" ? { textOnly: true } : {}),
        },
      ];
    }),
  );
};

// Hydrate fused hits in order, chunk by chunk, keeping only those that pass
// the filters, until `limit` survive or the candidates run out.
type ScoredAsset = Infer<typeof scoredGalleryAssetResultValidator>;

const hydrateFiltered = async (
  ctx: ActionCtx,
  fused: FusedHit[],
  keep: (asset: FilterableAsset) => boolean,
  limit: number,
): Promise<ScoredAsset[]> => {
  const results: ScoredAsset[] = [];
  for (let start = 0; start < fused.length && results.length < limit; start += HYDRATE_CHUNK) {
    const chunk = fused.slice(start, start + HYDRATE_CHUNK);
    const hydrated = (await ctx.runQuery(listScoredGalleryAssetsByIdsQueryRef, {
      items: chunk,
    })) as ScoredAsset[];
    for (const asset of hydrated) {
      if (keep(asset)) {
        results.push(asset);
        if (results.length >= limit) break;
      }
    }
  }
  return results;
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
    const limit = Math.min(Math.max(args.limit ?? getDefaultLimit(), 1), 100);
    const filters: AssetFilters = args;
    const filtered = hasMetadataFilters(filters);
    const cutoffFor = (lane: LaneName) =>
      args.minRelativeScore ?? (filtered ? 0 : RELATIVE_SCORE_CUTOFF[lane]);
    const take = filtered ? 256 : Math.min(limit * 6, 256);
    const mode: SearchMode = args.mode ?? "hybrid";
    const spec: ScopeSpec = { scope: args.scope, ownerCandidates, pillar: args.pillar };

    // Each lane embeds the query with its own model. In hybrid mode a
    // rate-limited pixel model degrades the search to the text lane rather
    // than failing it.
    const [visual, text] = await Promise.all([
      mode === "text"
        ? undefined
        : getQueryEmbedding(ctx, query, pixelQueryModel())
            .then((vector) => runLane(ctx, "by_embedding", vector, take, spec))
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
        : getQueryEmbedding(ctx, query, textQueryModel()).then((vector) =>
            runLane(ctx, "by_text_embedding", vector, take, spec),
          ),
    ]);

    const fused = fuseLanes({
      ...(visual ? { visual: applyRelativeCutoff(visual, cutoffFor("visual")) } : {}),
      ...(text ? { text: applyRelativeCutoff(text, cutoffFor("text")) } : {}),
    });
    if (fused.length === 0) {
      return [];
    }

    return await hydrateFiltered(
      ctx,
      fused,
      buildAssetFilter(filters, args.scope),
      limit,
    );
  },
});

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

    const sourceDoc = await ctx.runQuery(getSemanticDocumentForAssetQueryRef, {
      assetId: args.assetId,
    });
    if (!sourceDoc) {
      return [];
    }

    const limit = Math.min(Math.max(args.limit ?? 12, 1), 100);
    const ownerCandidates =
      args.scope === "mine"
        ? resolveUserIdCandidates(args.ownerUserId?.trim() ?? "")
        : [];

    if (args.scope === "mine" && !ownerCandidates.includes(sourceDoc.ownerUserId)) {
      return [];
    }
    if (args.scope === "public" && !sourceDoc.isPublic) {
      return [];
    }

    const filters: AssetFilters = args;
    const filtered = hasMetadataFilters(filters);
    const cutoffFor = (lane: LaneName) =>
      args.minRelativeScore ?? (filtered ? 0 : RELATIVE_SCORE_CUTOFF[lane]);
    const take = filtered ? 256 : Math.min(limit * 6, 256);
    const mode: SearchMode = args.mode ?? "visual";
    const spec: ScopeSpec = {
      scope: args.scope,
      ownerCandidates,
      pillar: sourceDoc.pillar,
    };
    const textVector = sourceDoc.textEmbedding;
    // A video's pixel-lane vector is an embedding of its prompt, not of pixels.
    const pixelVector =
      sourceDoc.modality === "multimodal_image" ? sourceDoc.embedding : undefined;

    const [visual, text] = await Promise.all([
      mode === "text" || !pixelVector
        ? undefined
        : runLane(ctx, "by_embedding", pixelVector, take, spec, args.assetId),
      // Visual mode falls back to the text lane while the pixel lane is pending
      // or the source has no pixels.
      !textVector || (mode === "visual" && pixelVector)
        ? undefined
        : runLane(ctx, "by_text_embedding", textVector, take, spec, args.assetId),
    ]);

    const fused = fuseLanes({
      ...(visual ? { visual: applyRelativeCutoff(visual, cutoffFor("visual")) } : {}),
      ...(text ? { text: applyRelativeCutoff(text, cutoffFor("text")) } : {}),
    });
    if (fused.length === 0) {
      return [];
    }

    const keep = buildAssetFilter(filters, args.scope);
    return await hydrateFiltered(
      ctx,
      fused,
      (asset) => asset._id !== args.assetId && keep(asset),
      limit,
    );
  },
});

const listSkillCardsByIdsQueryRef = makeFunctionReference<"query">(
  "workflows:listSkillCardsByIds",
);
const listWorkflowsQueryRef = makeFunctionReference<"query">(
  "workflows:listWorkflows",
);

// Skills ranked by meaning. Skills are embedded on their words only (title,
// description, tags, models, step labels, markdown body), so this runs the
// text lane alone. Keyword matches the embedding missed follow the ranked
// hits, and with embeddings off the keyword match is the whole answer.
export const searchSkills = ownerAction({
  args: {
    ownerUserId: v.optional(v.string()),
    query: v.string(),
    tagNames: v.optional(v.array(v.string())),
    folderId: v.optional(v.id("folders")),
    minRelativeScore: v.optional(v.number()),
    limit: v.optional(v.number()),
    previewLimit: v.optional(v.number()),
  },
  // Same shape as workflows:listWorkflows cards, plus the text-lane score.
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const query = args.query.trim();
    const ownerCandidates = resolveScope("mine", args.ownerUserId);
    const ownerUserId = args.ownerUserId?.trim() || ownerCandidates[0]!;
    const limit = Math.min(Math.max(args.limit ?? 24, 1), 100);
    const previewLimit = args.previewLimit ?? 6;
    if (!query) return [];

    const scored = new Map<string, number>();
    if (isSemanticEmbeddingsEnabled()) {
      const vector = await getQueryEmbedding(ctx, query, textQueryModel());
      const hits = await ctx.vectorSearch("semanticDocuments", "by_text_embedding", {
        vector,
        limit: Math.min(limit * 4, 256),
        filter: (q) =>
          q.or(
            ...ownerCandidates.map((owner) => q.eq("scopeKey", `owner:${owner}:skill`)),
          ),
      });
      const docs = (await ctx.runQuery(getSemanticDocumentsByIdsQueryRef, {
        ids: hits.map((hit) => hit._id),
      })) as Array<{ _id: Id<"semanticDocuments">; sourceId: string; sourceType: string }>;
      const sourceById = new Map(docs.map((doc) => [doc._id, doc]));
      const top = hits[0]?._score ?? 0;
      const cutoff = args.minRelativeScore ?? 0.8;
      for (const hit of hits) {
        const doc = sourceById.get(hit._id);
        if (!doc || doc.sourceType !== "skill") continue;
        if (top > 0 && hit._score < top * cutoff) continue;
        if (!scored.has(doc.sourceId)) scored.set(doc.sourceId, hit._score);
      }
    }

    const ranked = (await ctx.runQuery(listSkillCardsByIdsQueryRef, {
      ownerUserId,
      ids: [...scored.keys()] as Id<"workflows">[],
      tagNames: args.tagNames,
      folderId: args.folderId,
      previewLimit,
    })) as Array<{ _id: string } & Record<string, unknown>>;
    const results: Array<Record<string, unknown>> = ranked.map((card) => ({
      ...card,
      score: scored.get(card._id),
    }));

    if (results.length < limit) {
      const lexical = (await ctx.runQuery(listWorkflowsQueryRef, {
        ownerUserId,
        search: query,
        tagNames: args.tagNames,
        folderId: args.folderId,
        limit,
        previewLimit,
      })) as Array<{ _id: string } & Record<string, unknown>>;
      const seen = new Set(results.map((card) => card._id as string));
      for (const card of lexical) {
        if (results.length >= limit) break;
        if (!seen.has(card._id)) results.push(card);
      }
    }
    return results.slice(0, limit);
  },
});
