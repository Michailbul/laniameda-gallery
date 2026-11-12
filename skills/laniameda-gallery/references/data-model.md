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
`midjourneyMetadata` and the linked prompt.

## Midjourney metadata

`assets.midjourneyMetadata` (added 31 Oct 2026) records what a Midjourney job was
made with. The browser extension collects it on every save from midjourney.com;
`/api/extension/save` sanitizes it and passes it to `ingest:ingestFromApi`.

- `jobId`, `jobUrl` (rebuilt server-side, includes `?index=` when known),
  `tileIndex`.
- `personalization[]`: every `--profile` code, with `type` (`moodboard`, `profile`
  or `unknown`), and `name` and `id` when Midjourney showed them. `id` is the
  stable one: a moodboard's code changes as the board is edited.
- `aspectRatio`, `stylize`, `chaos`, `raw`, `version`, `seed`, `hd`, `speed`, `no`,
  and `otherFlags` for everything else verbatim (`--sref 123`, `--weird 20`).

The full prompt stays on the linked prompt row. On a Midjourney save, `sourceUrl`
is the job page, not the page the save was made from. A repeat save fills a
missing `midjourneyMetadata` or `promptId` and never overwrites one. Only
`getGalleryAsset` returns the field; grid queries leave it out to stay slim.
Missing or malformed metadata never fails a save.

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
- **`superLikedAt`** is Michael's super like: **the image is ready to use**
  (his words, 11 Nov 2026: "super likes are already ready images to use").
  He sets it with key 1 pressed twice on a frame (vault, open view, world
  page; ⇧1 on the styles page); one press of 1 is a plain like, and 1 on a
  liked or super-liked frame takes both off. Private, implies `isLiked`,
  never publishes or features. `setAssetLikeLevel {assetId, level: none |
  like | super}` sets both together; unliking (`setAssetLiked false`) clears
  it. Index `by_owner_superLikedAt`. Read the ready images with
  `onlySuperLiked: true` on `list_assets_page` (complete, newest super like
  first), `list_assets`, `search_gallery`, `find_similar` and
  `preview_assets`; owner results carry `superLikedAt` on those frames.
  `frameMarks:listFrameMarks` gives the app the super-liked ids and the ids
  of frames with a comment, for the marks on every grid.
- **`tasteCollection`**: at most one collection per owner carries this. The
  public home's inspiration grid shows exactly its members.
- **`worldPageHidden`** (+ `worldPageHiddenReason`) keeps a piece off public
  world pages (/w/<slug>): a duplicate take, an artifact, a frame Michael
  rejected. The vault still shows it; nothing is deleted. Set with
  `worldPage:setWorldPageHidden {assetIds, hidden, reason}` (signed owner).
  Record exclusions here, never as ids in code.
- Keys on a hovered frame (vault, world page and its admin view,
  `lib/asset-hotkeys.ts`): **F** toggles the curator star (featured pieces lead
  the world page), **D** archives (soft: grayed, off the world page, in the
  Archive tray until restored; never deleted by itself), **H** toggles the frame as a hero insert on its world page
  (**Shift+H** pairs it into the previous insert as a split or triptych),
  **C** comments (an `assetComments` row, read with `list_asset_comments`).
  World page only: **2** drops the frame from the page (`worldPageHidden`, 2
  again brings it back), **O** opens it large. Hero frames carry a HERO chip
  in owner views.
- **`heroRendition`** (`{variants: [{r2Key, width, height}], model, createdAt}`,
  smallest first): a hero still's Topaz upscale (Standard V2, JPEG, 5120 and
  2560 wide). The world page adds them to the hero's srcset, so only large and
  retina screens load them. Made on promotion by the deployment when it has
  `TOPAZ_API_KEY`; otherwise an agent runs
  `bun scripts/upscale-hero.ts --env-file <convex env> --world <slug>` (or
  asset ids) with the local Topaz keys. Films are never upscaled or cropped.
- **`letterboxed`** (tag): a frame with burnt-in black bars. Public world
  pages leave it out; the admin view shows it marked. Tagging is the whole
  switch: no code holds ids.

Agents never set star, featured, public or taste flags unless Michael asks to
publish.

## Tags

- `tags` rows are global and deduped by `canonicalKey` (`canonicalTagKey(name)`);
  `aliases` hold alternate spellings.
- `userTags` is Michael's catalogue on top: label, description, colour, sort
  order, archive state. Before inventing a tag: read the world's `docs/tags.md`
  (`open_world`), rely on the save-time `canonicalTagKey` folding and
  `add_tag_aliases`, then call `list_tags` filtered (`search`, `category`,
  `minUsage`; slim rows, most used first, `limit` + `cursor`). The vocabulary is
  about a thousand tags; an unfiltered read is never the answer. `upsert_tags`
  creates or edits catalogue entries by exact name and does not match aliases.
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

Every collection has a page in the gallery, returned as `url` by
`list_collections` and `open_world`: a root at `/w/<worldKey>` (its id when it
is not a marked world), a child at `/w/<world>/<childId>`. A world's tabs are
`/w/<world>/instructions|journal|tasks|moodboards`; `?asset=<id>` on any page
opens that piece. The route grammar lives in `lib/gallery-routes.ts`.

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
  another world;
- `update_collection` and `save_moodboard` refuse to move a shelf, storybook or
  board into another world. `worlds:moveToWorld` (MCP `world_move`) is the one
  deliberate path: the container keeps its id; a shelf or storybook goes under
  the target root and each member leaves every other shelf of the source world
  (as `world_file move` does); a board goes into a plain collection of the
  target and its other-world items either come along (`items: "move"`) or stay
  behind and leave the board (`items: "drop"`). Its Midjourney code and sync
  record are kept. It refuses a world root and a target that is not a world or
  is the same world, has a dry run, and is journaled as op `world.move` in both
  worlds with a shared `pair` key, so `world_undo` reverts the pair at once;
- a story's collection and its storybook are in the same world.

Collection counts: `folders.memberCount` (distinct assets linked through
`assetFolders`) and `folders.publicMemberCount` (public assets, links plus the
legacy primary pointer) are stored, not computed on read. Every membership write
(world_file, world_move, world_undo, the collection editor, update_gallery_item
`folderIds`, ingest, inbox, delete) recounts the collections it touched and
resyncs public counts. `worldCounts:recountWorldCounts` (MCP `world_recount`) is
the repair: it recounts the world root and every child from the rows, pages
inside Convex read limits, has a dry run listing stored and recounted counts,
and journals corrections as op `world.recount` (undo re-derives the count and
never blocks a session undo). Check a count by paging `list_assets_page
{folderId}` until `isDone`: a filtered page can be empty while the shelf is not.

Tables:
- `worldDocs` — a world's files: `WORLD.md` (≤ 8,000 chars), `LEARNINGS.md`
  (≤ 40 entries / 6,000 chars), `docs/<kebab>.md` (≤ 8 docs, 12,000 chars).
  Caps live in `lib/world-docs.ts` and are enforced on write.
- `assetDeletions` — one row per hard-deleted asset (7 Nov 2026), written in the
  same transaction as the delete by `assets.deleteAssetCascade`: `assetId`,
  `via` (the path: `archive.purge`, `agent.delete_gallery_item`,
  `ui.dashboard.selection`, `ui.inbox.duplicates`, `merge.duplicate:keeper=<id>`,
  `cli.*`, `rollback.*`), `actor`, `session`, `kind`, `name`, `fileName`,
  `ingestKey`, `folderIds`, `worldFolderIds`, `deletedAt`. A world asset also
  gets an `assets.delete` journal entry (below). Every delete path must pass a
  trace; there is no silent delete.
- `worldChanges` — the journal: `op` (`doc.write`, `doc.delete`, `assets.file`,
  `assets.delete` (a hard delete; `targetId` is the asset id, `before` holds its
  file name, ingest key and collections; never undoable),
  `shelf.create`, `shelf.update`, `moodboard.*`, `profile.save`, `story.save`,
  `world.mark`, `world.move`, `world.recount`, `world.universe`, `style.save`, `style.merge`), actor (`agent:<token label>` or `owner`), optional `session`,
  JSON `before` / `after`, `revertOf` / `revertedBy`. Written in the same
  transaction as the change by world docs, filing, shelves, moodboards in a
  world, profiles and stories in a world. `worlds:undoWorldChanges` restores
  `before` when the target still matches `after` (else it is blocked); undoing
  a created story archives it, undoing a created profile retires it.
- `mjProfiles` — Midjourney personalization profiles: name, `code` (the
  `--profile` code), `mjProfileId`, `status` (active/retired), `codeHistory`,
  and `uses: [{ worldFolderId, role, styleTag? }]`. A world reads only its use.

- `worldStyles` — a world's named styles: `worldFolderId`, `name`, `slug`
  (unique per world), `line`, `family`, `status` (draft, ready, archived,
  merged), `shelfFolderId` (the child collection whose members are its frames;
  one style per shelf), `coverAssetIds` (≤ 12, world pieces), `recipes` (≤ 8:
  `moodboardIds`, `profileIds`, `unknownCodes`, `parameters`, `template`,
  `frames`, `note`), `raises`, `lowers`, `lockStoryId`, `notes`,
  `mergedIntoStyleId`, `sortOrder`, `revision`. Indexes `by_owner_world_slug`,
  `by_owner_shelf`. Reads tolerate a deleted cover, shelf or board.
- `folders.universeRootId` — on a world root: the world whose universe it
  reads in (one level). Changes nothing about membership.
- `assets` index `by_owner_fileName` backs `find_assets` prefix lookups
  (`mj-<job>`), with `by_owner_sourceUrl` prefix ranges for job and CDN URLs.

Functions: `worldStyles:listStyles`, `getStyle`, `listStyleFramesPage`,
`listStyleFrameIds`, `getFrameDetail`, `saveStyle`, `mergeStyleRecords`,
`setWorldUniverse`, `findAssets`; agent route `/api/agent/styles`; MCP tools
`list_styles`, `get_style`, `save_style`, `file_style`, `merge_styles`,
`world_universe`, `find_assets` (references/styles.md).

Functions: `worlds:listWorlds`, `getWorldContext`, `readWorldDoc`,
`listWorldDocs`, `writeWorldDoc`, `deleteWorldDoc`, `worldDocHistory`,
`fileWorldAssets`, `saveWorldShelf`, `moveToWorld`, `markWorld`, `listWorldChanges`,
`getWorldChange`, `undoWorldChanges`, `resolveWorldRef`; `worldCounts:recountWorldCounts`;
`mjProfiles:listProfiles`, `saveProfile`. Agent route `/api/agent/worlds`; MCP tools `open_world`,
`world_doc`, `world_file`, `world_shelf`, `world_move`, `world_recount`, `mj_profiles`,
`world_journal`, `world_undo`, `mark_world`. `search_gallery`, `find_similar`, `preview_assets`,
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

- `mjQueueItems` (Midjourney prompt queue, 6 Nov 2026; references/mj-queue.md)
  - Fields: `ownerUserId`, `worldFolderId`/`worldKey` (optional), `batch` + `batchKey` (lowercased label), `order`, `title`, `prompt` (prose only), `imagePrompts[]`, `styleRefs[]`, `omniRef`, `characterRef` (each ref `{url?, code?, assetId?, thumbUrl?, weight?, label?}`; `asset:<id>` is resolved to its public R2 URL when queued), `profileCodes[]`, `params`, `note`, `status` (`queued` | `injected` | `sent` | `skipped`), `injectedAt`, `sentAt`, `sentCommand`, `jobId`, `ingestKey`, `createdBy`, `createdAt`, `updatedAt`.
  - Indexes: `by_owner_batchKey_order`, `by_owner_ingestKey` (idempotent queueing), `by_owner_updatedAt`.
  - Functions: `mjQueue:listQueue`, `mjQueue:queueItems`, `mjQueue:updateItem` (signed owner). Agent route `/api/agent/mj-queue` (actions list/queue/update; MCP queue_mj_prompts, list_mj_queue, update_mj_queue_item); extension route `/api/extension/mj-queue` (GET list, POST update, POST `{action:"queue"}` adds items: the extension describer).
  - `describe` (optional, 9 Nov 2026): set by the extension's describer. `{sourceUrl?, pageUrl?, descriptions[] (Midjourney's Describe lines, up to 4), mode: keep | ours}`: the picture a prompt was written from, for lineage.
  - The composed command (`lib/mj-queue.ts` `composeMjCommand`, twin in `extension/mj-queue-compose.js`): image prompts, prose, `--sref`, `--iw`, `--oref/--ow` only with `--v 7`, `--cref/--cw` only with `--v 6`, `--profile`, params. Nothing in the backend submits to Midjourney; `sent` is recorded by the extension after Michael's own click.

- `folders`
  - Every collection and folder is a row here. There is no `collections` or `worlds` table. Projects, beats and episodes were retired on 22 Sep 2026.
  - Key fields: `ownerUserId`, `name`, `normalizedName`, `kind`, `parentFolderId`, `description`, `coverAssetId`, `shareToken`, `showcased`, `slug`, `showcaseFeatured`, `showcaseOrder`, `tasteCollection`, `pinnedAt`, `memberCount`.
  - `kind`: `storybook`; undefined = a plain collection.
  - `parentFolderId` nests one level only: a plain root collection is the parent and only plain collections may be children (`assertValidParent` in `convex/folders.ts`).
  - `memberCount` is denormalized; backend mutations recount via `recountFolderMembers`.
  - `showcased: true` publishes the folder as a world and allocates its stable `/w/<slug>` on first showcase (`folders:setFolderShowcased`). Folders inside a collection cannot be showcased.
  - `worldPage` (optional object) shapes the public world page: `allMembers` (show every member that is not `worldPageHidden`, instead of only `isPublic` ones; reference and inspiration pieces never show), `heroReelAssetId` (pin the hero film; unset = the newest member tagged `showreel`, then a featured video, then the newest video), `leadAssetIds` (frames that open the grid right after the featured ones, in order), `sides` (`[{key, label, folderId}]`, the Live action / 3D switch: the root and its `universeRootId` siblings), `heroInserts` (`[{assetIds}]`, 1–3 frames each, at most 40: full-screen hero inserts in order; the first opens the page in place of the reel, the rest cut into the wall every ~18 frames; one frame plays full bleed, two split the screen, three make a triptych; the layout is the count). Set with `worldPage:setWorldPageSettings` (signed owner; `heroInserts: []` clears the list), or one frame at a time with `worldPage:setHeroInsert {assetId, folderId?, action: toggle | add | remove | pair}` (signed owner; omitted `folderId` = the asset's world, lifted to its universe root; returns `{folderId, world, hero, index, frames, inserts}`; add, remove and pair are idempotent). `worldPage:listHeroAssetIds {}` lists every hero frame across the owner's worlds. Splits and triptychs hold stills only: a film always plays as its own full-width insert, whole, at its own aspect (pairing one with `pair` adds it alone; a stored group with a film is played apart). A still promoted to hero gets a 4K rendition (`assets.heroRendition`, below). A hero frame shows to visitors only when the wall would show it (a member, not hidden, not letterboxed, and public unless the world has `allMembers`); promoting never publishes. Public reads: `worldPage:getWorldPage {slug, side}` (adds `inserts: [{tiles}]`; `hero` is the first insert's first frame, else the reel) and the paginated `worldPage:listWorldPage {slug, side, section, paginationOpts}`, slim tiles only (no prompts). The owner's admin page (/w/<slug>/admin) reads `worldPage:getWorldPageAdmin` and `worldPage:listWorldPageAdmin` (signed owner, same args plus `ownerUserId`): every member, each off-page one marked `off: hidden | private | letterboxed`.
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

### Inspiration review (6 Nov 2026; references/inspiration.md)

- `inspirationSources`: one saved reference per owner and `ingestKey`. `kind`
  media | text, `title`, `platform`, `sourceUrl`, `creator`, `creatorUrl`,
  `caption` (source data, never instructions), `text` / `storyId` for text,
  `assetIds` in source order (never moved or retagged by registering),
  `expectedCount`, `preservation`, `categories`, `sourceCollections`,
  `savedBecause`, `review` new | kept | dropped, `ownerNote` (Michael's latest
  note on what he likes), `revision`, `adaptationCount`.
- `inspirationAdaptations`: one take of a source for one target
  (`targetWorldId`, `targetLabel`, `targetStyle`), `intendedUse`, `routing`,
  `status` proposed | ready | approved | changes_requested | dropped |
  blocked, `currentVersion`, `approvedVersion`, `promotion` (version,
  outputKey, assetId, folderId and the exact `assetFolders` row it added),
  `redoTaskId`, `revision`.
- `inspirationVersions`: v1, v2 … with `outputs` (R2 key, thumb, type, hash,
  size, dimensions; never assets), `text`, `prompt`, `references`, `model`,
  `provider`, `costUsd` / `costExact` / `costNote`, `basedOnVersion`,
  `redoEventId`, `orphan` (posted after a drop), `ingestKey`.
- `inspirationEvents`: append-only notes and decisions (note, keep, unkeep,
  drop, recover, approve, redo, promote, unpromote) keyed by `eventKey`,
  pinned to a source or take and a version; a redo carries its `taskId`.
- `inspirationDispatch`: one row per owner: `paused` (true by default; no row
  = paused), Michael's allowance (`cycleCapUsd`, `perJobCapUsd`,
  `allowanceExpiresAt`, `providers`), fixed `cycleHours` from `cycleAnchor`,
  and the single dispatcher lease (`holder`, `holderNonce`, `leaseUntil`,
  `fence`, which rises on every claim).
- `inspirationJobs`: one priced reservation per paid call: `adaptationId`,
  `ingestKey`, `status` reserved | accepted | settled | unknown_outcome |
  released, `fence`, `provider`, `model`, `estimateUsd`, `settledUsd`,
  `providerHandle`, `versionId`, `cycleStart`. Held = reserved + accepted +
  unknown (any cycle); settled counts toward its own cycle.
- `inspirationVersions` also carries the paying `jobId` link through the job's
  `versionId`; a version posted with a stale fence is an orphan.
- `inspirationPrivateMedia`: personal originals in Convex file storage
  (`storageId`, never a public URL), optional `sourceId`, `ingestKey`, `kind`
  image | video | audio, `contentType`, `size`, hex `sha256` from storage's
  own record, `signature` (what the first bytes are; checked against the
  type before the row exists), `captureId`, `derivatives` pending | ready |
  original_only | failed with `displayStorageId` / `thumbStorageId` (WebP,
  no EXIF/GPS/ICC), `externalProcessing` none | cleared with
  `clearedProcessors` [{name, clearedAt}]. Served only by
  `/api/inspiration/media/<id>[?variant=display|thumb|original][&download=1]`
  (session or owner agent token, `private, no-store`, byte ranges) through
  the Convex HTTP action `/inspiration/private-media`; no variant = the clean
  copy when there is one. Attach runs `inspirationPrivateNode:attachPrivateMedia`
  (sniff, record, cut copies). Delete and processor clearance are
  `ownerSessionMutation`s; `inspirationPrivateDeletions` keeps a tombstone
  (hash, size, type, when, by).
- `inspirationCaptures`: one per intake event and representation:
  `sourceId`, `captureKey`, `captureRevision`, `representation`, `platform`,
  `via` {channel telegram | share_sheet | browser | agent | import, chatType,
  chatId, senderId, messageId, bot, forwardedFrom} (Telegram ids are stored,
  never returned by reads), `sourceUrl`, `creator`, `caption`, `text`,
  `sourceCollections`, `assetIds`, `contentHashes`, `privateMediaIds`.
  Unique per (owner, key, revision, representation); a key belongs to one
  source.
- `assetCaptures`: every other source a deduplicated asset was saved from
  (`sourceUrl`, `ingestKey`, `ingestSource`, `matchedBy` contentHash |
  ingestKey); read as `alsoSavedFrom` on `get_gallery_item`.
- `agentTokens.scopes` gains `inspiration:capture` and `inspiration:adapt`;
  `worldIds` lists the projects an adapt token may work on.
- `assetComments.source` gains `inspiration`: a source note mirrored onto the
  lead asset's thread; it opens no task.
- `tasks.source` gains `inspiration`: a redo task, `sourceRef` = the event id.
- Owner decisions are Convex `ownerSessionMutation`s: the signed token must
  carry `via: "session"`, which only `/api/auth/convex-token` (a signed-in
  browser) mints. Agent, extension and script tokens cannot approve, promote,
  drop, keep or redo.

### Director review (6 Nov 2026; references/review.md)

- `reviewProjects`: one per `slug` (the address `/review/<slug>`), owned by
  `ownerUserId`. `title`, `subtitle`, `worldFolderId` (the world the frames
  come from), `publicUrl`, `reviewers` (email, name, pictureUrl, role
  director | viewer, addedAt, lastSeenAt), `ownerEmails` (Google accounts that
  act as the owner on the public address), `styles` (carousel order:
  `styleId` of a `worldStyles` row, `label` the director reads, `hidden`),
  `currentVersionId`, `draftVersionId`, `feedbackSeenAt` (Michael's "read up to
  here" mark). Indexes `by_slug`, `by_owner`.
- `reviewFolders`: `projectId`, `section` locations | characters | scenes,
  `area` (nav group), `name`, `slug` (fixed at creation, unique per section),
  `note`, `scenes` (script scene numbers), `order`, `archivedAt`. Index
  `by_project_section_order`.
- `reviewVersions`: the rounds. `projectId`, `number`, `label` (`v0.<n>`),
  `status` draft | published, `title`, `note`, `basedOnVersionId`,
  `publishedAt`. Index `by_project_number`.
- `reviewItems`: a frame in one round. `versionId`, `assetId`, `folderId`,
  `styleId`, `order`, `note` (caption), `previousAssetIds` (earlier takes,
  oldest first), `held` (Held · only you: draft only, never on a reviewer's
  page, left out of publish and carried into the next draft), `addedAt`. A
  draft starts as a copy of a round's items, so
  published rounds never change. Indexes `by_version_order`,
  `by_version_asset`, `by_project_asset`.
- `reviewFeedback`: one verdict like | dislike per frame per person, keyed by
  `projectId` + `assetId` + `reviewerEmail` ("owner" for Michael's gallery
  session), with `role` and the `versionId` it was given in. It follows the
  asset across rounds. Indexes `by_project_asset_reviewer`,
  `by_project_updatedAt`.
- `reviewStyleFeedback`: one verdict like | dislike per style per person on a
  whole style of the project: `projectId`, `styleId` (worldStyles, must be in
  `project.styles`), `reviewerEmail` (same keys as `reviewFeedback`), `role`,
  `versionId` (round it was given in). Indexes `by_project_style_reviewer`,
  `by_project_updatedAt`.
- `reviewComments`: `projectId`, `assetId`, `versionId`, `authorEmail`,
  `authorName`, `authorRole` director | viewer | owner | agent, `body` (at most
  4000 characters), `batchId` (one comment written on several frames),
  `resolvedAt`. Indexes `by_project_asset_createdAt`, `by_project_createdAt`.
- Frame codes (`CA-` + the asset id's last six characters) are computed, not
  stored.
- Reviewers sign in with Google on the review page; their Convex token has
  subject `reviewer:<email>` and opens only `convex/review.ts`
  (`convex/actor.ts` refuses it everywhere else). Agents use the owner-scoped
  functions through `/api/agent/review`.

### Projects and production briefs (9 Nov 2026; references/projects.md)

- `folders.project` (world roots): `line`, `client`, `role`, `people` (name,
  role, org), `reviewSlugs`, `status` active | paused | done, `updatedAt`.
  Written by `projects.setProjectDetails` (journal op `project.save`).
- `folders.scope`: `"art_director"` on a shelf = Michael only. The public
  world page's featured tree and the showcase chapters skip it; the review
  agent route refuses its frames without `confirmed`. New shelves in a
  project world get it unless `scope: "shared"` is asked.
- `productionBriefs`: `ownerUserId`, `worldFolderId`, `ingestKey` (unique per
  owner), `title`, `kind` brief | storyboard | script | style_guide |
  references | other, `from`, `receivedAt`, `note`, `topics`, `reviewFolders`
  (review folder slugs), `assetIds`, `groups` ({label, assetIds}), `files`
  ({key f1…, name, contentType, size, sha256 hex, storageId, pages,
  coverStorageId, addedAt}: Convex storage, served only by
  `/api/briefs/<briefId>/files/<key>` to the owner session or an owner token),
  `searchText`, `revision`. Indexes `by_owner_ingestKey`,
  `by_owner_world_updatedAt`; search index `search_text` filtered by owner and
  world. Every save and attach is a `brief.save` journal entry (undo restores
  the snapshot; attached files are never dropped by undo).
- Recipes as copy text: `lib/mj-recipe.ts` `composeRecipe` (parameters, then
  template, then moodboard, profile and loose codes, each once).
  `styleRecipes.reviewStyleRecipes` serves them to the review owner only.

### Locked location prompts (9 Nov 2026; references/locked-prompts.md)

- `lockedPrompts`: `ownerUserId`, `worldFolderId`, `ingestKey`, `title`,
  `place`, `reviewFolder`, `shelfId`, `scenes`, `text` (no flags), `imagePrompts`
  (mjQueue refs with weight), `aspect`, `seed`, `extraParams`, `note`,
  `lockedFrame` ({assetId, editUrl, thumbUrl, label}), `currentStyleId`,
  `takes` ({assetId, styleId, mode, queueItemId, jobId, at}),
  `sourceQueueItemIds`, `archivedAt`, `searchText`, `revision`. Indexes
  `by_owner_ingestKey`, `by_owner_world_updatedAt`. Saves journal
  `lockedPrompt.save`.
- `lockedPromptRevisions`: every content change (`by_prompt_revision`).
- `mjQueueItems` gained `editRefs` (`--edit`), `lockedPromptId`, `placeLabel`,
  `styleId`, `styleLabel`, `restyleMode` (seed | frame).
- Composition: `lib/locked-prompt.ts` (`restyle`, `applyStyleTemplate`,
  `seedFor`); `composeMjCommand` and its extension twin add `--edit` last
  (V8.2 only).
- Results: `fileRestyleResults` files saved frames on the place shelf, the
  style shelf and the art-director shelf "Location takes", adds takes and
  `generationLineage` rows (`edit_source`, `starting_image_asset`, `other`).

### Prompt runs (9 Nov 2026; references/prompt-grid.md)

- `stylePresets`: one exact recipe as frozen codes: `moodboards` / `profiles`
  ({code, id?, name?}), `srefs` ({code, sv?, weight?}), `parameters`,
  `sentence`, `status` candidate | locked | archived, `source` gallery | dock
  | style, `styleId`, `parentPresetId` + `perturbation`. Indexes
  `by_owner_ingestKey`, `by_owner_world_updatedAt`. Journal `preset.save`.
- `promptSets`: named ordered `promptIds` of `lockedPrompts`, `kind`
  test_shots | locations | custom. Journal `promptSet.save`.
- `lockedPrompts.variants` ({key, label, kind short|prose|neutral, text,
  seeds}) and `attach` (Edit-model images); takes carry `presetId`,
  `variantKey`, `seed`.
- `promptRuns`: thread, stage screen | refine, draft, presets, prompts, jobs,
  `rowVerdicts` / `cellVerdicts` / `frameVerdicts` (keep | drop, Michael's),
  `frames` ({assetId, presetId, promptId, variantKey, seed, queueItemId}).
  Indexes `by_owner_world_createdAt`, `by_owner_threadId`.
- `mjQueueItems` gained `runId`, `presetId`, `presetLabel`, `variantKey`,
  `variantLabel`, `seed`, `screen`.
- Composition: `lib/prompt-grid.ts` (`presetFields`, `composeCell`,
  `planGrid`, `pacingEstimate`).

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
  - `addFolderIds` (asset updates) adds memberships without removing any, the way to file an asset into a storybook or world shelf while it stays on its style shelf. Saving or updating a Story with `storybookId` and `assetIds` links those assets into that storybook folder the same way (storybook asset lists read `assetFolders`, not `stories.assetIds`).
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
`ruleText`, `group` (the pictures the question is about when they are not the
options: `assetIds` 1–24, `total`, `label`). Indexes: stack/position, stack/key.

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

# In-place edits (1 November 2026)

`editJobs`: one row per model per take of a targeted edit on an image, sent
from the detail panel or the Inbox zoom (key E) or by an agent (`edit_asset`).
Fields: `sourceAssetId`, the source's `folderIds` and `worldFolderId` at send
time, `prompt`, `model` / `modelName`, the route in use (`provider` magnific,
fal or pika, `endpoint`), `requestId` with fal's `statusUrl` / `responseUrl`,
`attempts` (one per route tried, with `error` and `outOfCredit`), `retries`
(each Retry that sends again bumps it, giving a fresh idempotency key),
`status` queued / running / done / error with `error` and `errorKind`
(out_of_credit, provider, timeout, ingest), `estimateUsd`, `chargedUsd` with
`chargedExact` (true when Pika billed it; fal charges are the estimate),
`batch` / `take` / `of`, `refAssetIds` / `refNames` (<image-2> and on),
`refsDropped`, `resultAssetId` / `resultUrl`, `createdBy` owner or agent,
and since 5 Nov 2026 `takeMedia` (the landed picture: `r2Key`, `thumbR2Key`,
`thumbVariants`, size, dimensions, `contentHash`, generation `notes`),
`review` (pending, approved, discarded) and `reviewedAt`.

Routes, prices and request bodies live in `lib/edit-models.ts` (the routing
table since 3 Nov 2026: Magnific first where it has the model, on Michael's own
sign-in through its MCP server; krea-3 Magnific then fal; ideogram-precise
fal then Magnific; seedream-5 Magnific, Pika, fal; gpt-flare Magnific, fal, Pika;
gpt-sunburst fal then Pika; nano-21 Magnific then Pika; kontext-max fal). A
Magnific edit uploads the frame and references by URL into the Magnific
project named like the world (else "laniameda.gallery") and its `requestId` is
the creation identifier. A route whose provider has no key or sign-in is
skipped. A billing or auth refusal falls
through to the next route; a send of $30 or more is refused. A job with a
`requestId` is only polled, never resubmitted; Retry polls it again after a
timeout or a failed filing, otherwise sends a new request.

Ideogram 4.5 precise on fal is `ideogram/v4.5/edit` with `edit_precision:
"high"` (Precise Edit: unchanged pixels restored), `quality: "medium"`,
`image_size: "auto"`, the frame as `image_url` and up to four
`reference_image_urls`; $0.06 a take at any size (fal, 5 Nov 2026).

Review (5 Nov 2026). A landed take is `review: "pending"`: its picture is
stored on the job, not as an asset, so it appears in no grid, search, world
page, collection count or public view, only beside its source in Edit in
place (`list_asset_edits`). Approve (key 1, `review_asset_edit` approve) puts
the take on the source asset itself: the same asset id, tags, collections,
characters, comments and links, new media; search and the perceptual hash are
redone; the take's references become `generationLineage` role `other` on the
asset. Discard (key 2) sets `review: "discarded"`: the take stays on its job,
in the panel's Archive tray, and reopen brings it back to pending. Nothing is
deleted by either.

`assetVersions`: every picture an asset has been, append-only, written on
the first approval: `assetId`, `number` (1 is the original), `origin`
original or edit, `editJobId`, `modelName`, `prompt`, and the media fields
(`r2Key`, `thumbR2Key`, `storageId`, `thumbStorageId`, `sourceUrl`,
`contentType`, `contentHash`, size, dimensions, `thumbVariants`). The asset
row shows one of them, matched by media key (`r2Key`, else `storageId`, else
`sourceUrl`); `list_asset_edits` returns them as `versions` with `current`.
`restore_asset_version` copies a version's media back onto the asset.

Takes from before 5 Nov 2026 (no `review`) became their own assets with the
source's tags and collections, `edit_source` lineage and generation notes;
`editOf` still names their source. Deleting the source deletes its jobs, its
takes' pictures and its versions.

# Tasks (29 October 2026)

`tasks` is one piece of work in the agent queue ("Tasks" in the gallery,
`/tasks`): `ownerUserId`, optional `worldFolderId` (a root collection; absent
= studio-wide), `title` (160), `brief` (markdown, 6,000), `status` (open,
claimed, done, blocked, archived), `priority` (1 now, 2 next, 3 later),
`createdBy` (`owner` or `agent:<label>`), `assignee`, `claimedBy`,
`claimedAt`, `leaseUntil` (a claim lapses past it), `result` (markdown,
6,000: what was done, or the reasoning behind a blocked task's ask), `ask`
(blocked only, required since 1 Nov 2026: `{question` one line ≤140, `assetIds?`
context frames ≤8, `options: [{label` ≤60, `assetIds?` ≤6, `recommended?}]` 2–4`}`,
at least one frame, every frame his own asset; cleared when done), `links`
(typed handles `{kind: asset | story | stack | moodboard | character |
collection | doc | url, id, label?}`), `source` (manual, comment, inbox,
newspaper, feedback: a note from the Feedback button on any page, sourceRef =
the page URL), `sourceRef` (the comment or stack id), `ingestKey` (stable key:
`comment:<commentId>`, `inbox:<stackId>`, `feedback:<ms>`; creating again returns the existing
task), `needsRework` (Michael reopened a done task with a comment), `dueAt`,
`createdAt`, `updatedAt`. Indexes: owner/status/createdAt,
world/status/createdAt, owner/ingestKey, owner/updatedAt.

`taskEvents` is the task's timeline, oldest first: `taskId`, `kind` (create,
claim, release, status, comment, edit), `author` (`owner` or
`agent:<label>`), `body`, `from`, `to`, `createdAt`. Index task/createdAt.

An owner comment on an asset (not one left in the Inbox) files a task in the
asset's world; the first decision or card comment on an Inbox stack files one
task per stack. World tasks are journaled as `task.create` / `task.update`.
`open_world` returns `tasks: {open, claimed, blocked, next}`. Deleting an
asset strips its link from tasks. See `tasks.md`.

# Newspapers (30 October 2026)

`newspapers` is one edition of the morning newspaper per owner per Prague
date: `ownerUserId`, `date` (YYYY-MM-DD, Europe/Prague), `compiledAt`,
`since`, `until` (the 24-hour window the facts cover), `facts` (JSON of
`lib/newspaper-contract.ts` `newspaperFactsSchema`: per world the journal's
changes grouped by op, new assets with up to 12 thumbnails, new or changed
storybooks, moodboards with sync drift and characters, task counts; studio-wide
tasks done, created and blocked, open Inbox stacks, and `needsYou`), the
headline counts `done`, `needsYou`, `saved`, the agent's `prose` with
`writtenAt` / `writtenBy`, `status` (compiled, written), `compiledBy`,
`createdAt`, `updatedAt`. Index owner/date. Compiled by the daily cron
(`convex/crons.ts`, 05:30 UTC) or on demand; recompiling a date replaces the
facts and keeps the prose. See `newspapers.md`.

`assetHashes` holds one perceptual hash per image: `ownerUserId`, `assetId`,
`dHash` (16 hex characters, a 64-bit difference hash of the card thumbnail or
video poster), `createdAt`. Written a minute after ingest and by the backfill
`perceptualHash:backfillPerceptualHashes`; deleted with the asset. Indexes:
asset, owner. Read by the grid's Similar view and `find_similar_groups`.

`pictureJudgments` also keeps the agents' relevance checks (phrase
`relevance|<version>|<provider>|<hash of request and parts>|match` or `|whole`),
so the same request about the same piece is asked once per model.

`pictureJudgments` holds what the Decisions model answered when a search
asked about a picture ("does this show a car?"): `assetId`, `phrase`,
`probability`, `model`, `judgedAt`, one row per picture and phrase. Search
reads it before asking again. Internal; no agent tool writes it.

`assetClassifications` holds what the auto-tagger answered about a picture
(Jev / TypeSafe at `version` 1, OpenAI Decisions `gpt-6-luna` from version 2,
2 Nov 2026): `ownerUserId`, `assetId`, `model`, `version`, `status`
(done/error/no_image), `answers` (per question: `choice` + `confidence`, or a
yes/no probability `p`), `addedTagIds` (exactly the tags it added),
`classifiedAt`. Written about a second after ingest when the deployment sets
`TAG_CLASSIFY_ENABLED=true` and `OPENAI_API_KEY`, before the first describe /
index, and by `tagClassify:backfillTags` (asks again any picture below the
current version); deleted with the asset. Indexes: asset, owner +
classifiedAt. The questions and the tag rule are in `lib/facet-tags.ts`: it
only fills an empty slot (piece type, medium, setting, light, shot: wide-shot
or close-up) and adds a short list of facet tags (3d-render, character-sheet,
romance, horror, design + its kind, vehicle + angle, fashion, architecture)
when the model is sure; it never removes a tag a person or agent added.
Retired on 2 Nov 2026 because they did not help find world material: couple,
melancholy, glamour, world-detail, celebration, crowd, game-view, macro,
product (`assetClassifications:dropRetiredTags` took the classifier's copies
off). `assetClassifications:undoClassificationTags` takes back exactly the
added tags.

`assetShelfFilings` records auto-shelving: when a new picture is saved into a
world (or one of its children), Jev (TypeSafe System One, `jev-latest`) picks
the world's Places shelf and answers yes/no for each romance or love Moods
shelf, from their names and descriptions, and the picture is linked to the
ones it is sure of (confidence or yes probability ≥ 0.8). World building,
other Moods, Cast and Styles shelves are never auto-filed, and a group that
already holds a shelf of the picture (picked by hand) is skipped. Fields:
`ownerUserId`, `assetId`, `worldId`, `model`, `version`, `status`
(done/error), `answers`, `addedFolderIds` (exactly the shelves it added),
`error`, `filedAt`. Indexes: asset, owner + filedAt. Rule and questions:
`lib/shelf-rules.ts`; action `shelfClassify:fileOnShelves`, run after the
tagging step for new uploads only. Off unless `SHELF_CLASSIFY_ENABLED=true`
and `TYPESAFE_API_KEY`. `assetShelves:undoShelfFilings {assetIds}` takes the
added shelves back.

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


## Typed ids: one table

Ids copied from the gallery carry a prefix that says which object they are.
Each kind has one read tool and one argument name; `open_world` returns its
ids bare (no prefix), so the table also says where a bare id goes.

| Prefix | Object | Read with | Argument | Bare id accepted |
|---|---|---|---|---|
| `asset:<id>` | a piece of media | `get_gallery_item` | `id` | no: add `asset:` (preview_assets, find_similar and the filing tools take either) |
| `skill:<id>` | a reusable Skill | `get_skill` (or `get_gallery_item`) | `id` | yes; old `workflow:<id>` and migrated pack ids resolve through owner aliases |
| `pack:<id>` | a legacy asset pack: a duplicates stack is one | `get_gallery_item` | `id` | no; a pack that was migrated into a Skill resolves to that Skill |
| `design:<id>` | read-only legacy: an old browser-extension design capture | `get_gallery_item` | `id` | no; new design references are plain assets |
| `moodboard:<id>` | a moodboard | `get_moodboard` | `moodboardId` (`id` is an alias) | yes |
| `story:<id>` | a Story or style lock | `get_story` | `id` | yes |
| `character:<id>` | a named person; the code `DA-CH-001` is the usual handle | `get_character` | `character` (`id` is an alias) | code or `character:<id>` |
| `stack:<id>` | an Inbox stack | `list_inbox_decisions` | `stackId` (`id` is an alias) | yes |
| `card:<id>` | one Inbox card | `list_inbox_decisions` on its stack | `stackId` | — |
| `task:<id>` | a task | `get_task` | `taskId` | yes |
| `video:<id>` | a YouTube reference | `get_video_ref` | `id` | yes |
| `bookmark:<id>` | a saved X post | `list_bookmarks` (listed, not fetched) | `search` / `authorHandle` | — |
| `collection:<id>`, `folder:<id>` | a collection or shelf | `list_collections`, `open_world` | `folderId` (bare) | collections are addressed bare everywhere |
| `world:<id>` | a world's root collection | `open_world` | `world` (key, name or id) | yes |
| `profile:<id>` | a Midjourney profile | `mj_profiles` | `profile` (id, name or code) | yes |
| `brief:<id>` | a production brief of a project | `project_get` | `ref` | no |
| `lp:<id>` | a locked place (style-free prompt, wordings, seeds, brief images) | `project_get` | `ref` | no |
| `set:<id>` | a shot set | `project_get` | `ref` | no |
| `preset:<id>` | a look: one exact Midjourney recipe as codes | `project_get` | `ref` | no |
| `run:<id>` / `thr-xxxxxxxx` | a prompt run and its grid | `project_get` | `ref` | no |
| `style:<id>` | a world style | `get_style` (or `project_get`) | `style` | no |
| `inspiration:<id>` | an Inspiration-library reference | `get_inspiration` | `sourceId` | no |
| `style:<id>` | a world's named style | `get_style` | `style` (or its name with `world`) | yes |

`get_gallery_item` with another prefix answers with the tool that reads it;
with a bare id it asks for the prefix (a bare gallery id is almost always
`asset:<id>`). `pack:<id>` is live for the remaining asset packs and the
duplicates stacks the Inbox creates; the retired pack ids mentioned under
Native Skills below are the ones that were copied into Skills, and they
resolve to the Skill. `design:<id>` is kept readable for old saves and is not
documented as a target for new work.

## Private agent instruction resources

agentInstructions stores ownerUserId, resourcePath, content, version, sha256,
createdAt and updatedAt, indexed by owner/path. Signed owner reads retrieve the
private full worlds/maintenance resources; tracked public files only explain how
to fetch them. Generic storage holds policy text without hardcoding world names
or private IDs into backend logic. Resource replacement requires the last-read
expectedSha256; exact content/version retries are idempotent. Agents write it
with `update_skill_instructions {resource, content, expectedSha256, version?}`
(owner only, gallery:write; `POST /api/agent/instructions {action: "write"}`),
which calls `agentInstructions:saveResource` as the owner; the manifest hash
covers SKILL.md only, so a worlds.md edit needs no skill version bump.

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

## Asset hotkeys and private review notes

Owner gallery hotkeys apply to the hovered frame or the current expanded pack member.
`D` inserts an owner-scoped `assetArchive` ticket (`archivedAt`) and hides the
frame from its world page (`worldPageHiddenReason: "Archived (D)"`). Archive is
soft and has no timer: the asset stays dimmed and recoverable from the Archive
tray for as long as it is there. D again, double-click or Restore deletes the
ticket and undoes only archive's own world-page hide. The only way an archived
frame is deleted is **Delete for good** in the tray (`assetReview:purge`, at most
25 per call, archived frames only), Michael's explicit cleanup; each delete is
journaled (`via: archive.purge`). Until 7 Nov 2026 D scheduled a hard delete after
ten minutes with no journal entry (36 DEAR ANNETE frames went that way at
16:39 that day); jobs left from then run `finishDeletion`, which now deletes nothing.

`C` saves through native asset comments, which create Tasks for the next agent
routine. The existing reviewer-note shortcut retains priority in the expanded edit
view. `V` saves a private native Story with `kind: idea`, `status: idea`, its source
in `assetIds`, a stable per-save ingest key, and `agent-review` and `scene-note` tags.
On each routine, use `list_stories` with `search: "agent-review"`, `status: "idea"`
and inspect the linked assets before acting. These notes are owner direction,
not permission to spend beyond budget or publish. After handling a note, update
it with its revision guard and remove only `agent-review` from `tagNames` to
acknowledge it. Keep its text and source links. Saved notes do not themselves
launch an agent; the next routine must perform this read.

# Provider keys and connections (3 November 2026)

`providerCredentials`: one row per owner and provider (`fal`, `pika`,
`magnific`) set on the gallery's /settings page. `sealed` is AES-256-GCM
ciphertext (convex/providerVault.ts, key derived from PROVIDER_KEYS_SECRET or
AGENT_TOKEN_ISSUER_SECRET); `hint` is a key's last four characters, `account`
the Magnific sign-in's email. A key saved here wins over the deployment's
FAL_KEY / PIKA_API_KEY. Magnific is an OAuth connection (PKCE, public client)
whose tokens refresh themselves. No tool reads or writes these; agents never see
a secret, only whether a route can run (`list_asset_edits` → providers).

Edit in place has a reviewer note (key C): an owner comment on the image in
view (the take while its wipe is open) through `addAssetComment` with a
`context` line that goes into the task brief. It lands in Tasks as a
`source: comment` task for the reviewer agent.
