# Data model

What the gallery is made of, read from `convex/schema.ts`, `convex/validators.ts`,
`convex/menuFilters.ts`, `lib/collection-sections.ts` and `lib/medium.ts` on
26 Sep 2026. **The code is the source of truth.** When this file and the code
disagree, the code wins, and this file gets fixed in the same commit.

## The five ways a piece is found

An agent (or Michael) finds a piece through exactly these handles. Every save
should fill the ones that apply, because a handle left empty is a query that
can never hit.

| Handle | Where it lives | Set by |
|---|---|---|
| **Collection / folder** | `folders` + `assetFolders` | `folderIds` on save |
| **Piece type** | tag: `character`, `location`, `scene`, `inspiration` | `tagNames` / `typedTags` |
| **Medium** | tag: `animation` (absent = live action) | `tagNames` / `typedTags` |
| **Descriptive tags** | `tags` via `assetTags` / `promptTags`, typed by category | `typedTags` |
| **Pixels and words** | `semanticDocuments`: pixel lane `embedding` + text lane `textEmbedding` | automatic after ingest |

Plus the provenance fields that make a piece traceable: `sourceUrl`,
`agentDescription`, `description`, `modelName`, `ingestSource`, `assetRole`,
and the linked prompt.

## Agent description

`assets.agentDescription` (added 26 Sep 2026) is the agent-written account of a
piece: one or two sentences, normalized to 400 characters, on what it shows,
how it looks and why it was kept. It is separate from `description`, which is
Michael's own caption, so user metadata and agent-derived metadata never mix.

- `agentDescriptionSource`: `agent` (written at save time) or `auto` (the
  enrichment pass in `convex/agentDescriptions.ts`). `agentDescribedAt` is when.
- Written through `ingestFromApi` / `updateFromApi` (`agentDescription`),
  `assets:setAgentDescription` (won't overwrite an `agent` one without
  `overwrite: true`), or MCP `save_asset` / `update_gallery_item`.
- A repeat save (same `ingestKey` or bytes) fills a missing description and a
  missing `sourceUrl`, never overwrites either.
- Assets created without one get the automatic pass 3 s later when the
  deployment sets `AGENT_DESCRIPTIONS_ENABLED=true` (model
  `AGENT_DESCRIPTION_MODEL`, default `gemini-3.5-flash-lite`). It reads the card
  thumbnail, never overwrites an agent description, and retries rate limits.

## Semantic search: two lanes

Each asset has one `semanticDocuments` row with two embeddings, each from its
own model (3072 dims both):

- **Pixel lane** (`embedding`, index `by_embedding`, `gemini-embedding-2-preview`,
  multimodal): the image bytes only, so a text query finds what a picture looks
  like. Imageless assets (video) embed a short prompt/file-name text here.
- **Text lane** (`textEmbedding`, index `by_text_embedding`,
  `gemini-embedding-001` via `TEXT_EMBEDDING_MODEL`, task type
  `RETRIEVAL_DOCUMENT`): the asset's words from `buildAssetTextLane` in
  `convex/agentDescriptionText.ts`: agent description first, then caption,
  design title/summary, prompt (clipped to 2,500 chars), `tags: …`,
  `model: …`, `source: <domain>`.

**Why two models:** the multimodal model's quota is tiny (Vertex
`online_prediction_requests_per_base_model`; two requests in a row can 429),
while gemini-embedding-001 has its own, far larger quota. So the text lane is
written first and never waits on the pixel lane: when the pixel call 429s, the
row is still saved with its text lane (`embedding` may be absent) and only the
pixel lane retries. Before 26 Sep 2026 a 429 left the asset unsearchable; ~900
were stuck that way.

`semanticSearch:searchAssets` embeds the query per lane (pixel model, and
gemini-embedding-001 as `RETRIEVAL_QUERY`; both cached), searches both lanes
and merges them by reciprocal rank (k = 60), then applies filters while
hydrating. In hybrid mode a rate-limited pixel model degrades the search to the
text lane instead of failing it. `searchText` on the row holds the text lane, so
the `search_text` keyword index covers it as well.

## Pillars: legacy, leave unset

`pillar` still exists as a column on prompts, assets, tags, packs, workflows
and design inspirations, but it is a free string (`pillarValidator = v.string()`)
that nothing in the product navigates by any more. The values still in code are
`creators`, `designs`, `dump` and `cinema-inspiration`.

- Leave `pillar` unset on ordinary saves.
- Set it only where a contract requires it: `cinema-inspiration` frames, and
  workflow ingest, which validates `pillar` as required (use `creators`).
- `app/api/agent/customize` returns `Unsupported action` for pillar actions.
- The extension's wire field `collectionPillar` is grandfathered: it carries a
  **section** (Characters / Locations / Scenes / Inspirations), not a pillar.
  `lib/collection-sections.ts` renamed "collection pillars" to "sections" on
  27 Jul 2026.

When Michael says "pillar", he almost always means one of the four piece types
or one of the island-bar filters. Resolve it to those. Never write it into the
`pillar` column.

## Piece type (the four sections)

`lib/collection-sections.ts` defines four sections. Each is a tag on the asset:

| Section | Tag | Card badge |
|---|---|---|
| Characters | `character` | Character |
| Locations | `location` | Location |
| Scenes | `scene` (`still`/`stills` also map here) | Scene |
| Inspirations | `inspiration` | Inspiration |

A piece gets at most one of these. They are never folders:
`collectionCleanup:flattenSectionCollections` folds a sub-collection named
"Characters" etc. back into tags. The public world page sections a collection's
pieces by these tags.

## Medium

`lib/medium.ts`: a piece tagged `animation` is Animation; **everything else is
Live action.** There is no live-action tag to set. The match is exact after
normalisation: only `animation` counts. `animated`, `anime`, `2d` or `cartoon`
do NOT, and a piece carrying only those lands in Live action. Tag `animation`
for anything drawn, illustrated, stop-motion, clay, anime or 3D-animated (the
style words can sit alongside it); leave it off for photoreal and live-action
looks.

## Menu filters (the island bar)

`menuFilters` rows are the owner-curated pills on the main gallery menu; the raw
tag cloud never renders. Each pill is either:

- `kind: "tag"` with `tagNames` (matched canonically, so duplicate tag docs
  collapse), or
- `kind: "collection"` with a `folderId`.

Pills are Michael's navigation. An agent reads them to learn which tags matter
to him, and never creates or reorders them unless asked.

## Marks: star, featured, public, liked

- **Star = featured.** Since 23 Sep 2026 the card star and `isFeatured` move
  together. Starring publishes the piece onto the public featured reel;
  unstarring takes it off the reel and leaves it public. `starredAt` records
  when; `starNote` holds an optional note.
- **`isPublic`** exposes a piece on public surfaces. Showcasing a collection
  publishes the set, never its private members.
- **`isLiked`** is a separate private flag with its own mutation.
- **`tasteCollection`**: at most one collection per owner carries this. The
  public home's inspiration grid shows exactly its members.

Agents never set star, featured, public or taste flags unless Michael asks to
publish.

## Tags

- `tags` rows are global and deduped by `canonicalKey` (`canonicalTagKey(name)`);
  `aliases` hold alternate spellings.
- `userTags` is Michael's catalogue on top: label, description, colour, sort
  order, archive state. Read it with `list_tags` before inventing a tag.
- **Aliases**: `tags.aliases` redirect alternate spellings to one tag at save
  time (`filmic` → `cinematic`). A real tag name always wins over an alias.
  Add them with `tags:addTagAliases {name, aliases}` (MCP `add_tag_aliases`);
  aliases that are already tags are reported, not merged.
- A typed tag is `{name, category, source}`. `source` is `user`, `agent` or
  `system`. **Agent-derived tags use `source: "agent"`**, so Michael's own tags
  stay distinguishable from what an agent inferred.
- Matching goes through `canonicalTagKey`: lowercase, leading `#` dropped,
  `-`/`_` and punctuation become spaces. So `golden-hour`, `golden_hour` and
  `Golden Hour` are one tag. Plurals are NOT folded: `character` and
  `characters` are different keys (the section map accepts both, other tags
  don't). Convention: lowercase, singular, hyphenated (`golden-hour`).

## Collections and folders

Everything in the vault is a `folders` row. `folders.kind` is undefined (a
collection) or `"storybook"`. Nesting is one level deep through
`folders.parentFolderId`:

```
collection   root folder — a world when showcased (/w/<slug>)
└─ folder    sub-collection: one shot, a set of options, an inbox, drafts
```

- **collection** — a root folder. Showcasing it with
  `folders:setFolderShowcased` makes it a world and allocates `/w/<slug>`.
- **folder** — a sub-collection with `parentFolderId` set to a root
  collection. A folder never holds folders, and a storybook never nests.
- **what a piece IS** — a tag: `character`, `location`, `scene`,
  `inspiration`. Tag the asset; do not create a "Characters" folder.
  `collectionCleanup:flattenSectionCollections` folds section-named folders
  back into tags.

The public world page sections a collection's pieces by those tags
(Characters, Locations, Beats for `scene`) and treats a folder named for a
section as that section.

Naming convention: world collections are ALL CAPS (`CASSANDRA`, `DADDY ISSUES`).
Folder names are scoped to their parent, so "Balcony" can exist under several
collections.

## Validator quick reference

These are the valid enum values the Convex schema enforces — use these or ingest will fail:

**`modelProvider`:** `openai`, `anthropic`, `google`, `xai`, `meta`, `flux`, `midjourney`, `runway`, `other`
→ Use `other` for Kora Reality / Enhancor and any non-listed providers.

**`workflowType`:** `component_prompt`, `page_prompt`, `system_prompt`, `asset_recipe`, `other`

**`typedTags[].category`:** `model_name`, `style`, `content_type`, `platform`, `color`, `camera_angle`, `lighting`, `composition`, `car_make`, `car_model`, `car_angle`, `environment`, `design_style`, `design_type`, `workflow_type`, `component_type`, `custom`
→ No `subject` — use `content_type` instead.

**`promptSections` fields:** `finalPrompt` (required), `generationNotes` (optional), `negativePrompt` (optional)
→ No other keys — extra fields cause validation errors.

**`folders.kind`:** `storybook`
→ Undefined = a plain collection.

**`parentFolderId` nesting:** only a plain root collection may be a parent, and
only plain collections may be children. One level deep.

**`assetRole`:** `generated_output`, `reference`, `inspiration_capture`, `workflow_asset`, `cinema_frame`, `other`

**`ingestSource`:** `api`, `agent`, `telegram`, `manual`, `import`

**`generationType`:** `image_gen`, `video_gen`, `ui_design`, `workflow`, `other`

**`promptType`:** `image_gen`, `video_gen`, `ui_design`, `cinematic`, `ugc_ad`, `workflow`, `component_prompt`, `page_prompt`, `other`

**`typedTags[].source`:** `user`, `agent`, `system`

**Design inspiration (extension legacy):** `captureKind` `website|image|component|tutorial` · `saveIntent` `utility|inspiration|component|tutorial` · `inspirationType` `website|landing_page|dashboard|component|mobile_app|motion|branding|asset_pack|other` · `platform` `web|ios|android|cross_platform|other`

## Tables (ingest-facing)

- `prompts`
  - Key ingest fields: `ownerUserId`, `text`, `tagIds`, `ingestKey`, `pillar`, `promptType`, `workflowType`, `domain`, `modelName`, `modelProvider`, `promptSections`, `promptProfile`, `createdAt`.
  - Idempotency index: `by_owner_ingestKey`.

- `assets`
  - Key ingest fields: `ownerUserId`, `kind`, storage refs, `promptId`, `designInspirationId`, `tagIds`, `folderId`, `ingestKey`, `description`, `pillar`, `generationType`, `assetRole`, `ingestSource`, `createdAt`.
  - `folderId` remains the primary/legacy collection id. The backend also writes `assetFolders` membership rows so an asset can appear in multiple collections.
  - User-facing organization is collection-first. The authenticated agent API and MCP accept `folderIds` for multi-collection asset create/update, while the underlying Convex ingest action retains `folderId` for backward compatibility.
  - Idempotency index: `by_owner_ingestKey`.

- `folders`
  - Every collection and folder is a row here. There is no `collections` or `worlds` table. Projects, beats and episodes were retired on 22 Sep 2026.
  - Key fields: `ownerUserId`, `name`, `normalizedName`, `kind`, `parentFolderId`, `description`, `coverAssetId`, `shareToken`, `showcased`, `slug`, `showcaseFeatured`, `showcaseOrder`, `tasteCollection`, `pinnedAt`, `memberCount`.
  - `kind`: `storybook`; undefined = a plain collection.
  - `parentFolderId` nests one level only: a plain root collection is the parent and only plain collections may be children (`assertValidParent` in `convex/folders.ts`).
  - `memberCount` is denormalized; backend mutations recount via `recountFolderMembers`.
  - `showcased: true` publishes the folder as a world and allocates its stable `/w/<slug>` on first showcase (`folders:setFolderShowcased`). Folders inside a collection cannot be showcased.
  - Idempotency: `by_owner_normalizedName` — `createFolder` reuses an existing folder of the same normalized name.

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

## Validators to read in code

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
- `assetFolders`
  - The source of truth for collection membership. Reads are links-only; `assets.folderId` is just the primary pointer kept for backward compatibility.
  - `createAsset` writes the link from the ingest payload's `folderId`, so a single `folderId` is enough — do not follow an ingest with a separate add-membership call.
- `designInspirationTags`

These are maintained by backend mutations; callers usually pass tag names, typed tag inputs, or `folderId` instead of raw join rows.

## Runtime notes

- Local Claude/Codex agents should call `/api/agent/ingest` through the stdio MCP server. The app validates the agent token, derives `ownerUserId`, maps the first `folderIds` entry to the primary `folderId`, and syncs all requested asset collection memberships.
- `ingest:ingestFromApi` remains the canonical backend ingest action.
- Prompt-only ingests must set `allowPromptOnly: true`; mixed prompt+media ingests must not rely on implicit prompt creation alone. This applies across the maintained ingest surfaces, including the legacy agent-ingest path.
- `ingest:updateFromApi` is the canonical external update action. It supports both metadata updates and media operations.
  - **Prompt media attachment:** `target: "prompt"` + `file`/`url` creates a new asset linked to the prompt (or replaces media if the derived `assetIngestKey` already exists).
  - **Asset media replacement:** `target: "asset"` + `file`/`url` replaces the stored file, thumbnail, and file-related fields (kind, contentType, dimensions). Old storage blobs are cleaned up.
  - Both media operations accept `file` (base64 + fileName + contentType) or `url` (remote fetch). The `assetIngestKey` field overrides the default `${ingestKey}:img` key used when creating assets from prompt updates.
  - The authenticated agent update route additionally accepts `folderIds` for `target: "asset"` and replaces collection memberships after the canonical metadata update.
- The ingest contract now exposes the newer design-inspiration metadata fields for both create and update flows, so browser-extension-style saves can stay lossless.
- `ingest:deleteFromApi` is the canonical external delete action.
- Prompt-linked multi-asset variations are normalized into `assetPacks` automatically at the mutation layer.
- Legacy prompt groups can be backfilled with `assetPacks:consolidateOwnerPromptPacks`.
- `app/api/ingest/route.ts` maps session-authenticated browser calls to the same backend contract.
- `app/api/ingest/update/route.ts` and `app/api/ingest/delete/route.ts` expose session-authenticated update/delete routes.
- `app/api/agent/*` exposes token-authenticated MCP/agent routes; callers must not send or choose `ownerUserId`.
- `app/api/agent/customize` exposes token-authenticated customization for user tags and collections (folders). Pillar actions are retired and return `Unsupported action`.
- Semantic indexing is async after successful ingest; callers do not send embeddings or wait for indexing completion.
- Semantic search is available via `semanticSearch:searchAssets` (text query → matching assets) and `semanticSearch:findSimilarAssets` (image → visually similar images). Both use Gemini cross-modal embeddings and support post-filters for pillar, modelName, kind, assetRole, and folderId.
- Backfill existing records: `npx convex run semanticIndex:backfillBatch '{"sourceType": "asset", "batchSize": 25}'` (loop until `done: true`). Same for `"prompt"` and `"designInspiration"` source types.
