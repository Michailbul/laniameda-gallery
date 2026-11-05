import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { getLegacySemanticDocumentsByIds, getSemanticDocumentsByIds } from "../convex/semanticIndex";
import { searchAssets } from "../convex/semanticSearch";
import { callAsOwner } from "./helpers/call-as-owner";
import { createMockConvexMutationCtx } from "./helpers/mock-convex-context";

const MiB = 1024 * 1024;
type QueryRead = { ids: string[]; fullDocuments: number; jsonBytes: number; metadataOnly: boolean };

describe("semantic legacy fallback query budgets", () => {
  let enabled: string | undefined;
  beforeEach(() => {
    enabled = process.env.SEMANTIC_EMBEDDINGS_ENABLED;
    process.env.SEMANTIC_EMBEDDINGS_ENABLED = "true";
  });
  afterEach(() => {
    if (enabled === undefined) delete process.env.SEMANTIC_EMBEDDINGS_ENABLED;
    else process.env.SEMANTIC_EMBEDDINGS_ENABLED = enabled;
  });

  async function runFixture(count: number, migrated: number, textLength = 2000) {
    const harness = createMockConvexMutationCtx();
    const ids: string[] = [];
    const embedding = Array.from({ length: 3072 }, (_, i) => i / 3072);
    const textEmbedding = Array.from({ length: 3072 }, (_, i) => (i + 1) / 3072);
    for (let index = 0; index < count; index += 1) {
      const id = await harness.db.insert("semanticDocuments", {
        ownerUserId: "owner", sourceType: "asset", sourceId: `assets:${index}`, assetId: `assets:${index}`,
        isPublic: true, kind: "image", modality: "multimodal_image", searchText: "s".repeat(textLength),
        contentHash: "pixel-hash", textContentHash: "text-hash", embeddingModel: "gemini-embedding-2-preview",
        embeddingDimensions: 3072, embedding, textEmbedding, scopeKey: "owner:owner:asset",
        publicScopeKey: "public:asset", sourceUpdatedAt: 1, createdAt: 1, updatedAt: 1,
      });
      ids.push(id);
      if (index < migrated) {
        const document = (await harness.db.get(id))!;
        await harness.db.insert("semanticDocumentIdentities", {
          semanticDocumentId: id, semanticDocumentCreationTime: document._creationTime,
          ownerUserId: "owner", sourceType: "asset", sourceId: `assets:${index}`, assetId: `assets:${index}`,
          isPublic: true, kind: "image", modality: "multimodal_image",
        });
      }
    }
    const reads: QueryRead[] = [];
    const hydratedIds: string[] = [];
    const split = Math.ceil(count / 2);
    const ctx = {
      vectorSearch: async (_table: string, lane: string) => (
        lane === "by_embedding" ? ids.slice(0, split) : ids.slice(split)
      ).map((_id, index) => ({ _id, _score: (lane === "by_embedding" ? 0.99 : 0.9) - index / 1000 })),
      runQuery: async (ref: Parameters<typeof getFunctionName>[0], args: {
        ids?: string[]; metadataOnly?: boolean; queryHash?: string;
        items?: Array<{ assetId: string; score: number }>;
      }) => {
        if (args.queryHash) return [0.1, 0.2, 0.3]; // No provider calls.
        if (args.items) return args.items.map(({ assetId, ...scores }) => {
          hydratedIds.push(assetId);
          return {
            _id: assetId, ...scores, kind: "image", isPublic: true, ownerUserId: "owner",
            tagIds: [], tagNames: assetId === `assets:${count - 1}` ? ["last-only"] : [], createdAt: 1,
          };
        });
        const read: QueryRead = { ids: args.ids ?? [], fullDocuments: 0, jsonBytes: 0, metadataOnly: args.metadataOnly === true };
        reads.push(read);
        const lookupCtx = {
          ...harness.ctx,
          db: {
            query: harness.db.query.bind(harness.db),
            get: async (id: string) => {
              const document = await harness.db.get(id);
              if (document) {
                read.fullDocuments += 1;
                read.jsonBytes += new TextEncoder().encode(JSON.stringify(document)).byteLength;
              }
              return document;
            },
          },
        };
        return getFunctionName(ref) === "semanticIndex:getLegacySemanticDocumentsByIds"
          ? callAsOwner(getLegacySemanticDocumentsByIds)(lookupCtx, args)
          : callAsOwner(getSemanticDocumentsByIds)(lookupCtx, args);
      },
    };
    const results = await callAsOwner(searchAssets)(ctx, {
      scope: "public", query: "example", mode: "hybrid", tagNames: ["last-only"], minRelativeScore: 0, limit: 100,
    });
    expect(reads[0]).toMatchObject({ metadataOnly: true, fullDocuments: 0, jsonBytes: 0 });
    expect(reads[0]?.ids).toEqual(ids);
    const fallbacks = reads.slice(1);
    expect(fallbacks.every((read) => read.ids.length <= 8 && read.fullDocuments <= 8)).toBe(true);
    expect(fallbacks.every((read) => read.jsonBytes < 8 * MiB)).toBe(true);
    expect(fallbacks.flatMap((read) => read.ids)).toEqual(ids.slice(migrated));
    expect(fallbacks.reduce((total, read) => total + read.fullDocuments, 0)).toBe(count - migrated);
    expect(new Set(hydratedIds).size).toBe(count); // Last candidate remains reachable.
    expect(results).toHaveLength(1);
    expect(results[0]?._id).toBe(`assets:${count - 1}`);
    expect(results[0]?.score).toBeCloseTo(61 / (2 * (60 + count - split)), 12);
    expect(results[0]?.textScore).toBeCloseTo(0.9 - (count - split - 1) / 1000, 12);
    return { reads, fallbacks };
  }

  for (const migrated of [0, 256, 512]) {
    test(`two disjoint 256-hit lanes stay complete with ${migrated}/512 identities migrated`, async () => {
      const { reads, fallbacks } = await runFixture(512, migrated);
      expect(reads).toHaveLength(1 + Math.ceil((512 - migrated) / 8));
      expect(fallbacks.every((read) => read.jsonBytes < MiB)).toBe(true);
    });
  }

  test("near-document-limit search text cannot push a fallback query past its byte budget", async () => {
    const { fallbacks } = await runFixture(17, 0, 900_000);
    expect(fallbacks.map((read) => read.fullDocuments)).toEqual([8, 8, 1]);
    expect(fallbacks[0]!.jsonBytes).toBeGreaterThan(7 * MiB);
    expect(fallbacks[0]!.jsonBytes).toBeLessThan(8 * MiB);
  });

  test("the server rejects oversized full-document batches before any read", async () => {
    let reads = 0;
    await expect(callAsOwner(getLegacySemanticDocumentsByIds)({ db: {
      get: async () => { reads += 1; return null; },
    } }, { ids: Array.from({ length: 9 }, (_, i) => `semanticDocuments:${i}`) })).rejects.toThrow("8 documents");
    expect(reads).toBe(0);
  });
});
