// Where semantic vectors live, and the pure helpers the index, the search and
// the migration share. No Convex runtime imports, so tests can use them too.
//
// Two layouts exist while the gallery moves between them:
//   semanticDocuments (legacy): one row per source holding BOTH lanes at the
//     provider's dimensions (3072 floats each, ~56 KB a row). Any read of the
//     row — reindex, similarity source, audit — pays for both vectors.
//   split: one slim semanticEntries row per asset or Skill (~0.4 KB) that maps
//     a vector hit to its source and holds the lane hashes, plus one row per
//     lane in semanticPixelVectors / semanticTextVectors (768 floats, ~7 KB).
//
// SEMANTIC_STORAGE picks the layout:
//   legacy (default) - read and write semanticDocuments, as before.
//   dual             - write both layouts, read semanticDocuments. Run the
//                      migration in this mode, then compare with the eval.
//   split            - read and write the split tables only.
export type SemanticStorageMode = "legacy" | "dual" | "split";

export const semanticStorageMode = (): SemanticStorageMode => {
  const mode = process.env.SEMANTIC_STORAGE?.trim().toLowerCase();
  return mode === "dual" || mode === "split" ? mode : "legacy";
};

// Gemini embeddings are Matryoshka-trained: a prefix of the vector is a
// smaller embedding of the same content (Google publishes MTEB 67.99 at 768
// against 68.17 at 1536 for gemini-embedding-001). Every split vector is the
// L2-normalized first SEMANTIC_VECTOR_DIMENSIONS values of the provider's
// output, whether it was embedded now or copied from a legacy row, so both
// sources land in the same space.
export const SEMANTIC_VECTOR_DIMENSIONS = 768;

export const toStoredVector = (values: number[]) => {
  if (values.length < SEMANTIC_VECTOR_DIMENSIONS) {
    throw new Error(
      `Embedding has ${values.length} values; split storage keeps the first ${SEMANTIC_VECTOR_DIMENSIONS}. ` +
        `Keep SEMANTIC_EMBEDDING_DIMENSIONS at ${SEMANTIC_VECTOR_DIMENSIONS} or more.`,
    );
  }
  const prefix = values.slice(0, SEMANTIC_VECTOR_DIMENSIONS);
  const norm = Math.sqrt(prefix.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) {
    throw new Error("Cannot store an all-zero embedding.");
  }
  return prefix.map((value) => value / norm);
};

export const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

// Split lane hashes. A lane is re-embedded only when its hash changes: pixels
// when the stored image or the model changes, words when the text or the
// model changes. Visibility and pillar are scope, patched without embedding.
export const pixelLaneHash = (input: { model: string; storageId?: string; storageUrl?: string }) =>
  sha256Hex(JSON.stringify({
    v: "pixel-split-v1",
    model: input.model,
    dimensions: SEMANTIC_VECTOR_DIMENSIONS,
    storageId: input.storageId,
    storageUrl: input.storageUrl,
  }));

export const textLaneHash = (input: { model: string; text: string }) =>
  sha256Hex(JSON.stringify({
    v: "text-split-v1",
    model: input.model,
    dimensions: SEMANTIC_VECTOR_DIMENSIONS,
    text: input.text,
  }));

// The semanticDocuments hashes, byte for byte. The migration recomputes them
// to prove a stored legacy vector still matches its source before copying it.
export const legacyPixelHash = (input: {
  modality: string;
  searchText: string;
  storageId?: string;
  storageUrl?: string;
  isPublic: boolean;
  pillar?: string;
}) =>
  sha256Hex(JSON.stringify({
    v: "pure-v1",
    modality: input.modality,
    searchText: input.searchText,
    storageId: input.storageId,
    storageUrl: input.storageUrl,
    isPublic: input.isPublic,
    pillar: input.pillar,
  }));

export const legacyAssetTextHash = (input: { model: string; dimensions: number; text: string }) =>
  sha256Hex(JSON.stringify({ v: "text-lane-v2", model: input.model, dimensions: input.dimensions, text: input.text }));

export const legacySkillTextHash = (input: { model: string; dimensions: number; text: string }) =>
  sha256Hex(JSON.stringify({ v: "skill-v1", model: input.model, dimensions: input.dimensions, text: input.text }));

// Vector-index filter keys. Convex vector filters only OR equalities, so the
// owner, source type, pillar and visibility are folded into single keys.
export const buildScopeFields = (
  ownerUserId: string,
  sourceType: "asset" | "prompt" | "designInspiration" | "skill",
  pillar: string | undefined,
  isPublic: boolean,
) => {
  const scopeKey = `owner:${ownerUserId}:${sourceType}`;
  const scopePillarKey = pillar ? `owner:${ownerUserId}:${sourceType}:${pillar}` : undefined;
  if (sourceType !== "asset" || !isPublic) {
    return { scopeKey, scopePillarKey, publicScopeKey: undefined, publicScopePillarKey: undefined };
  }
  return {
    scopeKey,
    scopePillarKey,
    publicScopeKey: "public:asset",
    publicScopePillarKey: pillar ? `public:asset:${pillar}` : undefined,
  };
};

// Bytes Convex counts for a value (convex-backend crates/value): null and
// booleans 1, numbers 9, strings length + 2, arrays 2 + items, objects 2 +
// each field's name + 1 + value. Used to turn row counts into read estimates.
export const convexValueSize = (value: unknown): number => {
  if (value === undefined) return 0;
  if (value === null || typeof value === "boolean") return 1;
  if (typeof value === "number" || typeof value === "bigint") return 9;
  if (typeof value === "string") return new TextEncoder().encode(value).length + 2;
  if (value instanceof ArrayBuffer) return value.byteLength + 2;
  if (Array.isArray(value)) {
    return value.reduce((sum: number, item) => sum + convexValueSize(item), 2);
  }
  if (typeof value === "object") {
    let size = 2;
    for (const [name, field] of Object.entries(value as Record<string, unknown>)) {
      if (field !== undefined) size += name.length + 1 + convexValueSize(field);
    }
    return size;
  }
  return 0;
};
