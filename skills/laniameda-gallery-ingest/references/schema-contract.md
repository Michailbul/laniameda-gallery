# Schema contract (ingest-focused)

Use `convex/schema.ts` as source of truth. This file is the quick ingest map for agents and runtime skill maintenance.

## Core tables

- `prompts`
  - Key ingest fields: `ownerUserId`, `text`, `tagIds`, `ingestKey`, `pillar`, `promptType`, `workflowType`, `domain`, `modelName`, `modelProvider`, `promptSections`, `promptProfile`, `createdAt`.
  - Idempotency index: `by_owner_ingestKey`.

- `assets`
  - Key ingest fields: `ownerUserId`, `kind`, storage refs, `promptId`, `designInspirationId`, `tagIds`, `folderId`, `ingestKey`, `description`, `pillar`, `generationType`, `assetRole`, `ingestSource`, `createdAt`.
  - Idempotency index: `by_owner_ingestKey`.

- `designInspirations`
  - Legacy/internal browser-extension structure for older design-specific saves.
  - Local MCP agents should not create new rows here. Save UI/design references as normal `assets` and classify them with tags.
  - Key ingest fields: `ownerUserId`, `pillar: "designs"`, `title`, `summary`, `sourceUrl`, `sourceDomain`, `sourceTitle`, `userNote`, `inspirationType`, `platform`, `workflowType`, `captureKind`, `saveIntent`, `templateKey`, `sourceFingerprint`, `status`, `tagIds`, `folderId`, `ingestKey`, optional links to `assetId` and `promptId`.
  - Idempotency index: `by_owner_ingestKey`.

- `designSaveTemplates`
  - Owner-scoped default metadata for browser-extension design saves.
  - Not used by the ingest script today, but part of the shared backend schema.

- `generationLineage`
  - Structured upstream dependencies between prompts/assets. Use when a generation was produced from an earlier prompt or asset (e.g. a Seedance 2 video generated from a GPT-Image-2 starting frame).
  - Fields: `ownerUserId`, `targetPromptId`/`targetAssetId` (exactly one), `sourcePromptId`/`sourceAssetId` (exactly one), `role`, `stageOrder`, `notes`, `createdAt`.
  - Idempotent on the tuple (owner, target*, source*, role). Re-ingest with the same upstream does not create duplicates.
  - Populated by `ingest:ingestFromApi` via `upstreamInputs`. Cleaned up automatically when the target or source prompt/asset is deleted.

- `semanticDocuments`
  - Async search index rows generated from assets, prompts, and legacy design inspirations.
  - Backend-managed fields include `sourceType`, `sourceId`, linked record IDs, `searchText`, `contentHash`, embedding data, and owner/public scope keys.
  - **Embedding strategy (pure-v1):** Image assets are embedded as image-only (no text metadata) using Gemini `gemini-embedding-2-preview` multimodal embeddings. Prompt sources are embedded as prompt text only (no tags/pillar/model metadata). This lets cross-modal matching work natively — a text query like "car" matches images that visually contain cars. Tags and metadata are applied as post-filters, not embedded.

- `semantic_index_failures`
  - Backend-managed retry/failure rows for semantic indexing failures.

- `agentTokens`
  - Per-user bearer tokens for MCP/agent access.
  - Stores `ownerUserId`, `tokenHash`, `tokenPrefix`, `label`, `scopes`, expiry/revocation/use timestamps.
  - Raw token secrets are returned once by `/api/agent/tokens` and are never stored.

- `tags`
  - Normalized tags with metadata: `category`, `pillar`, `source`.
  - Created/upserted through `tags:getOrCreateTagsWithMetadata` when metadata is known.

- `userTags`
  - Owner-scoped tag catalog for a user's page and agent workflows.
  - Points at canonical `tags` rows while storing user-specific label, description, color, sort order, pillar/category defaults, and archive state.
  - Managed externally through `/api/agent/customize`; content rows still attach canonical `tagIds`.

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
- `lineageRoleValidator` — enum: `starting_image_prompt`, `starting_image_asset`, `style_reference`, `motion_reference`, `upscale_source`, `variation_source`, `edit_source`, `other`

## Join tables

- `promptTags`
- `assetTags`
- `designInspirationTags`

These are maintained by backend mutations; callers usually pass tag names or typed tag inputs instead of raw join rows.

## Runtime notes

- Local Claude/Codex agents should call `/api/agent/ingest` through the stdio MCP server. The app validates the agent token and derives `ownerUserId` before calling `ingest:ingestFromApi`.
- `ingest:ingestFromApi` remains the canonical backend ingest action.
- Prompt-only ingests must set `allowPromptOnly: true`; mixed prompt+media ingests must not rely on implicit prompt creation alone. This applies across the maintained ingest surfaces, including the legacy agent-ingest path.
- `ingest:updateFromApi` is the canonical external update action. It supports both metadata updates and media operations.
  - **Prompt media attachment:** `target: "prompt"` + `file`/`url` creates a new asset linked to the prompt (or replaces media if the derived `assetIngestKey` already exists).
  - **Asset media replacement:** `target: "asset"` + `file`/`url` replaces the stored file, thumbnail, and file-related fields (kind, contentType, dimensions). Old storage blobs are cleaned up.
  - Both media operations accept `file` (base64 + fileName + contentType) or `url` (remote fetch). The `assetIngestKey` field overrides the default `${ingestKey}:img` key used when creating assets from prompt updates.
- The ingest contract now exposes the newer design-inspiration metadata fields for both create and update flows, so browser-extension-style saves can stay lossless.
- `ingest:deleteFromApi` is the canonical external delete action.
- Prompt-linked multi-asset variations are normalized into `assetPacks` automatically at the mutation layer.
- Legacy prompt groups can be backfilled with `assetPacks:consolidateOwnerPromptPacks`.
- `app/api/ingest/route.ts` maps session-authenticated browser calls to the same backend contract.
- `app/api/ingest/update/route.ts` and `app/api/ingest/delete/route.ts` expose session-authenticated update/delete routes.
- `app/api/agent/*` exposes token-authenticated MCP/agent routes; callers must not send or choose `ownerUserId`.
- `app/api/agent/customize` exposes token-authenticated customization for user pillars, user tags, and folders.
- Semantic indexing is async after successful ingest; callers do not send embeddings or wait for indexing completion.
- Semantic search is available via `semanticSearch:searchAssets` (text query → matching assets) and `semanticSearch:findSimilarAssets` (image → visually similar images). Both use Gemini cross-modal embeddings and support post-filters for pillar, modelName, kind, assetRole, and folderId.
- Backfill existing records: `npx convex run semanticIndex:backfillBatch '{"sourceType": "asset", "batchSize": 25}'` (loop until `done: true`). Same for `"prompt"` and `"designInspiration"` source types.
