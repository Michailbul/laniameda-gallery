# Schema contract (ingest-focused)

Use `convex/schema.ts` as source of truth. This file is the quick ingest map for agents and runtime skill maintenance.

## Core tables

- `prompts`
  - Key ingest fields: `ownerUserId`, `text`, `tagIds`, `ingestKey`, `pillar`, `promptType`, `workflowType`, `domain`, `modelName`, `modelProvider`, `promptSections`, `promptProfile`, `createdAt`.
  - Idempotency index: `by_owner_ingestKey`.

- `assets`
  - Key ingest fields: `ownerUserId`, `kind`, storage refs, `promptId`, `designInspirationId`, `tagIds`, `folderId`, `ingestKey`, `pillar`, `generationType`, `assetRole`, `ingestSource`, `createdAt`.
  - Idempotency index: `by_owner_ingestKey`.

- `designInspirations`
  - Use for non-prompt design references.
  - Key ingest fields: `ownerUserId`, `pillar: "designs"`, `title`, `summary`, `sourceUrl`, `sourceDomain`, `inspirationType`, `platform`, `workflowType`, `tagIds`, `folderId`, `ingestKey`, optional links to `assetId` and `promptId`.
  - Idempotency index: `by_owner_ingestKey`.

- `semanticDocuments`
  - Async search index rows generated from assets, prompts, and design inspirations.
  - Backend-managed fields include `sourceType`, `sourceId`, linked record IDs, `searchText`, `contentHash`, embedding data, and owner/public scope keys.
  - **Embedding strategy (pure-v1):** Image assets are embedded as image-only (no text metadata) using Gemini `gemini-embedding-2-preview` multimodal embeddings. Prompt sources are embedded as prompt text only (no tags/pillar/model metadata). This lets cross-modal matching work natively — a text query like "car" matches images that visually contain cars. Tags and metadata are applied as post-filters, not embedded.

- `semantic_index_failures`
  - Backend-managed retry/failure rows for semantic indexing failures.

- `tags`
  - Normalized tags with metadata: `category`, `pillar`, `source`.
  - Created/upserted through `tags:getOrCreateTagsWithMetadata` when metadata is known.

## Important validators

See `convex/validators.ts`:

- `optionalPillarValidator`
- `promptTypeValidator`
- `generationTypeValidator`
- `workflowTypeValidator`
- `modelProviderValidator`
- `promptProfileValidator`
- `tagCategoryValidator`, `tagSourceValidator`, `typedTagInputValidator`
- `designInspirationTypeValidator`, `designPlatformValidator`
- `assetRoleValidator`, `ingestSourceValidator`

## Join tables

- `promptTags`
- `assetTags`
- `designInspirationTags`

These are maintained by backend mutations; callers usually pass tag names or typed tag inputs instead of raw join rows.

## Runtime notes

- `ingest:ingestFromApi` is the canonical external ingest action.
- Prompt-only ingests must set `allowPromptOnly: true`; mixed prompt+media ingests must not rely on implicit prompt creation alone. This applies across the maintained ingest surfaces, including the legacy agent-ingest path.
- `ingest:updateFromApi` is the canonical external metadata update action.
- `ingest:deleteFromApi` is the canonical external delete action.
- `app/api/ingest/route.ts` maps session-authenticated browser calls to the same backend contract.
- `app/api/ingest/update/route.ts` and `app/api/ingest/delete/route.ts` expose session-authenticated update/delete routes.
- Semantic indexing is async after successful ingest; callers do not send embeddings or wait for indexing completion.
- Semantic search is available via `semanticSearch:searchAssets` (text query → matching assets) and `semanticSearch:findSimilarAssets` (image → visually similar images). Both use Gemini cross-modal embeddings and support post-filters for pillar, modelName, kind, assetRole, and folderId.
- Backfill existing records: `npx convex run semanticIndex:backfillBatch '{"sourceType": "asset", "batchSize": 25}'` (loop until `done: true`). Same for `"prompt"` and `"designInspiration"` source types.
