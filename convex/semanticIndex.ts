import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
  type QueryCtx,
} from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { dedupeIds } from "./helpers";
import {
  optionalPillarValidator,
  semanticFailureStatusValidator,
  semanticModalityValidator,
  semanticSourceTypeValidator,
} from "./validators";

const RETRY_DELAYS_MS = [30_000, 300_000, 1_800_000] as const;
const MAX_QUERY_BATCH = 50;

const getExistingSemanticDocumentQueryRef = makeFunctionReference<"query">(
  "semanticIndex:getExistingSemanticDocumentForSource",
);
const getAssetSourceQueryRef = makeFunctionReference<"query">(
  "semanticIndex:getAssetSourceForReindex",
);
const getPromptSourceQueryRef = makeFunctionReference<"query">(
  "semanticIndex:getPromptSourceForReindex",
);
const getDesignSourceQueryRef = makeFunctionReference<"query">(
  "semanticIndex:getDesignSourceForReindex",
);
const listBackfillSourceBatchQueryRef = makeFunctionReference<"query">(
  "semanticIndex:listBackfillSourceBatch",
);
const upsertSemanticDocumentMutationRef = makeFunctionReference<"mutation">(
  "semanticIndex:upsertSemanticDocument",
);
const deleteSemanticDocumentMutationRef = makeFunctionReference<"mutation">(
  "semanticIndex:deleteSemanticDocumentForSource",
);
const recordFailureMutationRef = makeFunctionReference<"mutation">(
  "semanticIndex:recordSemanticIndexFailure",
);
const resolveFailureMutationRef = makeFunctionReference<"mutation">(
  "semanticIndex:resolveSemanticIndexFailure",
);
const reindexAssetActionRef = makeFunctionReference<"action">(
  "semanticIndex:reindexAsset",
);
const reindexPromptActionRef = makeFunctionReference<"action">(
  "semanticIndex:reindexPrompt",
);
const reindexDesignInspirationActionRef = makeFunctionReference<"action">(
  "semanticIndex:reindexDesignInspiration",
);

const semanticDocumentValidator = v.object({
  _id: v.id("semanticDocuments"),
  _creationTime: v.number(),
  ownerUserId: v.string(),
  sourceType: semanticSourceTypeValidator,
  sourceId: v.string(),
  assetId: v.optional(v.id("assets")),
  promptId: v.optional(v.id("prompts")),
  designInspirationId: v.optional(v.id("designInspirations")),
  pillar: optionalPillarValidator,
  isPublic: v.boolean(),
  kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
  modality: semanticModalityValidator,
  searchText: v.string(),
  contentHash: v.string(),
  embeddingModel: v.string(),
  embeddingDimensions: v.number(),
  embedding: v.array(v.float64()),
  scopeKey: v.string(),
  scopePillarKey: v.optional(v.string()),
  publicScopeKey: v.optional(v.string()),
  publicScopePillarKey: v.optional(v.string()),
  sourceUpdatedAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const semanticDocumentLookupValidator = v.object({
  _id: v.id("semanticDocuments"),
  _creationTime: v.number(),
  sourceType: semanticSourceTypeValidator,
  sourceId: v.string(),
  assetId: v.optional(v.id("assets")),
  ownerUserId: v.string(),
  pillar: optionalPillarValidator,
  isPublic: v.boolean(),
  kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
});

type ReindexResult = {
  status: "indexed" | "deleted" | "skipped";
  semanticDocumentId?: Id<"semanticDocuments">;
  retryScheduled: boolean;
};

const assetSourceValidator = v.union(
  v.null(),
  v.object({
    assetId: v.id("assets"),
    ownerUserId: v.string(),
    kind: v.union(v.literal("image"), v.literal("video")),
    contentType: v.optional(v.string()),
    fileName: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    storageUrl: v.optional(v.string()),
    storageId: v.optional(v.string()),
    promptText: v.optional(v.string()),
    designTitle: v.optional(v.string()),
    designSummary: v.optional(v.string()),
    designSourceDomain: v.optional(v.string()),
    tagNames: v.array(v.string()),
    pillar: optionalPillarValidator,
    modelName: v.optional(v.string()),
    isPublic: v.boolean(),
    sourceUpdatedAt: v.number(),
  }),
);

const promptSourceValidator = v.union(
  v.null(),
  v.object({
    promptId: v.id("prompts"),
    ownerUserId: v.string(),
    text: v.string(),
    tagNames: v.array(v.string()),
    pillar: optionalPillarValidator,
    promptType: v.optional(v.string()),
    workflowType: v.optional(v.string()),
    modelName: v.optional(v.string()),
    modelProvider: v.optional(v.string()),
    domain: v.optional(v.string()),
    sourceUpdatedAt: v.number(),
  }),
);

const designSourceValidator = v.union(
  v.null(),
  v.object({
    designInspirationId: v.id("designInspirations"),
    ownerUserId: v.string(),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    sourceDomain: v.optional(v.string()),
    tagNames: v.array(v.string()),
    platform: v.optional(v.string()),
    inspirationType: v.string(),
    workflowType: v.optional(v.string()),
    pillar: v.literal("designs"),
    promptText: v.optional(v.string()),
    sourceUpdatedAt: v.number(),
  }),
);

const backfillBatchQueryResultValidator = v.object({
  ids: v.array(v.string()),
  nextCursor: v.optional(v.string()),
  done: v.boolean(),
});

const reindexResultValidator = v.object({
  status: v.union(
    v.literal("indexed"),
    v.literal("deleted"),
    v.literal("skipped"),
  ),
  semanticDocumentId: v.optional(v.id("semanticDocuments")),
  retryScheduled: v.boolean(),
});

const normalizeOptionalString = (value?: string | null) => {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
};

const compactSearchText = (parts: Array<string | undefined>) =>
  parts
    .map((part) => normalizeOptionalString(part))
    .filter((part): part is string => Boolean(part))
    .join("\n");

const parseCursor = (cursor?: string) => {
  if (!cursor) {
    return null;
  }

  const [createdAtRaw, id] = cursor.split("::");
  const createdAt = Number(createdAtRaw);
  if (!Number.isFinite(createdAt) || !id) {
    return null;
  }

  return { createdAt, id };
};

const buildCursor = (createdAt: number, id: string) => `${createdAt}::${id}`;

const compareCursor = (
  left: { createdAt: number; id: string },
  right: { createdAt: number; id: string },
) => {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt - right.createdAt;
  }
  return left.id.localeCompare(right.id);
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
    throw new Error("GEMINI_API_KEY is missing or invalid for semantic indexing.");
  }
  return key;
};

const buildScopeFields = (
  ownerUserId: string,
  sourceType: "asset" | "prompt" | "designInspiration",
  pillar: string | undefined,
  isPublic: boolean,
) => {
  const scopeKey = `owner:${ownerUserId}:${sourceType}`;
  const scopePillarKey = pillar
    ? `owner:${ownerUserId}:${sourceType}:${pillar}`
    : undefined;

  if (sourceType !== "asset" || !isPublic) {
    return {
      scopeKey,
      scopePillarKey,
      publicScopeKey: undefined,
      publicScopePillarKey: undefined,
    };
  }

  return {
    scopeKey,
    scopePillarKey,
    publicScopeKey: "public:asset",
    publicScopePillarKey: pillar ? `public:asset:${pillar}` : undefined,
  };
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

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
};

const fetchInlineImagePart = async (storageUrl: string, contentType?: string) => {
  const response = await fetch(storageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch storage asset for embedding (${response.status}).`);
  }

  const mimeType =
    normalizeOptionalString(response.headers.get("content-type")) ??
    normalizeOptionalString(contentType) ??
    "image/jpeg";
  const data = arrayBufferToBase64(await response.arrayBuffer());

  return {
    inline_data: {
      mime_type: mimeType,
      data,
    },
  };
};

const embedWithGemini = async (parts: Array<Record<string, unknown>>) => {
  const apiKey = getGeminiApiKey();
  const model = getSemanticEmbeddingModel();
  const dimensions = getSemanticEmbeddingDimensions();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        content: { parts },
        outputDimensionality: dimensions,
      }),
    },
  );

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(
      `Gemini embedding request failed (${response.status}): ${bodyText || "unknown error"}`,
    );
  }

  const payload = (await response.json()) as {
    embedding?: { values?: number[] };
  };
  const values = payload.embedding?.values;
  if (!values || values.length === 0) {
    throw new Error("Gemini embedding response did not contain embedding values.");
  }
  if (values.length !== dimensions) {
    throw new Error(
      `Gemini embedding dimension mismatch. Expected ${dimensions}, received ${values.length}.`,
    );
  }

  return {
    model,
    dimensions,
    values,
  };
};

const resolveTagNames = async (ctx: QueryCtx, tagIds: Id<"tags">[]) => {
  const uniqueTagIds = dedupeIds(tagIds);
  const tagEntries = await Promise.all(
    uniqueTagIds.map(async (tagId) => {
      const tag = await ctx.db.get(tagId);
      return tag?.name;
    }),
  );

  return tagEntries.filter((tagName): tagName is string => Boolean(tagName));
};

export const getExistingSemanticDocumentForSource = internalQuery({
  args: {
    sourceType: semanticSourceTypeValidator,
    sourceId: v.string(),
  },
  returns: v.union(v.null(), semanticDocumentValidator),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("semanticDocuments")
      .withIndex("by_source", (q) =>
        q.eq("sourceType", args.sourceType).eq("sourceId", args.sourceId),
      )
      .unique();
  },
});

export const getSemanticDocumentsByIds = internalQuery({
  args: {
    ids: v.array(v.id("semanticDocuments")),
  },
  returns: v.array(semanticDocumentLookupValidator),
  handler: async (ctx, args) => {
    const rows = await Promise.all(args.ids.map(async (id) => await ctx.db.get(id)));
    return rows
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .map((row) => ({
        _id: row._id,
        _creationTime: row._creationTime,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        assetId: row.assetId,
        ownerUserId: row.ownerUserId,
        pillar: row.pillar,
        isPublic: row.isPublic,
        kind: row.kind,
      }));
  },
});

export const getSemanticDocumentForAsset = internalQuery({
  args: {
    assetId: v.id("assets"),
  },
  returns: v.union(v.null(), semanticDocumentValidator),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("semanticDocuments")
      .withIndex("by_asset", (q) => q.eq("assetId", args.assetId))
      .unique();
  },
});

export const getAssetSourceForReindex = internalQuery({
  args: {
    assetId: v.id("assets"),
  },
  returns: assetSourceValidator,
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset?.ownerUserId) {
      return null;
    }

    const [prompt, designInspiration, tagNames, storageUrl] = await Promise.all([
      asset.promptId ? ctx.db.get(asset.promptId) : Promise.resolve(null),
      asset.designInspirationId
        ? ctx.db.get(asset.designInspirationId)
        : Promise.resolve(null),
      resolveTagNames(ctx, asset.tagIds),
      asset.storageId ? ctx.storage.getUrl(asset.storageId) : Promise.resolve(null),
    ]);

    return {
      assetId: asset._id,
      ownerUserId: asset.ownerUserId,
      kind: asset.kind,
      contentType: asset.contentType,
      fileName: asset.fileName,
      sourceUrl: asset.sourceUrl,
      storageUrl: storageUrl ?? undefined,
      storageId: asset.storageId,
      promptText: prompt?.text,
      designTitle: designInspiration?.title,
      designSummary: designInspiration?.summary,
      designSourceDomain: designInspiration?.sourceDomain,
      tagNames,
      pillar: asset.pillar,
      modelName: asset.modelName,
      isPublic: Boolean(asset.isPublic),
      sourceUpdatedAt: asset.curatedAt ?? asset.createdAt,
    };
  },
});

export const getPromptSourceForReindex = internalQuery({
  args: {
    promptId: v.id("prompts"),
  },
  returns: promptSourceValidator,
  handler: async (ctx, args) => {
    const prompt = await ctx.db.get(args.promptId);
    if (!prompt?.ownerUserId) {
      return null;
    }

    return {
      promptId: prompt._id,
      ownerUserId: prompt.ownerUserId,
      text: prompt.text,
      tagNames: await resolveTagNames(ctx, prompt.tagIds),
      pillar: prompt.pillar,
      promptType: prompt.promptType,
      workflowType: prompt.workflowType,
      modelName: prompt.modelName,
      modelProvider: prompt.modelProvider,
      domain: prompt.domain,
      sourceUpdatedAt: prompt.createdAt,
    };
  },
});

export const getDesignSourceForReindex = internalQuery({
  args: {
    designInspirationId: v.id("designInspirations"),
  },
  returns: designSourceValidator,
  handler: async (ctx, args) => {
    const design = await ctx.db.get(args.designInspirationId);
    if (!design?.ownerUserId) {
      return null;
    }

    const prompt = design.promptId ? await ctx.db.get(design.promptId) : null;
    return {
      designInspirationId: design._id,
      ownerUserId: design.ownerUserId,
      title: design.title,
      summary: design.summary,
      sourceUrl: design.sourceUrl,
      sourceDomain: design.sourceDomain,
      tagNames: await resolveTagNames(ctx, design.tagIds),
      platform: design.platform,
      inspirationType: design.inspirationType,
      workflowType: design.workflowType,
      pillar: "designs" as const,
      promptText: prompt?.text,
      sourceUpdatedAt: design.updatedAt,
    };
  },
});

export const listBackfillSourceBatch = internalQuery({
  args: {
    sourceType: semanticSourceTypeValidator,
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  returns: backfillBatchQueryResultValidator,
  handler: async (ctx, args) => {
    const batchSize = Math.min(Math.max(args.batchSize ?? 25, 1), MAX_QUERY_BATCH);
    const cursor = parseCursor(args.cursor);
    const rows =
      args.sourceType === "asset"
        ? await ctx.db
            .query("assets")
            .withIndex("by_createdAt", (q) => q.gte("createdAt", 0))
            .collect()
        : args.sourceType === "prompt"
          ? await ctx.db
              .query("prompts")
              .withIndex("by_createdAt", (q) => q.gte("createdAt", 0))
              .collect()
          : await ctx.db
              .query("designInspirations")
              .withIndex("by_createdAt", (q) => q.gte("createdAt", 0))
              .collect();

    const ordered = [...rows].sort((left, right) =>
      compareCursor(
        { createdAt: Number(left.createdAt ?? 0), id: left._id },
        { createdAt: Number(right.createdAt ?? 0), id: right._id },
      ),
    );

    const startIndex = cursor
      ? ordered.findIndex((row) =>
          compareCursor(
            { createdAt: Number(row.createdAt ?? 0), id: row._id },
            cursor,
          ) > 0,
        )
      : 0;
    const sliceStart = startIndex < 0 ? ordered.length : startIndex;
    const batch = ordered.slice(sliceStart, sliceStart + batchSize);
    const last = batch.at(-1);

    return {
      ids: batch.map((row) => row._id),
      nextCursor: last
        ? buildCursor(Number(last.createdAt ?? 0), last._id)
        : undefined,
      done: sliceStart + batch.length >= ordered.length,
    };
  },
});

export const upsertSemanticDocument = internalMutation({
  args: {
    ownerUserId: v.string(),
    sourceType: semanticSourceTypeValidator,
    sourceId: v.string(),
    assetId: v.optional(v.id("assets")),
    promptId: v.optional(v.id("prompts")),
    designInspirationId: v.optional(v.id("designInspirations")),
    pillar: optionalPillarValidator,
    isPublic: v.boolean(),
    kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
    modality: semanticModalityValidator,
    searchText: v.string(),
    contentHash: v.string(),
    embeddingModel: v.string(),
    embeddingDimensions: v.number(),
    embedding: v.optional(v.array(v.float64())),
    scopeKey: v.string(),
    scopePillarKey: v.optional(v.string()),
    publicScopeKey: v.optional(v.string()),
    publicScopePillarKey: v.optional(v.string()),
    sourceUpdatedAt: v.number(),
  },
  returns: v.id("semanticDocuments"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("semanticDocuments")
      .withIndex("by_source", (q) =>
        q.eq("sourceType", args.sourceType).eq("sourceId", args.sourceId),
      )
      .unique();
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ownerUserId: args.ownerUserId,
        assetId: args.assetId,
        promptId: args.promptId,
        designInspirationId: args.designInspirationId,
        pillar: args.pillar,
        isPublic: args.isPublic,
        kind: args.kind,
        modality: args.modality,
        searchText: args.searchText,
        contentHash: args.contentHash,
        embeddingModel: args.embeddingModel,
        embeddingDimensions: args.embeddingDimensions,
        embedding: args.embedding ?? existing.embedding,
        scopeKey: args.scopeKey,
        scopePillarKey: args.scopePillarKey,
        publicScopeKey: args.publicScopeKey,
        publicScopePillarKey: args.publicScopePillarKey,
        sourceUpdatedAt: args.sourceUpdatedAt,
        updatedAt: now,
      });
      return existing._id;
    }

    if (!args.embedding) {
      throw new ConvexError("New semantic documents require an embedding.");
    }

    return await ctx.db.insert("semanticDocuments", {
      ownerUserId: args.ownerUserId,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      assetId: args.assetId,
      promptId: args.promptId,
      designInspirationId: args.designInspirationId,
      pillar: args.pillar,
      isPublic: args.isPublic,
      kind: args.kind,
      modality: args.modality,
      searchText: args.searchText,
      contentHash: args.contentHash,
      embeddingModel: args.embeddingModel,
      embeddingDimensions: args.embeddingDimensions,
      embedding: args.embedding,
      scopeKey: args.scopeKey,
      scopePillarKey: args.scopePillarKey,
      publicScopeKey: args.publicScopeKey,
      publicScopePillarKey: args.publicScopePillarKey,
      sourceUpdatedAt: args.sourceUpdatedAt,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const deleteSemanticDocumentForSource = internalMutation({
  args: {
    sourceType: semanticSourceTypeValidator,
    sourceId: v.string(),
  },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("semanticDocuments")
      .withIndex("by_source", (q) =>
        q.eq("sourceType", args.sourceType).eq("sourceId", args.sourceId),
      )
      .unique();

    if (!existing) {
      return { deleted: false };
    }

    await ctx.db.delete(existing._id);
    return { deleted: true };
  },
});

export const recordSemanticIndexFailure = internalMutation({
  args: {
    ownerUserId: v.optional(v.string()),
    sourceType: semanticSourceTypeValidator,
    sourceId: v.string(),
    errorMessage: v.string(),
  },
  returns: v.object({
    failureId: v.id("semantic_index_failures"),
    status: semanticFailureStatusValidator,
    attemptCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = normalizeOptionalString(args.ownerUserId);
    const errorMessage = args.errorMessage.trim();
    if (!errorMessage) {
      throw new ConvexError("errorMessage is required.");
    }

    const existing = await ctx.db
      .query("semantic_index_failures")
      .withIndex("by_source", (q) =>
        q.eq("sourceType", args.sourceType).eq("sourceId", args.sourceId),
      )
      .unique();
    const now = Date.now();

    if (existing) {
      const attemptCount = existing.attemptCount + 1;
      await ctx.db.patch(existing._id, {
        ownerUserId,
        status: "pending",
        attemptCount,
        lastErrorMessage: errorMessage,
        lastErrorAt: now,
        resolvedAt: undefined,
        updatedAt: now,
      });
      return {
        failureId: existing._id,
        status: "pending" as const,
        attemptCount,
      };
    }

    const failureId = await ctx.db.insert("semantic_index_failures", {
      ownerUserId,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      status: "pending",
      attemptCount: 1,
      lastErrorMessage: errorMessage,
      firstErrorAt: now,
      lastErrorAt: now,
      updatedAt: now,
    });

    return {
      failureId,
      status: "pending" as const,
      attemptCount: 1,
    };
  },
});

export const resolveSemanticIndexFailure = internalMutation({
  args: {
    sourceType: semanticSourceTypeValidator,
    sourceId: v.string(),
  },
  returns: v.object({
    resolved: v.boolean(),
    failureId: v.optional(v.id("semantic_index_failures")),
  }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("semantic_index_failures")
      .withIndex("by_source", (q) =>
        q.eq("sourceType", args.sourceType).eq("sourceId", args.sourceId),
      )
      .unique();

    if (!existing) {
      return { resolved: false };
    }

    if (existing.status !== "resolved") {
      await ctx.db.patch(existing._id, {
        status: "resolved",
        resolvedAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    return {
      resolved: true,
      failureId: existing._id,
    };
  },
});

const scheduleRetry = async (
  ctx: ActionCtx,
  sourceType: "asset" | "prompt" | "designInspiration",
  sourceId: string,
  attempt: number,
) => {
  if (attempt >= RETRY_DELAYS_MS.length) {
    return false;
  }

  const delay = RETRY_DELAYS_MS[attempt];
  if (sourceType === "asset") {
    await ctx.scheduler.runAfter(delay, reindexAssetActionRef, {
      assetId: sourceId as Id<"assets">,
      attempt: attempt + 1,
    });
    return true;
  }
  if (sourceType === "prompt") {
    await ctx.scheduler.runAfter(delay, reindexPromptActionRef, {
      promptId: sourceId as Id<"prompts">,
      attempt: attempt + 1,
    });
    return true;
  }

  await ctx.scheduler.runAfter(delay, reindexDesignInspirationActionRef, {
    designInspirationId: sourceId as Id<"designInspirations">,
    attempt: attempt + 1,
  });
  return true;
};

const reindexAssetSource = async (
  ctx: ActionCtx,
  assetId: Id<"assets">,
  attempt: number,
): Promise<ReindexResult> => {
  if (!isSemanticEmbeddingsEnabled()) {
    return {
      status: "skipped" as const,
      retryScheduled: false,
    };
  }

  const source = await ctx.runQuery(getAssetSourceQueryRef, { assetId });
  const sourceId = String(assetId);
  if (!source) {
    await ctx.runMutation(deleteSemanticDocumentMutationRef, {
      sourceType: "asset",
      sourceId,
    });
    await ctx.runMutation(resolveFailureMutationRef, {
      sourceType: "asset",
      sourceId,
    });
    return {
      status: "deleted" as const,
      retryScheduled: false,
    };
  }

  try {
    // Pure embedding strategy: image-only for images, prompt-text-only fallback.
    // Let Gemini's cross-modal matching do the work — no metadata dilution.
    const shouldUseMultimodal =
      Boolean(source.storageUrl) &&
      normalizeOptionalString(source.contentType)?.startsWith("image/");
    const modality = shouldUseMultimodal ? "multimodal_image" : "text_only";
    const searchText = shouldUseMultimodal
      ? "[image]"
      : compactSearchText([source.promptText ?? source.fileName ?? `asset`]);
    const scopeFields = buildScopeFields(
      source.ownerUserId,
      "asset",
      source.pillar,
      source.isPublic,
    );
    const contentHash = await sha256Hex(
      JSON.stringify({
        v: "pure-v1", // invalidates all prior embeddings on backfill
        modality,
        searchText,
        storageId: source.storageId,
        isPublic: source.isPublic,
        pillar: source.pillar,
      }),
    );
    const existing = await ctx.runQuery(getExistingSemanticDocumentQueryRef, {
      sourceType: "asset",
      sourceId,
    });
    const model = getSemanticEmbeddingModel();
    const dimensions = getSemanticEmbeddingDimensions();

    const shouldReuseEmbedding =
      existing &&
      existing.contentHash === contentHash &&
      existing.embeddingModel === model &&
      existing.embeddingDimensions === dimensions;

    let embedding = existing?.embedding;
    if (!shouldReuseEmbedding) {
      // Image assets: embed image bytes only (no text). Text fallback: embed searchText.
      const parts: Array<Record<string, unknown>> =
        shouldUseMultimodal && source.storageUrl
          ? [await fetchInlineImagePart(source.storageUrl, source.contentType)]
          : [{ text: searchText }];
      embedding = (await embedWithGemini(parts)).values;
    }

    const semanticDocumentId = await ctx.runMutation(upsertSemanticDocumentMutationRef, {
      ownerUserId: source.ownerUserId,
      sourceType: "asset",
      sourceId,
      assetId,
      promptId: undefined,
      designInspirationId: undefined,
      pillar: source.pillar,
      isPublic: source.isPublic,
      kind: source.kind,
      modality,
      searchText,
      contentHash,
      embeddingModel: model,
      embeddingDimensions: dimensions,
      embedding: shouldReuseEmbedding ? undefined : embedding,
      scopeKey: scopeFields.scopeKey,
      scopePillarKey: scopeFields.scopePillarKey,
      publicScopeKey: scopeFields.publicScopeKey,
      publicScopePillarKey: scopeFields.publicScopePillarKey,
      sourceUpdatedAt: source.sourceUpdatedAt,
    });
    await ctx.runMutation(resolveFailureMutationRef, {
      sourceType: "asset",
      sourceId,
    });

    return {
      status: "indexed" as const,
      semanticDocumentId,
      retryScheduled: false,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown semantic asset index error.";
    await ctx.runMutation(recordFailureMutationRef, {
      ownerUserId: source.ownerUserId,
      sourceType: "asset",
      sourceId,
      errorMessage,
    });

    return {
      status: "skipped" as const,
      retryScheduled: await scheduleRetry(ctx, "asset", sourceId, attempt),
    };
  }
};

const reindexPromptSource = async (
  ctx: ActionCtx,
  promptId: Id<"prompts">,
  attempt: number,
): Promise<ReindexResult> => {
  if (!isSemanticEmbeddingsEnabled()) {
    return {
      status: "skipped" as const,
      retryScheduled: false,
    };
  }

  const source = await ctx.runQuery(getPromptSourceQueryRef, { promptId });
  const sourceId = String(promptId);
  if (!source) {
    await ctx.runMutation(deleteSemanticDocumentMutationRef, {
      sourceType: "prompt",
      sourceId,
    });
    await ctx.runMutation(resolveFailureMutationRef, {
      sourceType: "prompt",
      sourceId,
    });
    return {
      status: "deleted" as const,
      retryScheduled: false,
    };
  }

  try {
    // Pure prompt text only — metadata stays as keyword filters, not in the embedding.
    const searchText = source.text;
    const contentHash = await sha256Hex(
      JSON.stringify({
        v: "pure-v1", // invalidates all prior embeddings on backfill
        searchText,
        pillar: source.pillar,
      }),
    );
    const existing = await ctx.runQuery(getExistingSemanticDocumentQueryRef, {
      sourceType: "prompt",
      sourceId,
    });
    const model = getSemanticEmbeddingModel();
    const dimensions = getSemanticEmbeddingDimensions();
    const shouldReuseEmbedding =
      existing &&
      existing.contentHash === contentHash &&
      existing.embeddingModel === model &&
      existing.embeddingDimensions === dimensions;
    const embedding = shouldReuseEmbedding
      ? existing.embedding
      : (await embedWithGemini([{ text: searchText }])).values;
    const scopeFields = buildScopeFields(
      source.ownerUserId,
      "prompt",
      source.pillar,
      false,
    );

    const semanticDocumentId = await ctx.runMutation(upsertSemanticDocumentMutationRef, {
      ownerUserId: source.ownerUserId,
      sourceType: "prompt",
      sourceId,
      assetId: undefined,
      promptId,
      designInspirationId: undefined,
      pillar: source.pillar,
      isPublic: false,
      kind: undefined,
      modality: "text_only",
      searchText,
      contentHash,
      embeddingModel: model,
      embeddingDimensions: dimensions,
      embedding: shouldReuseEmbedding ? undefined : embedding,
      scopeKey: scopeFields.scopeKey,
      scopePillarKey: scopeFields.scopePillarKey,
      publicScopeKey: undefined,
      publicScopePillarKey: undefined,
      sourceUpdatedAt: source.sourceUpdatedAt,
    });
    await ctx.runMutation(resolveFailureMutationRef, {
      sourceType: "prompt",
      sourceId,
    });

    return {
      status: "indexed" as const,
      semanticDocumentId,
      retryScheduled: false,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown semantic prompt index error.";
    await ctx.runMutation(recordFailureMutationRef, {
      ownerUserId: source.ownerUserId,
      sourceType: "prompt",
      sourceId,
      errorMessage,
    });

    return {
      status: "skipped" as const,
      retryScheduled: await scheduleRetry(ctx, "prompt", sourceId, attempt),
    };
  }
};

const reindexDesignSource = async (
  ctx: ActionCtx,
  designInspirationId: Id<"designInspirations">,
  attempt: number,
): Promise<ReindexResult> => {
  if (!isSemanticEmbeddingsEnabled()) {
    return {
      status: "skipped" as const,
      retryScheduled: false,
    };
  }

  const source = await ctx.runQuery(getDesignSourceQueryRef, { designInspirationId });
  const sourceId = String(designInspirationId);
  if (!source) {
    await ctx.runMutation(deleteSemanticDocumentMutationRef, {
      sourceType: "designInspiration",
      sourceId,
    });
    await ctx.runMutation(resolveFailureMutationRef, {
      sourceType: "designInspiration",
      sourceId,
    });
    return {
      status: "deleted" as const,
      retryScheduled: false,
    };
  }

  try {
    const searchText = compactSearchText([
      source.title ? `title: ${source.title}` : undefined,
      source.summary ? `summary: ${source.summary}` : undefined,
      source.sourceUrl ? `source url: ${source.sourceUrl}` : undefined,
      source.sourceDomain ? `source domain: ${source.sourceDomain}` : undefined,
      source.tagNames.length > 0 ? `tags: ${source.tagNames.join(", ")}` : undefined,
      source.platform ? `platform: ${source.platform}` : undefined,
      `inspiration type: ${source.inspirationType}`,
      source.workflowType ? `workflow type: ${source.workflowType}` : undefined,
      source.promptText ? `linked prompt: ${source.promptText}` : undefined,
    ]);
    const contentHash = await sha256Hex(
      JSON.stringify({
        searchText,
        sourceDomain: source.sourceDomain,
      }),
    );
    const existing = await ctx.runQuery(getExistingSemanticDocumentQueryRef, {
      sourceType: "designInspiration",
      sourceId,
    });
    const model = getSemanticEmbeddingModel();
    const dimensions = getSemanticEmbeddingDimensions();
    const shouldReuseEmbedding =
      existing &&
      existing.contentHash === contentHash &&
      existing.embeddingModel === model &&
      existing.embeddingDimensions === dimensions;
    const embedding = shouldReuseEmbedding
      ? existing.embedding
      : (await embedWithGemini([{ text: searchText }])).values;
    const scopeFields = buildScopeFields(
      source.ownerUserId,
      "designInspiration",
      source.pillar,
      false,
    );

    const semanticDocumentId = await ctx.runMutation(upsertSemanticDocumentMutationRef, {
      ownerUserId: source.ownerUserId,
      sourceType: "designInspiration",
      sourceId,
      assetId: undefined,
      promptId: undefined,
      designInspirationId,
      pillar: source.pillar,
      isPublic: false,
      kind: undefined,
      modality: "text_only",
      searchText,
      contentHash,
      embeddingModel: model,
      embeddingDimensions: dimensions,
      embedding: shouldReuseEmbedding ? undefined : embedding,
      scopeKey: scopeFields.scopeKey,
      scopePillarKey: scopeFields.scopePillarKey,
      publicScopeKey: undefined,
      publicScopePillarKey: undefined,
      sourceUpdatedAt: source.sourceUpdatedAt,
    });
    await ctx.runMutation(resolveFailureMutationRef, {
      sourceType: "designInspiration",
      sourceId,
    });

    return {
      status: "indexed" as const,
      semanticDocumentId,
      retryScheduled: false,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown semantic design inspiration index error.";
    await ctx.runMutation(recordFailureMutationRef, {
      ownerUserId: source.ownerUserId,
      sourceType: "designInspiration",
      sourceId,
      errorMessage,
    });

    return {
      status: "skipped" as const,
      retryScheduled: await scheduleRetry(
        ctx,
        "designInspiration",
        sourceId,
        attempt,
      ),
    };
  }
};

export const reindexAsset = internalAction({
  args: {
    assetId: v.id("assets"),
    attempt: v.optional(v.number()),
  },
  returns: reindexResultValidator,
  handler: async (ctx, args): Promise<ReindexResult> => {
    return await reindexAssetSource(ctx, args.assetId, args.attempt ?? 0);
  },
});

export const reindexPrompt = internalAction({
  args: {
    promptId: v.id("prompts"),
    attempt: v.optional(v.number()),
  },
  returns: reindexResultValidator,
  handler: async (ctx, args): Promise<ReindexResult> => {
    return await reindexPromptSource(ctx, args.promptId, args.attempt ?? 0);
  },
});

export const reindexDesignInspiration = internalAction({
  args: {
    designInspirationId: v.id("designInspirations"),
    attempt: v.optional(v.number()),
  },
  returns: reindexResultValidator,
  handler: async (ctx, args): Promise<ReindexResult> => {
    return await reindexDesignSource(
      ctx,
      args.designInspirationId,
      args.attempt ?? 0,
    );
  },
});

export const backfillBatch = internalAction({
  args: {
    sourceType: semanticSourceTypeValidator,
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    sourceType: semanticSourceTypeValidator,
    processed: v.number(),
    successCount: v.number(),
    failureCount: v.number(),
    nextCursor: v.optional(v.string()),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const batch = await ctx.runQuery(listBackfillSourceBatchQueryRef, {
      sourceType: args.sourceType,
      cursor: args.cursor,
      batchSize: args.batchSize,
    });

    let successCount = 0;
    let failureCount = 0;
    for (const id of batch.ids) {
      const result =
        args.sourceType === "asset"
          ? await reindexAssetSource(ctx, id as Id<"assets">, 0)
          : args.sourceType === "prompt"
            ? await reindexPromptSource(ctx, id as Id<"prompts">, 0)
            : await reindexDesignSource(ctx, id as Id<"designInspirations">, 0);

      if (result.status === "indexed" || result.status === "deleted") {
        successCount += 1;
      } else {
        failureCount += 1;
      }
    }

    return {
      sourceType: args.sourceType,
      processed: batch.ids.length,
      successCount,
      failureCount,
      nextCursor: batch.nextCursor,
      done: batch.done,
    };
  },
});
