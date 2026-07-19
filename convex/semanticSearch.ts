import {
  action,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";
import {
  scoredGalleryAssetResultValidator,
} from "./galleryAssetResults";
import { resolveUserIdCandidates } from "./authz";
import {
  assetRoleValidator,
  optionalPillarValidator,
} from "./validators";

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

const embedQueryOnce = async (query: string) => {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${getSemanticEmbeddingModel()}:embedContent`,
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

const embedQuery = async (query: string) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await embedQueryOnce(query);
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

const getQueryEmbedding = async (ctx: ActionCtx, query: string) => {
  const model = getSemanticEmbeddingModel();
  const dimensions = getSemanticEmbeddingDimensions();
  const queryHash = await sha256Hex(
    `${model}:${dimensions}:${normalizeQueryForCache(query)}`,
  );

  const cached = await ctx.runQuery(
    internal.semanticSearch.getCachedQueryEmbedding,
    { queryHash },
  );
  if (cached) {
    return cached;
  }

  const embedding = await embedQuery(query);
  await ctx.runMutation(internal.semanticSearch.cacheQueryEmbedding, {
    queryHash,
    embeddingModel: model,
    embeddingDimensions: dimensions,
    embedding,
  });
  return embedding;
};

// Drop results whose score is below this fraction of the top score.
// e.g. 0.85 means "keep results within 85% of the best match".
const RELATIVE_SCORE_CUTOFF = 0.85;

const dedupeScoredAssets = (items: Array<{ assetId: Id<"assets">; score: number }>) => {
  const byAssetId = new Map<Id<"assets">, number>();
  for (const item of items) {
    const existing = byAssetId.get(item.assetId);
    if (existing === undefined || item.score > existing) {
      byAssetId.set(item.assetId, item.score);
    }
  }

  return Array.from(byAssetId.entries())
    .map(([assetId, score]) => ({ assetId, score }))
    .sort((left, right) => right.score - left.score);
};

export const searchAssets = action({
  args: {
    ownerUserId: v.optional(v.string()),
    scope: v.union(v.literal("mine"), v.literal("public")),
    query: v.string(),
    pillar: optionalPillarValidator,
    folderId: v.optional(v.id("folders")),
    modelName: v.optional(v.string()),
    assetRole: assetRoleValidator,
    kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
    limit: v.optional(v.number()),
  },
  returns: v.array(scoredGalleryAssetResultValidator),
  handler: async (ctx, args) => {
    const query = args.query.trim();
    if (!query || !isSemanticEmbeddingsEnabled()) {
      return [];
    }

    const ownerCandidates =
      args.scope === "mine"
        ? resolveUserIdCandidates(args.ownerUserId?.trim() ?? "")
        : [];
    if (args.scope === "mine" && ownerCandidates.length === 0) {
      throw new ConvexError("ownerUserId is required for mine scope semantic search.");
    }

    const limit = Math.min(Math.max(args.limit ?? getDefaultLimit(), 1), 100);
    const vector = await getQueryEmbedding(ctx, query);
    const vectorResults = await ctx.vectorSearch("semanticDocuments", "by_embedding", {
      vector,
      limit: Math.min(limit * 6, 256),
      filter: (q) => {
        if (args.scope === "public") {
          const key = args.pillar ? `public:asset:${args.pillar}` : "public:asset";
          return q.eq(
            args.pillar ? "publicScopePillarKey" : "publicScopeKey",
            key,
          );
        }

        const field = args.pillar ? "scopePillarKey" : "scopeKey";
        return q.or(
          ...ownerCandidates.map((ownerCandidate) =>
            q.eq(
              field,
              args.pillar
                ? `owner:${ownerCandidate}:asset:${args.pillar}`
                : `owner:${ownerCandidate}:asset`,
            ),
          ),
        );
      },
    });

    if (vectorResults.length === 0) {
      return [];
    }

    const semanticDocs = await ctx.runQuery(getSemanticDocumentsByIdsQueryRef, {
      ids: vectorResults.map((result) => result._id),
    }) as Array<{ _id: Id<"semanticDocuments">; assetId?: Id<"assets"> }>;
    const orderedAssets = dedupeScoredAssets(
      vectorResults.flatMap((result) => {
        const semanticDoc = semanticDocs.find(
          (doc: { _id: Id<"semanticDocuments">; assetId?: Id<"assets"> }) =>
            doc._id === result._id,
        );
        if (!semanticDoc?.assetId) {
          return [];
        }
        return [{ assetId: semanticDoc.assetId, score: result._score }];
      }),
    );
    if (orderedAssets.length === 0) {
      return [];
    }

    // Drop results below the relative score cutoff
    const topScore = orderedAssets[0].score;
    const minScore = topScore * RELATIVE_SCORE_CUTOFF;
    const thresholdedAssets = orderedAssets.filter((a) => a.score >= minScore);

    const hydrated = await ctx.runQuery(listScoredGalleryAssetsByIdsQueryRef, {
      items: thresholdedAssets,
    });

    return hydrated
      .filter((asset: {
        folderId?: Id<"folders">;
        folderIds?: Id<"folders">[];
        modelName?: string;
        assetRole?: string;
        kind: "image" | "video";
      }) => {
        if (
          args.scope === "mine" &&
          args.folderId &&
          !((asset.folderIds ?? [asset.folderId]).includes(args.folderId))
        ) {
          return false;
        }
        if (args.modelName && asset.modelName !== args.modelName) {
          return false;
        }
        if (args.assetRole && asset.assetRole !== args.assetRole) {
          return false;
        }
        if (args.kind && asset.kind !== args.kind) {
          return false;
        }
        return true;
      })
      .slice(0, limit);
  },
});

export const findSimilarAssets = action({
  args: {
    ownerUserId: v.optional(v.string()),
    scope: v.union(v.literal("mine"), v.literal("public")),
    assetId: v.id("assets"),
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

    const vectorResults = await ctx.vectorSearch("semanticDocuments", "by_embedding", {
      vector: sourceDoc.embedding,
      limit: Math.min(limit * 6, 256),
      filter: (q) => {
        if (args.scope === "public") {
          const key = sourceDoc.pillar
            ? `public:asset:${sourceDoc.pillar}`
            : "public:asset";
          return q.eq(
            sourceDoc.pillar ? "publicScopePillarKey" : "publicScopeKey",
            key,
          );
        }

        const field = sourceDoc.pillar ? "scopePillarKey" : "scopeKey";
        return q.or(
          ...ownerCandidates.map((ownerCandidate) =>
            q.eq(
              field,
              sourceDoc.pillar
                ? `owner:${ownerCandidate}:asset:${sourceDoc.pillar}`
                : `owner:${ownerCandidate}:asset`,
            ),
          ),
        );
      },
    });

    const semanticDocs = await ctx.runQuery(getSemanticDocumentsByIdsQueryRef, {
      ids: vectorResults.map((result) => result._id),
    }) as Array<{ _id: Id<"semanticDocuments">; assetId?: Id<"assets"> }>;
    const orderedAssets = dedupeScoredAssets(
      vectorResults.flatMap((result) => {
        const semanticDoc = semanticDocs.find(
          (doc: { _id: Id<"semanticDocuments">; assetId?: Id<"assets"> }) =>
            doc._id === result._id,
        );
        if (!semanticDoc?.assetId || semanticDoc.assetId === args.assetId) {
          return [];
        }
        return [{ assetId: semanticDoc.assetId, score: result._score }];
      }),
    );
    if (orderedAssets.length === 0) {
      return [];
    }

    // Drop results below the relative score cutoff
    const topScore = orderedAssets[0].score;
    const minScore = topScore * RELATIVE_SCORE_CUTOFF;
    const thresholdedAssets = orderedAssets.filter((a) => a.score >= minScore);

    const hydrated = await ctx.runQuery(listScoredGalleryAssetsByIdsQueryRef, {
      items: thresholdedAssets,
    });

    return hydrated
      .filter((asset: { _id: Id<"assets"> }) => asset._id !== args.assetId)
      .slice(0, limit);
  },
});
