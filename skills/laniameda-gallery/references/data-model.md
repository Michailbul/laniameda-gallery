# Data model

Midjourney sref libraries use normal collections and existing media/bookmarks.
Explicit text recipes use prompts with domain `midjourney-sref`, promptType
`other`, workflowType `asset_recipe` and modelProvider `midjourney`. `promptSections.finalPrompt` is the
normalized --sref recipe including stated --sw/--sv/--v; generationNotes is JSON
with optional title/note/sourceUrl. No new table or schema field is added.
See [midjourney-srefs.md](midjourney-srefs.md) for save_sref/list_srefs and readback.

What the gallery is made of, read from `convex/schema.ts`, `convex/validators.ts`,
`convex/menuFilters.ts`, `lib/collection-sections.ts` and `lib/medium.ts` on
7 Oct 2026. Human direction governs creative policy; code and live verified
behavior define the runtime contract. Fix factual contract drift in the same
change. The simple objects are media, Skills, Worlds (root collections),
collections, tags, native Stories, bookmarks and separate YouTube references.

## Media retrieval handles and reusable knowledge

An agent (or Michael) finds a piece through these handles. Every save
should fill the ones that apply, because a handle left empty is a query that
can never hit.

| Handle | Where it lives | Set by |
|---|---|---|
| **Collection / folder** | `folders` + `assetFolders` | `folderIds` on save |
| **Piece type** | tag: `character`, `location`, `scene`, `inspiration` | `tagNames` / `typedTags` |
| **Medium** | tag: `animation` (absent = live action) | `tagNames` / `typedTags` |
| **Descriptive tags** | `tags` via `assetTags` / `promptTags`, typed by category | `typedTags` |
| **Pixels and words** | `semanticDocuments`: pixel lane `embedding` + text lane `textEmbedding` | automatic after ingest |
| **Skills** | `skills` (`body` markdown, `tagIds`) + `skillFolders` for collections; text lane `semanticDocuments.sourceType: "skill"` | create_skill / update_skill / file_skill |

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

Storage moves between two layouts (`SEMANTIC_STORAGE`, `convex/semanticStorage.ts`):
legacy keeps one `semanticDocuments` row per source with both lanes at 3072
values (~56 KB); split keeps a slim `semanticEntries` row per asset or Skill
plus one row per lane in `semanticPixelVectors` / `semanticTextVectors`, each
the normalized first 768 values of the same embedding. Search and the lane
rules below are the same in both. Split storage holds no prompt or
design-inspiration vectors (nothing searches them) and no pixel vector for
imageless assets.

In legacy storage each asset has one `semanticDocuments` row with two
embeddings, each from its own model (3072 dims both):

- **Pixel lane** (`embedding`, index `by_embedding`, `gemini-embedding-2-preview`,
  multimodal): the image bytes only, so a text query finds what a picture looks
  like. Legacy imageless video rows can retain a text-only vector in this column;
  visual retrieval excludes text_only modality so a prompt cannot outrank
  actual visual matches. Video semantics still do not establish motion.
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

`semanticDocumentIdentities` is an internal lightweight projection used to
resolve vector-hit IDs without loading either embedding. Both lanes share one
deduplicated lookup. Semantic mutations maintain the projection atomically;
legacy rows use a full-document fallback until the metadata-only migration
completes. The compact lookup and miss-only fallback are separate queries;
fallback batches contain at most eight full documents to remain below database
read limits even with large search text. This does not change agent search
inputs, results, or permissions.
Deployment and migration require separate authorization; see
`agent-docs/SEMANTIC_READ_COST_MIGRATION.md` for rollout and verification.

## Pillars: legacy, leave unset

`pillar` still exists as a column on prompts, assets, tags, packs, skills
and design inspirations, but it is a free string (`pillarValidator = v.string()`)
that nothing in the product navigates by any more. The values still in code are
`creators`, `designs`, `dump` and `cinema-inspiration`.

- Leave `pillar` unset on ordinary saves.
- Set it only where a contract requires it: `cinema-inspiration` frames, and
  legacy internal contracts that explicitly require it; agent Skill creation
  does not require a user-facing pillar choice.
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

- **Michael's curator star = featured.** Starring publishes the piece onto the
  public featured reel; unstarring takes it off the reel and leaves it public.
  Other users' stars remain private. `starredAt` records
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
  collection. A folder never holds folders. A storybook may be a child of a
  root (its world) and never holds children.
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

A child folder can carry `folders.group` (optional display text of at most 40
characters, e.g. `Styles`, `Places`, `Cast`) and `folders.sortOrder` (optional
number). Both are accepted on roots and ignored there. Children list group by
group: groups in order of their smallest member `sortOrder`, then group name;
members by `sortOrder`, then name; ungrouped children last in the old order
(sections first, then name). With no group set nothing changes.
`createFolder`/`updateFolder` take both (`null` clears) and `updateFolder` keeps
the name when it is omitted. Groups never move assets.

Public collection counts are stored in `folders.publicMemberCount`, maintained
transactionally by `publicCollectionMemberships` snapshots whenever asset
publication or membership changes. They count distinct public assets across
`assetFolders` and the legacy primary pointer, excluding private assets.
`folders:listFolders` exposes this optional count only when the bounded
`publicCollectionCounts:backfill` has completed; missing means not ready, not
zero. Until then `assets:listPublicCollections` preserves the exact legacy
read. These internal bookkeeping tables do not change save/filing arguments.

## Worlds (harness 1.0, 23 Oct 2026)

A world is a root collection with `folders.worldKey` set (lowercase hyphenated,
unique per owner, e.g. `dear-annete`). Its children (style branches, shelves and
storybooks in group `Storybooks`) belong to it. ART, LOVE, DESIGN and other
roots without a key are shared shelves, not worlds.

Isolation is enforced in Convex (`convex/worldCore.ts`):
- an asset may belong to at most one world; any membership write that would add
  a second world is refused (legacy two-world assets keep what they have);
- a moodboard's new items and a story's new asset links must not belong to
  another world; a board never moves to another world;
- a story's collection and its storybook are in the same world.

Tables:
- `worldDocs` — a world's files: `WORLD.md` (≤ 8,000 chars), `LEARNINGS.md`
  (≤ 40 entries / 6,000 chars), `docs/<kebab>.md` (≤ 8 docs, 12,000 chars).
  Caps live in `lib/world-docs.ts` and are enforced on write.
- `worldChanges` — the journal: `op` (`doc.write`, `doc.delete`, `assets.file`,
  `shelf.create`, `shelf.update`, `moodboard.*`, `profile.save`, `story.save`,
  `world.mark`), actor (`agent:<token label>` or `owner`), optional `session`,
  JSON `before` / `after`, `revertOf` / `revertedBy`. Written in the same
  transaction as the change by world docs, filing, shelves, moodboards in a
  world, profiles and stories in a world. `worlds:undoWorldChanges` restores
  `before` when the target still matches `after` (else it is blocked); undoing
  a created story archives it, undoing a created profile retires it.
- `mjProfiles` — Midjourney personalization profiles: name, `code` (the
  `--profile` code), `mjProfileId`, `status` (active/retired), `codeHistory`,
  and `uses: [{ worldFolderId, role, styleTag? }]`. A world reads only its use.

Functions: `worlds:listWorlds`, `getWorldContext`, `readWorldDoc`,
`listWorldDocs`, `writeWorldDoc`, `deleteWorldDoc`, `worldDocHistory`,
`fileWorldAssets`, `saveWorldShelf`, `markWorld`, `listWorldChanges`,
`getWorldChange`, `undoWorldChanges`, `resolveWorldRef`; `mjProfiles:listProfiles`,
`saveProfile`. Agent route `/api/agent/worlds`; MCP tools `open_world`,
`world_doc`, `world_file`, `world_shelf`, `mj_profiles`, `world_journal`,
`world_undo`, `mark_world`. `search_gallery`, `find_similar`, `preview_assets`,
`list_assets_page`, `list_stories` and `list_moodboards` take `world`.

## Validator quick reference

These are the valid enum values the Convex schema enforces — use these or ingest will fail:

**`modelProvider`:** `openai`, `anthropic`, `google`, `xai`, `meta`, `flux`, `midjourney`, `runway`, `other`
→ Use `other` for Kora Reality / Enhancor and any non-listed providers.

**`workflowType`:** `component_prompt`, `page_prompt`, `system_prompt`, `asset_recipe`, `other`

**`typedTags[].category`:** `model_name`, `style`, `content_type`, `platform`, `color`, `camera_angle`, `lighting`, `composition`, `car_make`, `car_model`, `car_angle`, `environment`, `design_style`, `design_type`, `workflow_type`, `component_type`, `motion_technique`, `motion_format`, `motion_tool`, `motion_feel`, `custom`
→ No `subject` — use `content_type` instead.

**`promptSections` fields:** `finalPrompt` (required), `generationNotes` (optional), `negativePrompt` (optional)
→ No other keys — extra fields cause validation errors.

**`folders.kind`:** `storybook`
→ Undefined = a plain collection.

**`parentFolderId` nesting:** only a plain root collection may be a parent, and
only plain collections may be children. One level deep.

**`assetRole`:** `generated_output`, `reference`, `inspiration_capture`, `skill_example`, `cinema_frame`, `bookmark` (a saved post's own preview; set by the bookmark save, never by hand), `other`

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
  - The pixel lane uses image-only multimodal embeddings; the separate text lane includes agent description, caption, prompt and tags. Hybrid retrieval combines their ranks. Legacy video rows may store a text-only vector, which visual retrieval excludes; a poster or search hit does not establish motion understanding.

- `semantic_index_failures`
  - Backend-managed retry/failure rows for semantic indexing failures.

- `agentTokens`
  - Per-user bearer tokens for MCP/agent access.
  - Stores `ownerUserId`, `tokenHash`, `tokenPrefix`, `label`, `scopes`, expiry/revocation/use timestamps.
  - Raw token secrets are returned once by `/api/agent/tokens` and are never stored.
  - Public owner metadata includes `canEditScopes`; only active manual tokens
    can have scopes changed by the same-origin owner-session PATCH endpoint.
    The issuer-protected backend checks ownership, active status and nonempty
    allowed scopes. OAuth grants are immutable here and require fresh consent
    on reconnect. Existing token secrets and read/write defaults are preserved.
    `gallery:delete` supplies technical access; agents still need explicit user
    approval for each named deletion target or listed batch.

- `tags`
  - Normalized tags with metadata: `category`, `pillar`, `source`.
  - Created/upserted through `tags:getOrCreateTagsWithMetadata` when metadata is known.

- `userTags`
  - Owner-scoped tag catalog for a user's page and agent workflows.
  - Points at canonical `tags` rows while storing user-specific label, description, color, sort order, pillar/category defaults, and archive state.
  - Managed externally through `/api/agent/customize`; content rows still attach canonical `tagIds`.

### `videoRefs`: YouTube research (the YouTube page)

One row per YouTube video per owner, apart from assets. Holds the video's and
the channel's numbers, the style analysis, `collections` (plain filter labels,
not folders), `tagNames` (plain strings) and the R2 keys of the copied
thumbnail and in-video frames. Idempotent on (owner, video id). Not in the
semantic index. Detail: `references/video-refs.md`; code: `convex/videoRefs.ts`,
`lib/video-refs.ts`.

`updateVideoRef` / `update_video_ref` can replace `tagNames` on an owned record.
Omission preserves the existing set; `[]` clears it. The replacement uses existing
label normalization/deduplication and recomputes `searchText`, preserving research,
source/media, statistics, notes and likes unless those editable fields are supplied.
`save_video_refs` continues merging tags; it does not truncate them automatically.

Four optional fields say how a video is made and how fresh its numbers are
(added 4 Oct 2026; older rows do not have them):

- `productionStyle`: how the picture is made, e.g. "2D animation", "Stock
  footage", "AI pictures". The vocabulary is in `references/video-refs.md`.
- `language`: the spoken language, a lowercase ISO 639-1 code (`en`, `es`).
- `channelLastUploadAt`: epoch ms of the channel's latest upload when checked.
- `checkedAt`: epoch ms when the numbers were last verified on YouTube.

`listVideoRefs` filters on `productionStyle`, `language` (exact match, any
case) and `tagNames` (the record must carry every tag given).

### `bookmarks`: X posts with their text

One row per post per owner (idempotent on owner, platform, post id): permalink,
author, text, language, posted time, media (image URLs, or a video's poster),
quoted post, counts, and `userNote` (the owner's words). `assetId` names the
piece the Bookmarks tab shows for the post. Assets point back through
`assets.bookmarkId` (index `by_bookmark`): a post's own preview has
`assetRole: "bookmark"`; media saved earlier from the same post is linked and
keeps its role. Every linked piece carries the tag `bookmark`, and the post's
text is part of its search text lane. Detail: `references/bookmarks.md`; code:
`convex/bookmarks.ts`, `convex/bookmarkSaves.ts`, `convex/bookmarkHelpers.ts`.

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
- Backfill existing records: `CONVEX_DEPLOYMENT=dev:perfect-buffalo-375 bunx convex run semanticIndex:backfillBatch '{"sourceType": "asset", "batchSize": 25}'` (loop until `done: true`). Same for `"prompt"` and `"designInspiration"` source types.
# Characters (16 October 2026)

`characters` holds one named person per world: `ownerUserId`, `worldFolderId`
(a root collection), `code` (`DA-CH-001`), `prefix`, `number`, `name`, optional
`alias`, `normalizedName` (unique per world), `otherNames`, optional `role`,
`lane` (live-action/animation), `status` (concept/approved/sheeted/retired),
optional `sheetAssetId`, `faceAssetId`, `nameTag`, `notes`, `costumes`
(`code` C01…, `name`, `status`, optional sheet/face/notes),
`lastCostumeNumber`, `linkCount`, `revision`, `createdAt`, `updatedAt`.

`characterWorlds` keeps each world's prefix and last issued number, so codes
are never reissued and two worlds never share a prefix. `characterAssets` is
the typed link: `characterId`, `assetId`, `role`
(concept/sheet/face/costume/appears-in/reference), optional `costumeCode` and
`note`. One row per character and asset; asset deletion removes its rows and
clears sheet/face pointers. See `characters.md`.

# Moodboards (19 October 2026)

`moodboards` holds one look per row: `ownerUserId`, `folderId` (a plain root
or child collection, never a storybook), `name`, `normalizedName` (unique per
owner and folder), optional `description`, `styleTag` (lowercase hyphenated,
at most 48), `status` (draft/in-midjourney/archived), optional `mjCode` (the
personalization code, a string kept as given), `mjMoodboardId`, `mjUrl`,
`mjSyncedAt`, `mjSyncedItemCount`, `mjCodeHistory` (`code`, `at`, optional
`note`), `notes`, `coverAssetId` (always an item), `itemCount` (exact),
`revision`, `createdAt`, `updatedAt`. Indexes: owner/folder/normalizedName,
owner/updatedAt, owner/mjCode.

`moodboardItems` is one asset on one board: `ownerUserId`, `moodboardId`,
`assetId`, `position` (ascending display order; an append takes the last
position + 1), optional `note`, `addedAt`. One row per board and asset;
indexes by board/position, board/asset and asset. Deleting an asset removes
its rows and repairs `itemCount` and `coverAssetId`. Deleting a child
collection moves its boards to the parent (renamed `<name> · <child>` on a
clash); deleting a root deletes its boards and items. See `moodboards.md`.

# The world Inbox (20 October 2026)

`inboxStacks` is one stack of decision cards in a world's Inbox:
`ownerUserId`, `worldFolderId` (a root collection), `title`, optional `note`,
`agent`, `ingestKey` (posting again with it appends), `status` open/closed,
`cardTypes`, `createdAt`, `updatedAt`, `closedAt`. Indexes: owner/status/
createdAt, world/status/createdAt, owner/world/ingestKey.

`inboxCards` never change after posting: `stackId`, `worldFolderId`,
`position`, `type` (sort/duplicates/artifact/ab/choose/rule), optional `key`
(re-posting it is skipped), `question`, `assetIds`, `labels`, `targets` (sort:
2–9 of `hotkey`, `label`, `kind` moodboard/collection/option/out, and the
`moodboardId` or `folderId`), `evidence` (`text`, `matches` of kind/label/
score, `defect.box` in 0–1 coordinates with `note`, `priceUsd`, `priceNote`),
`ruleText`. Indexes: stack/position, stack/key.

`inboxDecisions` is the latest answer on a card: `choice` (target, skip,
keep, fix, out, winner, neither, pick, yes, no, not-yet, stack, keep-all,
resolve), `targetHotkey`, `pickedAssetId`, `coverAssetId`, `deleteAssetIds`,
`deletedAssetIds`, `applied` (what it changed: a moodboard item, a collection
membership, or a stack with each member's earlier pack), `decidedAt`, a card
comment (`commentText`, `audioStorageId`, `audioDurationMs`,
`audioContentType`). `inboxCounts` keeps cards/decided per stack for the
badges. Undo reverses `applied`; deleted images stay deleted.

`assetPacks.kind` is `stack` for alternates collapsed under one cover; prompt
syncing never moves a stack's members. `assetComments` may carry a voice note
(`audioStorageId`, `audioDurationMs`, `audioContentType`; `body` may then be
empty) and `source: "inbox"`. See `inbox.md`.

`assetHashes` holds one perceptual hash per image: `ownerUserId`, `assetId`,
`dHash` (16 hex characters, a 64-bit difference hash of the card thumbnail or
video poster), `createdAt`. Written a minute after ingest and by the backfill
`perceptualHash:backfillPerceptualHashes`; deleted with the asset. Indexes:
asset, owner. Read by the grid's Similar view and `find_similar_groups`.

# Text records and filter presets (6 October 2026)

`stories` is the private native text table. Required fields: `ownerUserId`,
`title`, `body`, `kind` (idea/script/style-lock), `status`
(idea/draft/ready/archived), `tagNames`, `assetIds`, stable `ingestKey`,
`revision`, `searchText`, `createdAt`, `updatedAt`. Optional fields: `logline`,
`hook`, `folderId`, `styleTag`, `storybookId`. Every linked folder/asset is
owner-validated. Owner/key retries are idempotent; changed text increments
revision and preserves the prior content in `storyRevisions`.

`storyRevisions` stores full previous story fields plus `storyId`, `revision`,
and `savedAt`; access requires ownership of the current story.

`galleryPresets` stores owner, name/normalizedName, timestamps, and typed filters:
`selectedFilterIds` / `excludedFilterIds` reference menuFilters, optional folder
and media kind, boolean `onlyLiked`, `includeSkills`, `flattenStacks`, and sort
order newest/featured/shuffle. Presets upsert by owner/normalized name. They
change browsing, never public state. See `stories.md` for MCP/API examples.


## Private agent instruction resources

agentInstructions stores ownerUserId, resourcePath, content, version, sha256,
createdAt and updatedAt, indexed by owner/path. Signed owner reads retrieve the
private full worlds/maintenance resources; tracked public files only explain how
to fetch them. Generic storage holds policy text without hardcoding world names
or private IDs into backend logic. Resource replacement requires the last-read
expectedSha256; exact content/version retries are idempotent.

Agent tokens may store an internal oauthCodeHash indexed for atomic one-time OAuth
code consumption. It is not public token metadata and never contains a raw code.

Ingest/update action results can include partial, failedStep and error together
with persisted assetId/promptId/designInspirationId. Token APIs preserve these as
HTTP 207 partial results, including per-item batch persistence counts. Lineage
sources are resolved before saving; media is processed before metadata changes.

## Native Skills and legacy retirement

Reusable recipes live in `skills`, with `skillFolders` collection memberships.
Ordered prompt steps use `prompts.skillId`, `skillStepOrder`, and `skillStepLabel`.
`skills:*` is the backend contract; the canonical download is
`/api/skills/<id>/export`. New media examples use `assetRole: skill_example`;
ordinary source references keep their existing roles. Body/instruction embeds
continue to reference the original `asset:<id>`; no media is copied.

Every external get/update/delete/filing entry point resolves previously copied
`workflow:<id>`, old `skill:<workflow-id>`, and retired `pack:<id>` identifiers
through the signed owner's `skillMigrationAliases` before touching native rows.
New responses use `skill:<native-id>`. An alias grants no access to another owner.
`workflow_asset` is an old read/input alias for `skill_example`, not a new stored
role. New writes normalize it; complete traversal uses `includeSkillExamples`.
The old `includeWorkflowAssets` option remains a wire alias for existing clients.

Legacy Workflow tables and pointers exist only during the staged owner-authorized
copy/verify/rewire/retire operation in `agent-docs/NATIVE_SKILLS_MIGRATION.md`.
They must be removed after verified retirement; empty staging schemas are not
the completed migration. Ordinary visual packs are not automatically recipes.
Historical `generationType`, `promptType`, and `workflowType` values describe how
a source was made and are preserved; they do not create legacy containers.

Migration aliases retain their initial `sourceSnapshot` unchanged. A signed,
source- and phase-guarded staging reconciliation can append `effectiveCheckpoints`
for an exact reviewed set of externally missing examples. It verifies absent IDs,
all surviving source bytes and the full native prompt/media closure; only an
explicitly approved contiguous pack-slot compaction is accepted. Its checkpoint
retains the observed compact pack, while retired pack redirects archive the
initial pack record. The final conservation verifier is read-only and checks the
surviving effective graph alongside that immutable original archive.
