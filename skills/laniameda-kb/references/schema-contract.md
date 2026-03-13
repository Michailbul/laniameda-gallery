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
- `app/api/ingest/route.ts` maps session-authenticated browser calls to the same backend contract.
- Semantic indexing is async after successful ingest; callers do not send embeddings or wait for indexing completion.
