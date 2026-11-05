import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { ConvexError, v, type Infer } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import { dedupeIds } from "./helpers";
import {
  optionalPillarValidator,
  semanticFailureStatusValidator,
  semanticModalityValidator,
  semanticSourceTypeValidator,
} from "./validators";
import { resolveAssetUrl } from "./r2_url";
import { buildAssetTextLane } from "./agentDescriptionText";
import { buildBookmarkSearchText } from "./bookmarkHelpers";
import {
  buildScopeFields,
  convexValueSize,
  legacyAssetTextHash,
  legacyPixelHash,
  legacySkillTextHash,
  pixelLaneHash,
  semanticStorageMode,
  sha256Hex,
  textLaneHash,
  toStoredVector,
} from "./semanticStorage";

const RETRY_DELAYS_MS = [30_000, 300_000, 1_800_000] as const;
const MAX_QUERY_BATCH = 50;
const MAX_BACKFILL_BYTES = 4 * 1024 * 1024;

const getExistingSemanticDocumentQueryRef = makeFunctionReference<"query">(
  "semanticIndex:getExistingSemanticDocumentForSource",
);
const getSemanticEntryQueryRef = makeFunctionReference<"query">(
  "semanticIndex:getSemanticEntryForSource",
);
const writeSemanticEntryMutationRef = makeFunctionReference<"mutation">(
  "semanticIndex:writeSemanticEntry",
);
const deleteSemanticEntryMutationRef = makeFunctionReference<"mutation">(
  "semanticIndex:deleteSemanticEntry",
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
const getSkillSourceQueryRef = makeFunctionReference<"query">(
  "semanticIndex:getSkillSourceForReindex",
);
const reindexSkillActionRef = makeFunctionReference<"action">(
  "semanticIndex:reindexSkill",
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
  skillId: v.optional(v.id("skills")),
  pillar: optionalPillarValidator,
  isPublic: v.boolean(),
  kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
  modality: semanticModalityValidator,
  searchText: v.string(),
  contentHash: v.string(),
  embeddingModel: v.string(),
  embeddingDimensions: v.number(),
  embedding: v.optional(v.array(v.float64())),
  textEmbedding: v.optional(v.array(v.float64())),
  textContentHash: v.optional(v.string()),
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
  skillId: v.optional(v.id("skills")),
  ownerUserId: v.string(),
  pillar: optionalPillarValidator,
  isPublic: v.boolean(),
  kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
  modality: semanticModalityValidator,
});

type SemanticIdentity = Infer<typeof semanticDocumentLookupValidator>;

const semanticIdentity = (row: SemanticIdentity): SemanticIdentity => ({
  _id: row._id,
  _creationTime: row._creationTime,
  sourceType: row.sourceType,
  sourceId: row.sourceId,
  assetId: row.assetId,
  skillId: row.skillId,
  ownerUserId: row.ownerUserId,
  pillar: row.pillar,
  isPublic: row.isPublic,
  kind: row.kind,
  modality: row.modality,
});

const identityFields = (row: SemanticIdentity) => {
  const { _id, _creationTime, ...fields } = semanticIdentity(row);
  return {
    ...fields,
    semanticDocumentId: _id,
    semanticDocumentCreationTime: _creationTime,
  };
};

const identityMatches = (
  stored: Doc<"semanticDocumentIdentities"> | null,
  fields: ReturnType<typeof identityFields>,
) => stored !== null && (Object.keys(fields) as Array<keyof typeof fields>)
  .every((field) => stored[field] === fields[field]);

const semanticEntryValidator = v.object({
  _id: v.id("semanticEntries"),
  _creationTime: v.number(),
  ownerUserId: v.string(),
  assetId: v.optional(v.id("assets")),
  skillId: v.optional(v.id("skills")),
  pillar: optionalPillarValidator,
  isPublic: v.boolean(),
  modality: semanticModalityValidator,
  pixelVectorId: v.optional(v.id("semanticPixelVectors")),
  pixelHash: v.optional(v.string()),
  textVectorId: v.optional(v.id("semanticTextVectors")),
  textHash: v.optional(v.string()),
});

type SemanticEntry = Infer<typeof semanticEntryValidator>;

// Lane change for writeSemanticEntry: absent keeps the lane, null removes it,
// an embedding replaces it. A vector without a hash stays searchable but is
// re-embedded by the next reindex.
const laneWriteValidator = v.union(
  v.null(),
  v.object({ embedding: v.array(v.float64()), hash: v.optional(v.string()) }),
);

const semanticEntryWriteValidator = v.object({
  ownerUserId: v.string(),
  assetId: v.optional(v.id("assets")),
  skillId: v.optional(v.id("skills")),
  pillar: optionalPillarValidator,
  isPublic: v.boolean(),
  modality: semanticModalityValidator,
  pixel: v.optional(laneWriteValidator),
  text: v.optional(laneWriteValidator),
});

type LaneWrite = Infer<typeof laneWriteValidator>;
type SemanticEntryWrite = Infer<typeof semanticEntryWriteValidator>;

const findSemanticEntry = async (
  ctx: QueryCtx,
  source: { assetId?: Id<"assets">; skillId?: Id<"skills"> },
) => {
  if (Boolean(source.assetId) === Boolean(source.skillId)) {
    throw new ConvexError("A semantic entry belongs to exactly one asset or Skill.");
  }
  return source.assetId
    ? await ctx.db.query("semanticEntries")
      .withIndex("by_asset", (q) => q.eq("assetId", source.assetId)).first()
    : await ctx.db.query("semanticEntries")
      .withIndex("by_skill", (q) => q.eq("skillId", source.skillId)).first();
};

type VectorTable = "semanticPixelVectors" | "semanticTextVectors";
type LaneState<T extends VectorTable> = { vectorId?: Id<T>; hash?: string };

const applyLaneWrite = async <T extends VectorTable>(
  ctx: MutationCtx,
  table: T,
  current: LaneState<T>,
  write: LaneWrite | undefined,
  scope: ReturnType<typeof buildScopeFields>,
  scopeChanged: boolean,
): Promise<LaneState<T>> => {
  if (write === null) {
    if (current.vectorId) await ctx.db.delete(current.vectorId);
    return {};
  }
  if (write) {
    const row = { ...scope, embedding: write.embedding };
    if (current.vectorId) {
      await ctx.db.patch(current.vectorId, row as never);
      return { vectorId: current.vectorId, hash: write.hash };
    }
    const vectorId = (await ctx.db.insert(table, row as never)) as Id<T>;
    return { vectorId, hash: write.hash };
  }
  if (current.vectorId && scopeChanged) await ctx.db.patch(current.vectorId, scope as never);
  return current;
};

// Writes one source's entry and lane vectors in a single transaction, so a
// vector hit can always be mapped. An entry with no vector left is removed.
// Unchanged lanes are not rewritten; a scope change patches only the keys.
const applySemanticEntryWrite = async (ctx: MutationCtx, args: SemanticEntryWrite) => {
  const entry = await findSemanticEntry(ctx, args);
  const scope = buildScopeFields(args.ownerUserId, args.assetId ? "asset" : "skill", args.pillar, args.isPublic);
  const scopeChanged = Boolean(entry) && (
    entry!.ownerUserId !== args.ownerUserId || entry!.isPublic !== args.isPublic || entry!.pillar !== args.pillar
  );
  const pixel = await applyLaneWrite(ctx, "semanticPixelVectors", {
    vectorId: entry?.pixelVectorId, hash: entry?.pixelHash,
  }, args.pixel, scope, scopeChanged);
  const text = await applyLaneWrite(ctx, "semanticTextVectors", {
    vectorId: entry?.textVectorId, hash: entry?.textHash,
  }, args.text, scope, scopeChanged);
  if (!pixel.vectorId && !text.vectorId) {
    if (entry) await ctx.db.delete(entry._id);
    return null;
  }
  const fields = {
    ownerUserId: args.ownerUserId,
    assetId: args.assetId,
    skillId: args.skillId,
    pillar: args.pillar,
    isPublic: args.isPublic,
    modality: args.modality,
    pixelVectorId: pixel.vectorId,
    pixelHash: pixel.hash,
    textVectorId: text.vectorId,
    textHash: text.hash,
  };
  if (!entry) return await ctx.db.insert("semanticEntries", fields);
  if ((Object.keys(fields) as Array<keyof typeof fields>).some((field) => entry[field] !== fields[field])) {
    await ctx.db.patch(entry._id, fields);
  }
  return entry._id;
};

const deleteSemanticEntryRows = async (ctx: MutationCtx, entry: Doc<"semanticEntries">) => {
  if (entry.pixelVectorId) await ctx.db.delete(entry.pixelVectorId);
  if (entry.textVectorId) await ctx.db.delete(entry.textVectorId);
  await ctx.db.delete(entry._id);
};

// The action already read the entry: skip the mutation when it would change
// nothing, so an unchanged reindex costs one ~0.4 KB read.
const entryWriteChangesSomething = (entry: SemanticEntry | null, write: SemanticEntryWrite) => {
  if (write.pixel !== undefined || write.text !== undefined) return true;
  if (!entry) return false;
  return entry.ownerUserId !== write.ownerUserId || entry.isPublic !== write.isPublic ||
    entry.pillar !== write.pillar || entry.modality !== write.modality;
};

type LegacyUpsertArgs = Record<string, unknown> & {
  embedding?: number[];
  textEmbedding?: number[];
  textContentHash?: string;
  clearTextEmbedding?: boolean;
};

const LEGACY_UPSERT_FIELDS = [
  "ownerUserId", "assetId", "promptId", "designInspirationId", "skillId", "pillar", "isPublic",
  "kind", "modality", "searchText", "contentHash", "embeddingModel", "embeddingDimensions",
  "scopeKey", "scopePillarKey", "publicScopeKey", "publicScopePillarKey", "sourceUpdatedAt",
] as const;

// upsertSemanticDocument patches the whole ~56 KB row, so a reindex that
// changes nothing used to cost two reads and a write of both vectors.
const legacyUpsertChangesNothing = (
  existing: Infer<typeof semanticDocumentValidator> | null,
  args: LegacyUpsertArgs,
) => {
  if (!existing || args.embedding || args.textEmbedding) return false;
  const nextTextHash = args.clearTextEmbedding ? undefined : (args.textContentHash ?? existing.textContentHash);
  if (args.clearTextEmbedding && existing.textEmbedding) return false;
  return nextTextHash === existing.textContentHash &&
    LEGACY_UPSERT_FIELDS.every((field) => existing[field] === args[field]);
};

// Called in the same transaction as the vector write/delete, never by an
// asynchronous scheduler. Metadata must not lag the searchable document.
const upsertSemanticIdentity = async (ctx: MutationCtx, row: SemanticIdentity) => {
  const fields = identityFields(row);
  const existing = await ctx.db.query("semanticDocumentIdentities")
    .withIndex("by_semanticDocument", (q) => q.eq("semanticDocumentId", row._id))
    .unique();
  if (identityMatches(existing, fields)) return false;
  if (existing) await ctx.db.patch(existing._id, fields);
  else await ctx.db.insert("semanticDocumentIdentities", fields);
  return true;
};

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
    agentDescription: v.optional(v.string()),
    description: v.optional(v.string()),
    designTitle: v.optional(v.string()),
    designSummary: v.optional(v.string()),
    designSourceDomain: v.optional(v.string()),
    bookmarkText: v.optional(v.string()),
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

const skillSourceValidator = v.union(
  v.null(),
  v.object({
    skillId: v.id("skills"),
    ownerUserId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    body: v.optional(v.string()),
    agentInstructions: v.optional(v.string()),
    tagNames: v.array(v.string()),
    stepLabels: v.array(v.string()),
    modelNames: v.array(v.string()),
    pillar: optionalPillarValidator,
    isPublic: v.boolean(),
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

type SourceCursor = {
  sourceType: Infer<typeof semanticSourceTypeValidator>;
  position: string | null;
  // Accept a pre-migration timestamp::id checkpoint once, then carry its
  // boundary through native pages (including pages of timestamp ties).
  legacy?: { createdAt: number; id: string };
};
const SOURCE_CURSOR_PREFIX = "semantic-v2:";
const parseSourceCursor = (
  sourceType: SourceCursor["sourceType"], cursor?: string,
): SourceCursor => {
  if (!cursor) return { sourceType, position: null };
  if (cursor.startsWith(SOURCE_CURSOR_PREFIX)) {
    try {
      const parsed = JSON.parse(cursor.slice(SOURCE_CURSOR_PREFIX.length)) as SourceCursor;
      if (parsed.sourceType === sourceType && typeof parsed.position === "string" &&
          (!parsed.legacy || (Number.isFinite(parsed.legacy.createdAt) && typeof parsed.legacy.id === "string"))) {
        return parsed;
      }
    } catch { /* Invalid opaque cursor: fail rather than silently restart. */ }
    throw new ConvexError("Invalid semantic backfill cursor for this source type.");
  }
  const [createdAtRaw, id, extra] = cursor.split("::");
  const createdAt = Number(createdAtRaw);
  if (createdAtRaw && Number.isFinite(createdAt) && id && extra === undefined) {
    return { sourceType, position: null, legacy: { createdAt, id } };
  }
  throw new ConvexError("Invalid semantic backfill cursor.");
};

const boundedBatchSize = (requested = 25) => {
  if (!Number.isFinite(requested) || !Number.isInteger(requested) || requested < 1) {
    throw new ConvexError("batchSize must be a positive integer.");
  }
  return Math.min(requested, MAX_QUERY_BATCH);
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

// The text lane runs on its own embedding model. gemini-embedding-001 is
// text-only with a far larger quota than the multimodal model, so indexing an
// asset's words never competes with the pixel lane (or live search) for the
// multimodal model's small per-minute budget.
export const getTextEmbeddingModel = () =>
  normalizeOptionalString(process.env.TEXT_EMBEDDING_MODEL) ?? "gemini-embedding-001";

const embedTextLane = async (text: string) => {
  const model = getTextEmbeddingModel();
  const dimensions = getSemanticEmbeddingDimensions();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": getGeminiApiKey(),
      },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: dimensions,
      }),
    },
  );
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(
      `Gemini text-lane embedding failed (${response.status}): ${bodyText || "unknown error"}`,
    );
  }
  const payload = (await response.json()) as { embedding?: { values?: number[] } };
  const values = payload.embedding?.values;
  if (!values || values.length !== dimensions) {
    throw new Error("Gemini text-lane embedding returned no or mis-sized values.");
  }
  return values;
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

export const getSemanticEntryForSource = internalQuery({
  args: { assetId: v.optional(v.id("assets")), skillId: v.optional(v.id("skills")) },
  returns: v.union(v.null(), semanticEntryValidator),
  handler: async (ctx, args) => await findSemanticEntry(ctx, args),
});

export const writeSemanticEntry = internalMutation({
  args: semanticEntryWriteValidator.fields,
  returns: v.union(v.null(), v.id("semanticEntries")),
  handler: async (ctx, args) => await applySemanticEntryWrite(ctx, args),
});

export const deleteSemanticEntry = internalMutation({
  args: { assetId: v.optional(v.id("assets")), skillId: v.optional(v.id("skills")) },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args) => {
    const entry = await findSemanticEntry(ctx, args);
    if (!entry) return { deleted: false };
    await deleteSemanticEntryRows(ctx, entry);
    return { deleted: true };
  },
});

const semanticEntryHitValidator = v.object({
  vectorId: v.string(),
  assetId: v.optional(v.id("assets")),
  skillId: v.optional(v.id("skills")),
  modality: semanticModalityValidator,
});

// Hit mapping for split storage: one ~0.4 KB entry per hit, read through the
// lane's vector-ID index. The vectors themselves are never read here.
export const getSemanticEntriesByVectorIds = internalQuery({
  args: {
    pixelIds: v.array(v.id("semanticPixelVectors")),
    textIds: v.array(v.id("semanticTextVectors")),
  },
  returns: v.object({
    pixel: v.array(semanticEntryHitValidator),
    text: v.array(semanticEntryHitValidator),
  }),
  handler: async (ctx, args) => {
    const toHit = (vectorId: string, entry: Doc<"semanticEntries"> | null) => entry ? [{
      vectorId, assetId: entry.assetId, skillId: entry.skillId, modality: entry.modality,
    }] : [];
    const [pixel, text] = await Promise.all([
      Promise.all(dedupeIds(args.pixelIds).map(async (id) => toHit(id, await ctx.db.query("semanticEntries")
        .withIndex("by_pixelVector", (q) => q.eq("pixelVectorId", id)).first()))),
      Promise.all(dedupeIds(args.textIds).map(async (id) => toHit(id, await ctx.db.query("semanticEntries")
        .withIndex("by_textVector", (q) => q.eq("textVectorId", id)).first()))),
    ]);
    return { pixel: pixel.flat(), text: text.flat() };
  },
});

// Lets operator scripts confirm which layout the deployment writes before a
// migration; reads nothing from the database.
export const getSemanticStorageStatus = internalQuery({
  args: {},
  returns: v.object({
    mode: v.union(v.literal("legacy"), v.literal("dual"), v.literal("split")),
    embeddingsEnabled: v.boolean(),
  }),
  handler: async () => ({
    mode: semanticStorageMode(),
    embeddingsEnabled: isSemanticEmbeddingsEnabled(),
  }),
});

// The vectors a similarity search starts from, read one lane row at a time
// (~7 KB each) instead of the whole two-vector legacy document. Same lane
// choice as before: visual uses pixels and falls back to words; text uses
// words; hybrid both.
export const getSemanticVectorsForAsset = internalQuery({
  args: {
    assetId: v.id("assets"),
    scope: v.union(v.literal("mine"), v.literal("public")),
    ownerCandidates: v.array(v.string()),
    mode: v.union(v.literal("hybrid"), v.literal("visual"), v.literal("text")),
  },
  returns: v.union(v.null(), v.object({
    ownerUserId: v.string(),
    isPublic: v.boolean(),
    pillar: optionalPillarValidator,
    pixelVectorId: v.optional(v.id("semanticPixelVectors")),
    pixel: v.optional(v.array(v.float64())),
    textVectorId: v.optional(v.id("semanticTextVectors")),
    text: v.optional(v.array(v.float64())),
  })),
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset || (args.scope === "public"
      ? asset.isPublic !== true
      : !asset.ownerUserId || !args.ownerCandidates.includes(asset.ownerUserId))) {
      return null;
    }
    const entry = await findSemanticEntry(ctx, { assetId: args.assetId });
    if (!entry) return null;
    const usePixel = args.mode !== "text" && entry.modality === "multimodal_image" && Boolean(entry.pixelVectorId);
    const useText = Boolean(entry.textVectorId) && !(args.mode === "visual" && usePixel);
    const [pixel, text] = await Promise.all([
      usePixel ? ctx.db.get(entry.pixelVectorId!) : null,
      useText ? ctx.db.get(entry.textVectorId!) : null,
    ]);
    return {
      ownerUserId: entry.ownerUserId,
      isPublic: entry.isPublic,
      pillar: entry.pillar,
      pixelVectorId: entry.pixelVectorId,
      pixel: pixel?.embedding,
      textVectorId: entry.textVectorId,
      text: text?.embedding,
    };
  },
});

export const getSemanticDocumentsByIds = internalQuery({
  args: {
    ids: v.array(v.id("semanticDocuments")),
    // Search first resolves compact identities, then fetches only misses in
    // separately bounded queries. Default preserves older internal callers.
    metadataOnly: v.optional(v.boolean()),
  },
  returns: v.array(semanticDocumentLookupValidator),
  handler: async (ctx, args) => {
    const rows = await Promise.all(dedupeIds(args.ids).map(async (id) => {
      const identity = await ctx.db.query("semanticDocumentIdentities")
        .withIndex("by_semanticDocument", (q) => q.eq("semanticDocumentId", id))
        .unique();
      if (identity) {
        return semanticIdentity({
          ...identity,
          _id: identity.semanticDocumentId,
          _creationTime: identity.semanticDocumentCreationTime,
        });
      }
      if (args.metadataOnly) return null;
      // Additive rollout: older documents remain searchable before the
      // metadata-only backfill completes. Only these misses read vectors.
      const legacy = await ctx.db.get(id);
      return legacy ? semanticIdentity(legacy) : null;
    }));
    return rows.filter((row): row is SemanticIdentity => row !== null);
  },
});

export const getLegacySemanticDocumentsByIds = internalQuery({
  args: { ids: v.array(v.id("semanticDocuments")) },
  returns: v.array(semanticDocumentLookupValidator),
  handler: async (ctx, args) => {
    const ids = dedupeIds(args.ids);
    // A semantic document can approach Convex's 1 MiB document limit when
    // searchText is large. Eight direct reads stay below the 16 MiB query
    // limit regardless of vector size; do not batch by vector bytes alone.
    if (ids.length > 8) throw new ConvexError("Legacy semantic lookups are limited to 8 documents per query.");
    const rows = await Promise.all(ids.map(async (id) => {
      const row = await ctx.db.get(id);
      return row ? semanticIdentity(row) : null;
    }));
    return rows.filter((row): row is SemanticIdentity => row !== null);
  },
});

// This migration copies metadata only. It never calls an embedding provider,
// schedules a reindex, changes vector values, or removes the legacy fallback.
export const backfillSemanticIdentities = internalMutation({
  args: { cursor: v.optional(v.string()), batchSize: v.optional(v.number()) },
  returns: v.object({
    scanned: v.number(), written: v.number(), nextCursor: v.optional(v.string()), done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("semanticDocuments").paginate({
      cursor: args.cursor ?? null, numItems: boundedBatchSize(args.batchSize),
      maximumBytesRead: MAX_BACKFILL_BYTES,
    });
    let written = 0;
    for (const row of page.page) {
      if (await upsertSemanticIdentity(ctx, row)) written += 1;
    }
    return {
      scanned: page.page.length, written,
      nextCursor: page.isDone ? undefined : page.continueCursor, done: page.isDone,
    };
  },
});

export const auditSemanticIdentities = internalQuery({
  args: { cursor: v.optional(v.string()), batchSize: v.optional(v.number()) },
  returns: v.object({
    scanned: v.number(), missing: v.number(), mismatched: v.number(),
    nextCursor: v.optional(v.string()), done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("semanticDocuments").paginate({
      cursor: args.cursor ?? null, numItems: boundedBatchSize(args.batchSize),
      maximumBytesRead: MAX_BACKFILL_BYTES,
    });
    let missing = 0;
    let mismatched = 0;
    for (const row of page.page) {
      const identity = await ctx.db.query("semanticDocumentIdentities")
        .withIndex("by_semanticDocument", (q) => q.eq("semanticDocumentId", row._id))
        .unique();
      if (!identity) missing += 1;
      else if (!identityMatches(identity, identityFields(row))) mismatched += 1;
    }
    return {
      scanned: page.page.length, missing, mismatched,
      nextCursor: page.isDone ? undefined : page.continueCursor, done: page.isDone,
    };
  },
});

const SPLIT_MIGRATION_CURSOR_PREFIX = "semantic-split-v1:";
type SplitMigrationCursor = { table: "assets" | "skills"; position: string | null };

const parseSplitMigrationCursor = (cursor?: string): SplitMigrationCursor => {
  if (!cursor) return { table: "assets", position: null };
  if (cursor.startsWith(SPLIT_MIGRATION_CURSOR_PREFIX)) {
    try {
      const parsed = JSON.parse(cursor.slice(SPLIT_MIGRATION_CURSOR_PREFIX.length)) as SplitMigrationCursor;
      if ((parsed.table === "assets" || parsed.table === "skills") &&
          (parsed.position === null || typeof parsed.position === "string")) {
        return parsed;
      }
    } catch { /* Invalid opaque cursor: fail rather than silently restart. */ }
  }
  throw new ConvexError("Invalid semantic split migration cursor.");
};

type MigrationCounts = {
  unverifiedPixel: number;
  unverifiedText: number;
};

// The split write for one source, built from its legacy row alone: no
// provider call. A lane keeps its hash only when the legacy hash still
// matches the current source; otherwise it is copied without one, stays
// searchable, and the next reindex re-embeds it.
const legacyToSplitWrite = async (
  ctx: MutationCtx,
  source: { kind: "asset"; row: Doc<"assets"> } | { kind: "skill"; row: Doc<"skills"> },
  legacy: Doc<"semanticDocuments">,
  counts: MigrationCounts,
): Promise<SemanticEntryWrite | null> => {
  const textModel = getTextEmbeddingModel();
  let text: LaneWrite | undefined;
  if (legacy.textEmbedding) {
    const expected = source.kind === "asset"
      ? await legacyAssetTextHash({ model: textModel, dimensions: legacy.embeddingDimensions, text: legacy.searchText })
      : await legacySkillTextHash({ model: textModel, dimensions: legacy.embeddingDimensions, text: legacy.searchText });
    const verified = legacy.textContentHash === expected;
    if (!verified) counts.unverifiedText += 1;
    text = {
      embedding: toStoredVector(legacy.textEmbedding),
      hash: verified ? await textLaneHash({ model: textModel, text: legacy.searchText }) : undefined,
    };
  }

  if (source.kind === "skill") {
    const ownerUserId = source.row.ownerUserId;
    return ownerUserId && text ? {
      ownerUserId, skillId: source.row._id, pillar: source.row.pillar,
      isPublic: Boolean(source.row.isPublic), modality: "text_only", text,
    } : null;
  }

  const asset = source.row;
  if (!asset.ownerUserId) return null;
  const storageUrl = (await resolveAssetUrl(ctx, asset)) ?? undefined;
  const isImage = Boolean(storageUrl) &&
    Boolean(normalizeOptionalString(asset.contentType)?.startsWith("image/"));
  let pixel: LaneWrite | undefined;
  if (isImage && legacy.modality === "multimodal_image" && legacy.embedding) {
    const model = getSemanticEmbeddingModel();
    const verified = legacy.embeddingModel === model &&
      legacy.embeddingDimensions === getSemanticEmbeddingDimensions() &&
      legacy.contentHash === await legacyPixelHash({
        modality: "multimodal_image", searchText: "[image]", storageId: asset.storageId,
        storageUrl, isPublic: legacy.isPublic, pillar: legacy.pillar,
      });
    if (!verified) counts.unverifiedPixel += 1;
    pixel = {
      embedding: toStoredVector(legacy.embedding),
      hash: verified ? await pixelLaneHash({ model, storageId: asset.storageId, storageUrl }) : undefined,
    };
  }
  if (!pixel && !text) return null;
  return {
    ownerUserId: asset.ownerUserId, assetId: asset._id, pillar: asset.pillar,
    isPublic: Boolean(asset.isPublic), modality: isImage ? "multimodal_image" : "text_only",
    pixel, text,
  };
};

// Copies legacy vectors into split storage, assets first, then Skills. Only
// sources without an entry are touched, so replays and dual-mode writes are
// never overwritten. Without apply: true it is a dry run that reads no legacy
// row and writes nothing; `missing` is how many sources a real run would copy.
// A real batch reads each missing source's legacy row once (~56 KB).
export const migrateSemanticVectorsToSplit = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    apply: v.optional(v.boolean()),
  },
  returns: v.object({
    apply: v.boolean(),
    table: v.union(v.literal("assets"), v.literal("skills")),
    scanned: v.number(),
    alreadySplit: v.number(),
    missing: v.number(),
    copied: v.number(),
    noLegacyVectors: v.number(),
    unverifiedPixel: v.number(),
    unverifiedText: v.number(),
    legacyBytesRead: v.number(),
    splitBytesWritten: v.number(),
    nextCursor: v.optional(v.string()),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const apply = args.apply === true;
    const cursor = parseSplitMigrationCursor(args.cursor);
    const pageOptions = {
      cursor: cursor.position, numItems: boundedBatchSize(args.batchSize), maximumBytesRead: MAX_BACKFILL_BYTES,
    };
    const sources = cursor.table === "assets"
      ? await ctx.db.query("assets").paginate(pageOptions)
        .then((page) => ({ ...page, items: page.page.map((row) => ({ kind: "asset" as const, row })) }))
      : await ctx.db.query("skills").paginate(pageOptions)
        .then((page) => ({ ...page, items: page.page.map((row) => ({ kind: "skill" as const, row })) }));
    const counts = {
      scanned: sources.items.length, alreadySplit: 0, missing: 0, copied: 0, noLegacyVectors: 0,
      unverifiedPixel: 0, unverifiedText: 0, legacyBytesRead: 0, splitBytesWritten: 0,
    };
    for (const source of sources.items) {
      // Unowned rows are never indexed (see getAssetSourceForReindex).
      if (!source.row.ownerUserId) continue;
      const entry = await findSemanticEntry(ctx,
        source.kind === "asset" ? { assetId: source.row._id } : { skillId: source.row._id });
      if (entry) {
        counts.alreadySplit += 1;
        continue;
      }
      counts.missing += 1;
      if (!apply) continue;
      const legacy = await ctx.db.query("semanticDocuments")
        .withIndex("by_source", (q) => q.eq("sourceType", source.kind).eq("sourceId", String(source.row._id)))
        .unique();
      if (legacy) counts.legacyBytesRead += convexValueSize(legacy);
      const write = legacy ? await legacyToSplitWrite(ctx, source, legacy, counts) : null;
      if (!write) {
        counts.noLegacyVectors += 1;
        continue;
      }
      await applySemanticEntryWrite(ctx, write);
      counts.copied += 1;
      counts.splitBytesWritten += convexValueSize(write);
    }
    const next: SplitMigrationCursor | undefined = !sources.isDone
      ? { table: cursor.table, position: sources.continueCursor }
      : cursor.table === "assets" ? { table: "skills", position: null } : undefined;
    return {
      apply, table: cursor.table, ...counts,
      nextCursor: next ? SPLIT_MIGRATION_CURSOR_PREFIX + JSON.stringify(next) : undefined,
      done: next === undefined,
    };
  },
});

export const getSemanticDocumentForAsset = internalQuery({
  args: {
    assetId: v.id("assets"),
    scope: v.union(v.literal("mine"), v.literal("public")),
    ownerCandidates: v.array(v.string()),
  },
  returns: v.union(v.null(), semanticDocumentValidator),
  handler: async (ctx, args) => {
    // Source publication/ownership can change before scheduled reindexing.
    // Never use stale vector metadata to authorize a similarity request.
    const asset = await ctx.db.get(args.assetId);
    if (!asset || (args.scope === "public"
      ? asset.isPublic !== true
      : !asset.ownerUserId || !args.ownerCandidates.includes(asset.ownerUserId))) {
      return null;
    }
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

    const [prompt, designInspiration, bookmark, tagNames, storageUrl] = await Promise.all([
      asset.promptId ? ctx.db.get(asset.promptId) : Promise.resolve(null),
      asset.designInspirationId
        ? ctx.db.get(asset.designInspirationId)
        : Promise.resolve(null),
      asset.bookmarkId ? ctx.db.get(asset.bookmarkId) : Promise.resolve(null),
      resolveTagNames(ctx, asset.tagIds),
      resolveAssetUrl(ctx, asset),
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
      agentDescription: asset.agentDescription,
      description: asset.description,
      designTitle: designInspiration?.title,
      designSummary: designInspiration?.summary,
      designSourceDomain: designInspiration?.sourceDomain,
      bookmarkText: bookmark ? buildBookmarkSearchText(bookmark) : undefined,
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

export const getSkillSourceForReindex = internalQuery({
  args: {
    skillId: v.id("skills"),
  },
  returns: skillSourceValidator,
  handler: async (ctx, args) => {
    const skill = await ctx.db.get(args.skillId);
    if (!skill?.ownerUserId) {
      return null;
    }

    const steps = await ctx.db
      .query("prompts")
      .withIndex("by_skill_stepOrder", (q) => q.eq("skillId", skill._id))
      .order("asc")
      .collect();
    const stepLabels = steps
      .map((step) => normalizeOptionalString(step.skillStepLabel))
      .filter((label): label is string => Boolean(label));
    const modelNames = Array.from(
      new Set(
        steps
          .map((step) => normalizeOptionalString(step.modelName))
          .filter((name): name is string => Boolean(name)),
      ),
    );

    return {
      skillId: skill._id,
      ownerUserId: skill.ownerUserId,
      title: skill.title,
      description: skill.description,
      body: skill.body,
      agentInstructions: skill.agentInstructions,
      tagNames: await resolveTagNames(ctx, skill.tagIds),
      stepLabels,
      modelNames,
      pillar: skill.pillar,
      isPublic: Boolean(skill.isPublic),
      sourceUpdatedAt: skill.updatedAt,
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
    const batchSize = boundedBatchSize(args.batchSize);
    const cursor = parseSourceCursor(args.sourceType, args.cursor);
    const lowerBound = cursor.legacy?.createdAt ?? 0;
    const query =
      args.sourceType === "asset"
        ? ctx.db
            .query("assets")
            .withIndex("by_createdAt", (q) => q.gte("createdAt", lowerBound))
        : args.sourceType === "prompt"
          ? ctx.db
              .query("prompts")
              .withIndex("by_createdAt", (q) => q.gte("createdAt", lowerBound))
          : args.sourceType === "skill"
            ? ctx.db.query("skills")
            : ctx.db
                .query("designInspirations")
                .withIndex("by_createdAt", (q) => q.gte("createdAt", lowerBound));
    // Native cursor paging reads only this page, including across equal
    // createdAt timestamps. A legacy checkpoint may yield an empty page;
    // callers must follow done/nextCursor rather than treating that as EOF.
    const page = await query.paginate({
      cursor: cursor.position, numItems: batchSize, maximumBytesRead: MAX_BACKFILL_BYTES,
    });
    const legacy = cursor.legacy;
    const batch = legacy ? page.page.filter((row) =>
      row.createdAt > legacy.createdAt ||
      (row.createdAt === legacy.createdAt && row._id.localeCompare(legacy.id) > 0),
    ) : page.page;

    return {
      ids: batch.map((row) => row._id),
      nextCursor: page.isDone ? undefined : SOURCE_CURSOR_PREFIX + JSON.stringify({
        ...cursor, position: page.continueCursor,
      }),
      done: page.isDone,
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
    skillId: v.optional(v.id("skills")),
    pillar: optionalPillarValidator,
    isPublic: v.boolean(),
    kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
    modality: semanticModalityValidator,
    searchText: v.string(),
    contentHash: v.string(),
    embeddingModel: v.string(),
    embeddingDimensions: v.number(),
    embedding: v.optional(v.array(v.float64())),
    // Text lane. Omit both to leave the stored lane untouched; pass
    // clearTextEmbedding to drop it (the asset lost all its text).
    textEmbedding: v.optional(v.array(v.float64())),
    textContentHash: v.optional(v.string()),
    clearTextEmbedding: v.optional(v.boolean()),
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
        skillId: args.skillId,
        pillar: args.pillar,
        isPublic: args.isPublic,
        kind: args.kind,
        modality: args.modality,
        searchText: args.searchText,
        contentHash: args.contentHash,
        embeddingModel: args.embeddingModel,
        embeddingDimensions: args.embeddingDimensions,
        embedding: args.embedding ?? existing.embedding,
        textEmbedding: args.clearTextEmbedding
          ? undefined
          : (args.textEmbedding ?? existing.textEmbedding),
        textContentHash: args.clearTextEmbedding
          ? undefined
          : (args.textContentHash ?? existing.textContentHash),
        scopeKey: args.scopeKey,
        scopePillarKey: args.scopePillarKey,
        publicScopeKey: args.publicScopeKey,
        publicScopePillarKey: args.publicScopePillarKey,
        sourceUpdatedAt: args.sourceUpdatedAt,
        updatedAt: now,
      });
      await upsertSemanticIdentity(ctx, {
        ...args, _id: existing._id, _creationTime: existing._creationTime,
      });
      return existing._id;
    }

    if (!args.embedding && !args.textEmbedding) {
      throw new ConvexError("New semantic documents require an embedding in at least one lane.");
    }

    const id = await ctx.db.insert("semanticDocuments", {
      ownerUserId: args.ownerUserId,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      assetId: args.assetId,
      promptId: args.promptId,
      designInspirationId: args.designInspirationId,
      skillId: args.skillId,
      pillar: args.pillar,
      isPublic: args.isPublic,
      kind: args.kind,
      modality: args.modality,
      searchText: args.searchText,
      contentHash: args.contentHash,
      embeddingModel: args.embeddingModel,
      embeddingDimensions: args.embeddingDimensions,
      embedding: args.embedding,
      textEmbedding: args.clearTextEmbedding ? undefined : args.textEmbedding,
      textContentHash: args.clearTextEmbedding ? undefined : args.textContentHash,
      scopeKey: args.scopeKey,
      scopePillarKey: args.scopePillarKey,
      publicScopeKey: args.publicScopeKey,
      publicScopePillarKey: args.publicScopePillarKey,
      sourceUpdatedAt: args.sourceUpdatedAt,
      createdAt: now,
      updatedAt: now,
    });
    // Preserve the exact source _creationTime in the lookup contract.
    const inserted = await ctx.db.get(id);
    if (inserted) await upsertSemanticIdentity(ctx, inserted);
    return id;
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

    const identity = await ctx.db.query("semanticDocumentIdentities")
      .withIndex("by_semanticDocument", (q) => q.eq("semanticDocumentId", existing._id))
      .unique();
    if (identity) await ctx.db.delete(identity._id);
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
  sourceType: "asset" | "prompt" | "designInspiration" | "skill",
  sourceId: string,
  attempt: number,
  textOnly?: boolean,
) => {
  if (attempt >= RETRY_DELAYS_MS.length) {
    return false;
  }

  const delay = RETRY_DELAYS_MS[attempt];
  if (sourceType === "asset") {
    await ctx.scheduler.runAfter(delay, reindexAssetActionRef, {
      assetId: sourceId as Id<"assets">,
      attempt: attempt + 1,
      ...(textOnly !== undefined ? { textOnly } : {}),
    });
    return true;
  }
  if (sourceType === "skill") {
    await ctx.scheduler.runAfter(delay, reindexSkillActionRef, {
      skillId: sourceId as Id<"skills">,
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
  // Refresh the text lane only; never call the multimodal model. Used by
  // backfills so they don't drain the pixel lane's small quota.
  textOnly = false,
): Promise<ReindexResult> => {
  if (!isSemanticEmbeddingsEnabled()) {
    return {
      status: "skipped" as const,
      retryScheduled: false,
    };
  }

  const storage = semanticStorageMode();
  const writesLegacy = storage !== "split";
  const writesSplit = storage !== "legacy";
  const source = await ctx.runQuery(getAssetSourceQueryRef, { assetId });
  const sourceId = String(assetId);
  if (!source) {
    if (writesSplit) {
      await ctx.runMutation(deleteSemanticEntryMutationRef, { assetId });
    }
    if (writesLegacy) {
      await ctx.runMutation(deleteSemanticDocumentMutationRef, {
        sourceType: "asset",
        sourceId,
      });
    }
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
    // Two lanes. The pixel lane (multimodal model) embeds image bytes only, so
    // cross-modal matching finds what a picture looks like; imageless assets
    // (video) embed a short text there in legacy storage and have no pixel
    // lane in split storage. The text lane (getTextEmbeddingModel) embeds the
    // asset's words: agent description, caption, prompt, tags, source. The
    // text lane is written first and on its own quota, so a pixel-lane 429
    // never leaves an asset unsearchable.
    const shouldUseMultimodal =
      Boolean(source.storageUrl) &&
      Boolean(normalizeOptionalString(source.contentType)?.startsWith("image/"));
    const modality = shouldUseMultimodal ? "multimodal_image" : "text_only";
    const textLane = buildAssetTextLane({
      agentDescription: source.agentDescription,
      description: source.description,
      promptText: source.promptText,
      tagNames: source.tagNames,
      modelName: source.modelName,
      designTitle: source.designTitle,
      designSummary: source.designSummary,
      designSourceDomain: source.designSourceDomain,
      bookmarkText: source.bookmarkText,
      sourceUrl: source.sourceUrl,
    });
    // Pixel-lane input and hash are unchanged from pure-v1, so every existing
    // pixel embedding stays valid.
    const primaryText = shouldUseMultimodal
      ? "[image]"
      : compactSearchText([source.promptText ?? source.fileName ?? `asset`]);
    const searchText = textLane || primaryText;
    const scopeFields = buildScopeFields(
      source.ownerUserId,
      "asset",
      source.pillar,
      source.isPublic,
    );
    const contentHash = await legacyPixelHash({
      modality,
      searchText: primaryText,
      storageId: source.storageId,
      storageUrl: source.storageUrl,
      isPublic: source.isPublic,
      pillar: source.pillar,
    });
    const [existing, entry] = await Promise.all([
      writesLegacy
        ? ctx.runQuery(getExistingSemanticDocumentQueryRef, { sourceType: "asset", sourceId })
        : null,
      writesSplit ? ctx.runQuery(getSemanticEntryQueryRef, { assetId }) : null,
    ]) as [Infer<typeof semanticDocumentValidator> | null, SemanticEntry | null];
    const model = getSemanticEmbeddingModel();
    const dimensions = getSemanticEmbeddingDimensions();
    const textModel = getTextEmbeddingModel();

    // Text lane first. In dual storage a current legacy vector is copied to
    // the split lane instead of embedding the same words again.
    let textEmbedding: number[] | undefined;
    let textContentHash: string | undefined;
    let splitText: LaneWrite | undefined;
    const clearTextEmbedding = !textLane;
    if (textLane) {
      textContentHash = await legacyAssetTextHash({ model: textModel, dimensions, text: textLane });
      const splitTextHash = await textLaneHash({ model: textModel, text: textLane });
      const textUnchanged =
        existing?.textContentHash === textContentHash && Boolean(existing?.textEmbedding);
      const splitTextCurrent = Boolean(entry?.textVectorId) && entry?.textHash === splitTextHash;
      let values = textUnchanged ? existing?.textEmbedding : undefined;
      if ((writesLegacy && !textUnchanged) || (writesSplit && !splitTextCurrent && !values)) {
        values = await embedTextLane(textLane);
        if (writesLegacy) textEmbedding = values;
      }
      if (writesSplit && !splitTextCurrent && values) {
        splitText = { embedding: toStoredVector(values), hash: splitTextHash };
      }
    } else if (entry?.textVectorId) {
      splitText = null;
    }

    // Pixel lane.
    const shouldReuseEmbedding = Boolean(
      existing?.embedding &&
        existing.contentHash === contentHash &&
        existing.embeddingModel === model &&
        existing.embeddingDimensions === dimensions,
    );
    const splitPixelHash = shouldUseMultimodal
      ? await pixelLaneHash({ model, storageId: source.storageId, storageUrl: source.storageUrl })
      : undefined;
    const splitPixelCurrent = Boolean(entry?.pixelVectorId) && entry?.pixelHash === splitPixelHash;
    const splitNeedsPixel = writesSplit && shouldUseMultimodal && !splitPixelCurrent;
    let pixelValues = shouldUseMultimodal && shouldReuseEmbedding ? existing?.embedding : undefined;
    let embedding: number[] | undefined;
    let pixelError: string | undefined;
    if (((writesLegacy && !shouldReuseEmbedding) || (splitNeedsPixel && !pixelValues)) && !textOnly) {
      try {
        const parts: Array<Record<string, unknown>> =
          shouldUseMultimodal && source.storageUrl
            ? [await fetchInlineImagePart(source.storageUrl, source.contentType)]
            : [{ text: primaryText }];
        pixelValues = (await embedWithGemini(parts)).values;
        if (writesLegacy) embedding = pixelValues;
      } catch (error) {
        pixelError =
          error instanceof Error ? error.message : "Unknown pixel-lane embedding error.";
      }
    }
    let splitPixel: LaneWrite | undefined;
    if (!shouldUseMultimodal && entry?.pixelVectorId) {
      splitPixel = null;
    } else if (splitNeedsPixel && pixelValues) {
      splitPixel = { embedding: toStoredVector(pixelValues), hash: splitPixelHash };
    }

    const legacyHasLane =
      Boolean(embedding) ||
      shouldReuseEmbedding ||
      Boolean(existing?.embedding) ||
      Boolean(textEmbedding) ||
      Boolean(existing?.textEmbedding && !clearTextEmbedding);
    const keepsLane = (write: LaneWrite | undefined, current?: string) =>
      write === undefined ? Boolean(current) : write !== null;
    const splitHasLane =
      keepsLane(splitPixel, entry?.pixelVectorId) || keepsLane(splitText, entry?.textVectorId);
    if (!(writesLegacy && legacyHasLane) && !(writesSplit && splitHasLane)) {
      if (writesSplit && entry) {
        await ctx.runMutation(deleteSemanticEntryMutationRef, { assetId });
      }
      if (pixelError) throw new Error(pixelError);
      return { status: "skipped" as const, retryScheduled: false };
    }

    let semanticDocumentId: Id<"semanticDocuments"> | undefined;
    if (writesLegacy && legacyHasLane) {
      const legacyArgs = {
        ownerUserId: source.ownerUserId,
        sourceType: "asset" as const,
        sourceId,
        assetId,
        promptId: undefined,
        designInspirationId: undefined,
        pillar: source.pillar,
        isPublic: source.isPublic,
        kind: source.kind,
        modality,
        // A pending pixel lane keeps the previous hash, so the next reindex
        // still sees it as stale and retries it.
        searchText,
        contentHash: embedding ? contentHash : (existing?.contentHash ?? "pixel-pending"),
        embeddingModel: model,
        embeddingDimensions: dimensions,
        embedding,
        textEmbedding,
        textContentHash: clearTextEmbedding ? undefined : textContentHash,
        clearTextEmbedding,
        scopeKey: scopeFields.scopeKey,
        scopePillarKey: scopeFields.scopePillarKey,
        publicScopeKey: scopeFields.publicScopeKey,
        publicScopePillarKey: scopeFields.publicScopePillarKey,
        sourceUpdatedAt: source.sourceUpdatedAt,
      };
      semanticDocumentId = legacyUpsertChangesNothing(existing, legacyArgs)
        ? existing!._id
        : await ctx.runMutation(upsertSemanticDocumentMutationRef, legacyArgs);
    }
    if (writesSplit) {
      const splitWrite: SemanticEntryWrite = {
        ownerUserId: source.ownerUserId,
        assetId,
        pillar: source.pillar,
        isPublic: source.isPublic,
        modality,
        ...(splitPixel !== undefined ? { pixel: splitPixel } : {}),
        ...(splitText !== undefined ? { text: splitText } : {}),
      };
      if (entryWriteChangesSomething(entry, splitWrite)) {
        await ctx.runMutation(writeSemanticEntryMutationRef, splitWrite);
      }
    }

    if (pixelError) {
      // Text lane is saved; only the pixel lane waits for a retry.
      await ctx.runMutation(recordFailureMutationRef, {
        ownerUserId: source.ownerUserId,
        sourceType: "asset",
        sourceId,
        errorMessage: `pixel lane: ${pixelError}`,
      });
      return {
        status: "indexed" as const,
        semanticDocumentId,
        retryScheduled: await scheduleRetry(ctx, "asset", sourceId, attempt, textOnly),
      };
    }
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
      retryScheduled: await scheduleRetry(ctx, "asset", sourceId, attempt, textOnly),
    };
  }
};

const reindexPromptSource = async (
  ctx: ActionCtx,
  promptId: Id<"prompts">,
  attempt: number,
): Promise<ReindexResult> => {
  // Split storage keeps no prompt vectors: no search reads them.
  if (!isSemanticEmbeddingsEnabled() || semanticStorageMode() === "split") {
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

    const legacyArgs = {
      ownerUserId: source.ownerUserId,
      sourceType: "prompt" as const,
      sourceId,
      assetId: undefined,
      promptId,
      designInspirationId: undefined,
      pillar: source.pillar,
      isPublic: false,
      kind: undefined,
      modality: "text_only" as const,
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
    };
    const semanticDocumentId = legacyUpsertChangesNothing(existing, legacyArgs)
      ? existing!._id
      : await ctx.runMutation(upsertSemanticDocumentMutationRef, legacyArgs);
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
  // Split storage keeps no design-inspiration vectors: no search reads them.
  if (!isSemanticEmbeddingsEnabled() || semanticStorageMode() === "split") {
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

    const legacyArgs = {
      ownerUserId: source.ownerUserId,
      sourceType: "designInspiration" as const,
      sourceId,
      assetId: undefined,
      promptId: undefined,
      designInspirationId,
      pillar: source.pillar,
      isPublic: false,
      kind: undefined,
      modality: "text_only" as const,
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
    };
    const semanticDocumentId = legacyUpsertChangesNothing(existing, legacyArgs)
      ? existing!._id
      : await ctx.runMutation(upsertSemanticDocumentMutationRef, legacyArgs);
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

// A skill's markdown can run long; the text model reads ~2k tokens, so the
// lead of the document (title, description, tags, then the body) carries it.
const SKILL_TEXT_LANE_MAX_CHARS = 7_500;

export const buildSkillTextLane = (source: {
  title: string;
  description?: string;
  body?: string;
  agentInstructions?: string;
  tagNames: string[];
  stepLabels: string[];
  modelNames: string[];
}) =>
  compactSearchText([
    `skill: ${source.title}`,
    source.description,
    source.tagNames.length > 0 ? `tags: ${source.tagNames.join(", ")}` : undefined,
    source.modelNames.length > 0
      ? `models: ${source.modelNames.join(", ")}`
      : undefined,
    source.stepLabels.length > 0
      ? `steps: ${source.stepLabels.join(" / ")}`
      : undefined,
    source.body,
    source.agentInstructions,
  ]).slice(0, SKILL_TEXT_LANE_MAX_CHARS);

// Skills live in the text lane only: what a skill is about is in its words.
const reindexSkillSource = async (
  ctx: ActionCtx,
  skillId: Id<"skills">,
  attempt: number,
): Promise<ReindexResult> => {
  if (!isSemanticEmbeddingsEnabled()) {
    return { status: "skipped" as const, retryScheduled: false };
  }

  const storage = semanticStorageMode();
  const writesLegacy = storage !== "split";
  const writesSplit = storage !== "legacy";
  const source = await ctx.runQuery(getSkillSourceQueryRef, { skillId });
  const sourceId = String(skillId);
  if (!source) {
    if (writesSplit) await ctx.runMutation(deleteSemanticEntryMutationRef, { skillId });
    if (writesLegacy) {
      await ctx.runMutation(deleteSemanticDocumentMutationRef, {
        sourceType: "skill",
        sourceId,
      });
    }
    await ctx.runMutation(resolveFailureMutationRef, {
      sourceType: "skill",
      sourceId,
    });
    return { status: "deleted" as const, retryScheduled: false };
  }

  try {
    const searchText = buildSkillTextLane(source);
    const dimensions = getSemanticEmbeddingDimensions();
    const textModel = getTextEmbeddingModel();
    const textContentHash = await legacySkillTextHash({ model: textModel, dimensions, text: searchText });
    const splitTextHash = await textLaneHash({ model: textModel, text: searchText });
    const [existing, entry] = await Promise.all([
      writesLegacy
        ? ctx.runQuery(getExistingSemanticDocumentQueryRef, { sourceType: "skill", sourceId })
        : null,
      writesSplit ? ctx.runQuery(getSemanticEntryQueryRef, { skillId }) : null,
    ]) as [Infer<typeof semanticDocumentValidator> | null, SemanticEntry | null];
    const unchanged =
      existing?.textContentHash === textContentHash && Boolean(existing?.textEmbedding);
    const splitCurrent = Boolean(entry?.textVectorId) && entry?.textHash === splitTextHash;
    let values = unchanged ? existing?.textEmbedding : undefined;
    if ((writesLegacy && !unchanged) || (writesSplit && !splitCurrent && !values)) {
      values = await embedTextLane(searchText);
    }
    const scopeFields = buildScopeFields(
      source.ownerUserId,
      "skill",
      source.pillar,
      false,
    );

    let semanticDocumentId: Id<"semanticDocuments"> | undefined;
    if (writesLegacy) {
      const legacyArgs = {
        ownerUserId: source.ownerUserId,
        sourceType: "skill" as const,
        sourceId,
        skillId,
        pillar: source.pillar,
        isPublic: source.isPublic,
        modality: "text_only" as const,
        searchText,
        contentHash: textContentHash,
        embeddingModel: textModel,
        embeddingDimensions: dimensions,
        textEmbedding: unchanged ? undefined : values,
        textContentHash,
        scopeKey: scopeFields.scopeKey,
        scopePillarKey: scopeFields.scopePillarKey,
        sourceUpdatedAt: source.sourceUpdatedAt,
      };
      semanticDocumentId = legacyUpsertChangesNothing(existing, legacyArgs)
        ? existing!._id
        : await ctx.runMutation(upsertSemanticDocumentMutationRef, legacyArgs);
    }
    if (writesSplit) {
      const splitWrite: SemanticEntryWrite = {
        ownerUserId: source.ownerUserId,
        skillId,
        pillar: source.pillar,
        isPublic: source.isPublic,
        modality: "text_only",
        ...(!splitCurrent && values
          ? { text: { embedding: toStoredVector(values), hash: splitTextHash } }
          : {}),
      };
      if (entryWriteChangesSomething(entry, splitWrite)) {
        await ctx.runMutation(writeSemanticEntryMutationRef, splitWrite);
      }
    }
    await ctx.runMutation(resolveFailureMutationRef, {
      sourceType: "skill",
      sourceId,
    });
    return { status: "indexed" as const, semanticDocumentId, retryScheduled: false };
  } catch (error) {
    await ctx.runMutation(recordFailureMutationRef, {
      ownerUserId: source.ownerUserId,
      sourceType: "skill",
      sourceId,
      errorMessage:
        error instanceof Error ? error.message : "Unknown semantic skill index error.",
    });
    return {
      status: "skipped" as const,
      retryScheduled: await scheduleRetry(ctx, "skill", sourceId, attempt),
    };
  }
};

export const reindexSkill = internalAction({
  args: {
    skillId: v.id("skills"),
    attempt: v.optional(v.number()),
  },
  returns: reindexResultValidator,
  handler: async (ctx, args): Promise<ReindexResult> => {
    return await reindexSkillSource(ctx, args.skillId, args.attempt ?? 0);
  },
});

export const reindexAsset = internalAction({
  args: {
    assetId: v.id("assets"),
    attempt: v.optional(v.number()),
    textOnly: v.optional(v.boolean()),
  },
  returns: reindexResultValidator,
  handler: async (ctx, args): Promise<ReindexResult> => {
    return await reindexAssetSource(
      ctx,
      args.assetId,
      args.attempt ?? 0,
      args.textOnly === true,
    );
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
    // Assets only: refresh text lanes without touching the multimodal model.
    textOnly: v.optional(v.boolean()),
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
          ? await reindexAssetSource(ctx, id as Id<"assets">, 0, args.textOnly === true)
          : args.sourceType === "prompt"
            ? await reindexPromptSource(ctx, id as Id<"prompts">, 0)
            : args.sourceType === "skill"
              ? await reindexSkillSource(ctx, id as Id<"skills">, 0)
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
