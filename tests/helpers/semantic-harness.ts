// End-to-end harness for semantic indexing and search: the real Convex
// handlers run against the in-memory mock database, ctx.runQuery/runMutation
// dispatch by function name, vector search is an exact cosine scan over the
// mock tables, and Gemini is a fetch stub that turns keywords into vectors.
import { getFunctionName } from "convex/server";
import * as galleryAssetResults from "../../convex/galleryAssetResults";
import * as semanticIndex from "../../convex/semanticIndex";
import * as semanticSearch from "../../convex/semanticSearch";
import { callAsOwner } from "./call-as-owner";
import { createMockConvexMutationCtx } from "./mock-convex-context";

export const OWNER = "278674008";
const MODULES: Record<string, Record<string, unknown>> = { galleryAssetResults, semanticIndex, semanticSearch };

// Keyword concepts live in the first values, inside the 768-value prefix the
// split tables keep, so legacy and split vectors rank alike.
const CONCEPTS = ["gothic", "deco", "neon", "flower", "romance", "cyberpunk", "dusk", "interior", "street", "night", "rare"];
const FULL_DIMENSIONS = 3072;
export const conceptVector = (text: string) => {
  const values = new Array<number>(FULL_DIMENSIONS).fill(0);
  const lower = text.toLowerCase();
  CONCEPTS.forEach((concept, index) => {
    if (lower.includes(concept)) values[index] = 1;
  });
  values[30] = 0.3;
  values[FULL_DIMENSIONS - 1] = 0.01;
  return values;
};

const VECTOR_FIELDS: Record<string, Record<string, string>> = {
  semanticDocuments: { by_embedding: "embedding", by_text_embedding: "textEmbedding" },
  semanticPixelVectors: { by_embedding: "embedding" },
  semanticTextVectors: { by_embedding: "embedding" },
};

const cosine = (left: number[], right: number[]) => {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftNorm += left[index]! ** 2;
    rightNorm += right[index]! ** 2;
  }
  return dot / Math.sqrt(leftNorm * rightNorm);
};

type Doc = Record<string, unknown> & { _id: string };
type Filter = (doc: Doc) => boolean;

export const createSemanticHarness = () => {
  const harness = createMockConvexMutationCtx();
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const vectorSearches: Array<{ table: string; index: string; limit: number }> = [];
  const providerCalls: Array<{ model: string; text: string }> = [];
  const scheduled: Array<{ name: string; args: Record<string, unknown> }> = [];
  const stubs = new Map<string, (args: Record<string, unknown>) => unknown>();

  const dispatch = async (ref: unknown, args: Record<string, unknown> = {}) => {
    const name = getFunctionName(ref as never);
    calls.push({ name, args });
    const stub = stubs.get(name);
    if (stub) return stub(args);
    const [module, exportName] = name.split(":");
    const fn = MODULES[module!]?.[exportName!];
    if (!fn) throw new Error(`No handler for ${name}`);
    return callAsOwner(fn as never)(ctx, args);
  };

  const ctx = {
    ...harness.ctx,
    auth: { getUserIdentity: async () => ({ subject: OWNER }) },
    runQuery: dispatch,
    runMutation: dispatch,
    runAction: dispatch,
    scheduler: {
      runAfter: async (_delay: number, ref: unknown, args: Record<string, unknown>) => {
        scheduled.push({ name: getFunctionName(ref as never), args });
        return null;
      },
    },
    vectorSearch: async (table: string, index: string, options: {
      vector: number[];
      limit: number;
      filter: (q: { eq: (field: string, value: unknown) => Filter; or: (...filters: Filter[]) => Filter }) => Filter;
    }) => {
      vectorSearches.push({ table, index, limit: options.limit });
      const field = VECTOR_FIELDS[table]?.[index];
      if (!field) throw new Error(`No vector index ${table}.${index}`);
      const matches = options.filter({
        eq: (name, value) => (doc) => doc[name] === value,
        or: (...filters) => (doc) => filters.some((filter) => filter(doc)),
      });
      return (harness.db.getTableDocs(table) as Doc[])
        .filter((doc) => Array.isArray(doc[field]) && (doc[field] as number[]).length === options.vector.length && matches(doc))
        .map((doc) => ({ _id: doc._id, _score: cosine(doc[field] as number[], options.vector) }))
        .sort((left, right) => right._score - left._score)
        .slice(0, options.limit);
    },
  };

  const originalFetch = globalThis.fetch;
  const env = {
    SEMANTIC_EMBEDDINGS_ENABLED: "true",
    GEMINI_API_KEY: "test-semantic-key",
    R2_PUBLIC_BASE_URL: "https://cdn.example",
  };
  const previousEnv = Object.fromEntries(
    [...Object.keys(env), "SEMANTIC_STORAGE", "SEMANTIC_EMBEDDING_DIMENSIONS"].map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, env);
  delete process.env.SEMANTIC_EMBEDDING_DIMENSIONS;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://cdn.example/")) {
      return new Response(new TextEncoder().encode(url), { headers: { "content-type": "image/png" } });
    }
    const model = /models\/([^:]+):embedContent/.exec(url)?.[1];
    if (!model) return new Response("not found", { status: 404 });
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      content: { parts: Array<{ text?: string; inline_data?: { data: string } }> };
    };
    const part = body.content.parts[0]!;
    const text = part.text ?? Buffer.from(part.inline_data!.data, "base64").toString("utf8");
    providerCalls.push({ model, text });
    return Response.json({ embedding: { values: conceptVector(text) } });
  }) as typeof fetch;

  const restore = () => {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };

  const setStorage = (mode: "legacy" | "dual" | "split") => {
    process.env.SEMANTIC_STORAGE = mode;
  };

  const addTag = async (name: string) =>
    await harness.db.insert("tags", { name, normalized: name, canonicalKey: name, usageCount: 1, category: "style", source: "user" });

  const addAsset = async (fields: Record<string, unknown>) =>
    await harness.db.insert("assets", {
      ownerUserId: OWNER, kind: "image", contentType: "image/png", tagIds: [], isPublic: false, createdAt: 1, ...fields,
    });

  const reindexAsset = async (assetId: string, extra: Record<string, unknown> = {}) =>
    await callAsOwner(semanticIndex.reindexAsset)(ctx, { assetId, ...extra });

  const callsNamed = (name: string) => calls.filter((call) => call.name === name);

  const reset = () => {
    calls.length = 0;
    vectorSearches.length = 0;
    providerCalls.length = 0;
    scheduled.length = 0;
  };

  return {
    ctx, db: harness.db, calls, vectorSearches, providerCalls, scheduled, stubs,
    restore, setStorage, addTag, addAsset, reindexAsset, callsNamed, reset,
  };
};

export type SemanticHarness = ReturnType<typeof createSemanticHarness>;
