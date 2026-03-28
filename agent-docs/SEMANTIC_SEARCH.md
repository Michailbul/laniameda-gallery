# Semantic Search — Architecture & Implementation

Last updated: 2026-03-26

## Overview

The gallery uses **Gemini embeddings + Convex vector search** for semantic discovery. Every asset, prompt, and design inspiration gets embedded into a shared 3072-dimensional vector space. Users search by typing natural language or by finding visually similar assets.

## Embedding Model

- **Model**: `gemini-embedding-2-preview` (Google Generative AI)
- **Dimensions**: 3072 (configurable via `SEMANTIC_EMBEDDING_DIMENSIONS`)
- **API**: `generativelanguage.googleapis.com/v1beta/models/{model}:embedContent`
- **Auth**: `x-goog-api-key` header with `GEMINI_API_KEY`

## Embedding Strategy — Pure Modality, No Metadata Dilution

The system deliberately avoids mixing text metadata into image embeddings. Gemini's cross-modal matching handles text→image queries natively.

| Source has image? | What gets embedded | Modality | searchText field |
|---|---|---|---|
| Yes (image bytes available) | Raw image bytes only | `multimodal_image` | `"[image]"` (placeholder) |
| No (text-only fallback) | Prompt text or filename | `text_only` | Compacted metadata string |

**Why no AI captions?** The visual embedding already captures what the image contains. The prompt text (stored in `prompts` table) captures intent. Adding generated captions would be redundant — a noisier version of what the visual embedding already knows.

## Content Hash & Embedding Reuse

Each semantic document has a SHA256 `contentHash` derived from:
```
{ v: "pure-v1", modality, searchText, storageId, isPublic, pillar }
```

On reindex, if the hash + model + dimensions match the existing document, the embedding is **reused** (zero API cost). The hash version prefix (`pure-v1`) can be bumped to force re-embedding all documents on backfill.

## Tables

### `semanticDocuments` — the vector index

| Field | Purpose |
|---|---|
| `ownerUserId` | Multi-tenant isolation |
| `sourceType` | `asset` \| `prompt` \| `designInspiration` |
| `sourceId`, `assetId`, `promptId`, `designInspirationId` | Back-references to source |
| `pillar` | Optional pillar scope |
| `isPublic` | Public gallery visibility |
| `modality` | `multimodal_image` \| `text_only` |
| `searchText` | `"[image]"` for images, compacted text for text-only |
| `contentHash` | SHA256 for change detection |
| `embedding` | float64[3072] — the vector |
| `embeddingModel`, `embeddingDimensions` | Model provenance |
| `scopeKey`, `scopePillarKey` | Private scope filter keys (`owner:{userId}:{sourceType}[:pillar]`) |
| `publicScopeKey`, `publicScopePillarKey` | Public scope filter keys (`public:asset[:pillar]`) |

**Vector index**: `by_embedding` — filters on `ownerUserId`, `sourceType`, `pillar`, `isPublic`, `scopeKey`, `publicScopeKey`, `scopePillarKey`, `publicScopePillarKey`.

### `semantic_index_failures` — retry tracking

Records failed indexing attempts with exponential backoff: 30s → 5min → 30min.

## Two Search Modes

### `searchAssets` — text query search

```
User types text → embedQuery() via Gemini API → vectorSearch → dedupe → score cutoff → hydrate
```

- **Input**: text query string
- **Scope**: `mine` (owner-filtered) or `public`
- **Post-filters**: folder, modelName, assetRole, kind
- **Score cutoff**: 0.85 relative (drop results below 85% of top score)
- **Limit**: default 24, max 100, fetches up to 256 candidates

### `findSimilarAssets` — visual similarity

```
Source asset → lookup its stored embedding → vectorSearch with that vector → dedupe → score cutoff → hydrate
```

- **Input**: existing asset ID
- **No API call** — reuses the asset's already-stored embedding
- **Excludes the source asset** from results
- **Same scope filtering** as searchAssets

## Indexing Flow

```
Asset/prompt/design created or updated
    ↓
Mutation calls ctx.scheduler.runAfter(0, reindexAction)
    ↓
Action fetches source data (with related prompt, tags, storage URL)
    ↓
Determines modality (image with storageUrl → multimodal, else → text)
    ↓
Computes contentHash — checks if reindex needed
    ↓
If new hash: call Gemini embedding API, upsert semanticDocument
If same hash: reuse existing embedding (zero cost)
    ↓
On error: record in semantic_index_failures with retry schedule
```

Reindex triggers in `assets.ts`: `createAsset`, `updateAsset`, `moveAssetToFolder`, `updateAssetMetadata`, `setAssetPublicStatus`.

## UI Integration

| Feature | Component | Action called |
|---|---|---|
| **Search dock** (bottom bar) | `components/v8/dashboard.tsx` + `components/ui/expanding-search-dock.tsx` | `semanticSearch:searchAssets` |
| **"FIND SIMILAR" button** | `components/v8/detail-panel.tsx` (actions tab) | `semanticSearch:findSimilarAssets` |
| **Tag search** (filter bar) | `components/v8/filter-bar.tsx` | Client-side filter only (no embeddings) |

Search dock behavior: debounces 300ms, requires ≥3 chars, replaces grid with semantic results. Shows "Similar Results" banner when in findSimilar mode.

## API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/semantic/search` | POST | Semantic search (query, scope, filters) |
| `/api/semantic/similar` | POST | Find similar assets by assetId |

## Environment Variables

```bash
# Required for semantic search
SEMANTIC_EMBEDDINGS_ENABLED=true          # master kill switch
GEMINI_API_KEY=...                        # Gemini API key (≥10 chars)

# Optional tuning
SEMANTIC_EMBEDDING_MODEL=gemini-embedding-2-preview   # default
SEMANTIC_EMBEDDING_DIMENSIONS=3072                     # default
SEMANTIC_SEARCH_LIMIT_DEFAULT=24                       # default
```

## Key Files

| File | Purpose |
|---|---|
| `convex/semanticIndex.ts` | Indexing logic, embedding calls, reindex actions, failure tracking |
| `convex/semanticSearch.ts` | Search actions (searchAssets, findSimilarAssets) |
| `convex/galleryAssetResults.ts` | Hydrates scored results with full asset metadata |
| `app/api/semantic/search/route.ts` | Next.js API wrapper for search |
| `app/api/semantic/similar/route.ts` | Next.js API wrapper for similar |
| `tests/semantic-search.test.ts` | Vector search tests |

## Discovery Layers (full picture)

| Layer | Mechanism | Coverage |
|---|---|---|
| **Vector search** | Gemini embeddings → Convex vector index | All 3 source types (assets, prompts, designs) |
| **Full-text search** | Convex searchIndex on `searchText`/`text` | Prompts + designInspirations only |
| **Tag filtering** | Junction tables + client-side multi-select | All content |
| **Structured filters** | Folder, pillar, modelName, assetRole, kind | All assets |
| **Sort** | createdAt, featured, popular | All content |

## Future Opportunities

- **Auto-tagging on ingest** — use nearest neighbors to inherit tags (planned)
- **Smart clustering** — auto-generate collections from embedding space (backlog: ORG-006)
- **Cross-pillar discovery** — surface related content across pillars
- **Semantic dedup** — flag near-duplicate assets by cosine similarity
