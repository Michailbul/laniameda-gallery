---
name: laniameda-gallery
description: >-
  Michael's gallery: save and find media, references, reusable Skills, Worlds,
  named Characters, collections, tags, native Stories/Scripts, X bookmarks and
  separate YouTube research. Use for gallery saves, organization, reference selection and retrieval.
version: 1.18.0
---

# Laniameda Gallery

The gallery holds Michael's production work and the work he likes. An agent
should choose the correct object, preserve provenance, organize it for retrieval,
and read it back before reporting a save complete.

## Start with the current contract

The discovery index is https://gallery.laniameda.space/llms.txt. Fetch
https://gallery.laniameda.space/skills/laniameda-gallery/SKILL.md and its sibling
manifest.json for the deployed version, content hashes and resource URLs.
Public resources come from the deployed repository. Owner-only world and
maintenance policies are private data served through the same skill paths;
public repository copies contain fetch instructions rather than private IDs.

With a connector, call get_skill_instructions for SKILL.md or a skill-relative
reference, then check_connection and discover the live tool schemas. Without
a connector, run the dependency-free client (Node 20+ or Bun) described in
references/web-access.md; it reads the token from LANIAMEDA_GALLERY_AGENT_TOKEN
or, when that is unset, from `~/.config/laniameda/gallery.env`.
Keep credentials in the environment; never print or paste tokens into reports.
Local source can be newer than the deployed contract until publication.

## Worlds first

A world (DEAR ANNETE, ANDROMEDA — ANYA …) is a separate story universe. For any
world work call `open_world` first: it returns the world's own rules (WORLD.md),
learnings, styles and style locks, shelves, storybooks with their stories,
moodboards with codes and sync state, Midjourney profiles and recent changes.
Search with `world` to stay inside it. Change it through `world_doc`,
`world_file`, `world_shelf`, `mj_profiles` and the moodboard and story tools,
with a `session` label; `world_journal` shows every change and `world_undo`
reverts one or a whole session. An asset never belongs to two worlds. Shelves,
storybooks and moodboards stay in their world on every ordinary edit; the one
deliberate way across is `world_move` (dry run first, journaled in both
worlds, undone as a whole by `world_undo`). A collection count that looks
wrong is checked by paging `list_assets_page {folderId}` to `isDone`, then
repaired with `world_recount` (dry run first). The
Claude Code plugin `laniameda-gallery` (repository folder `plugin/`) teaches
this loop in its `gallery-worlds` skill.

## Links Michael can open

Every view of the gallery is a URL, and the read tools return it as `url` so a
report can link what it names: `open_world` (the world, each shelf, storybook,
moodboard and story; `instructionsUrl`, `tasksUrl`, `journalUrl`),
`list_collections` (each collection), `list_moodboards` / `get_moodboard` and
`get_story`. The pages: `/w/<worldKey|rootId>`, `/w/<world>/<shelfId>`,
`/w/<world>/instructions|journal|tasks|moodboards`, `/storybooks/<id>`,
`/moodboards/<id>`, `/stories/<id>`, `/skills/<id>`, and `?asset=<id>` on any of
them opens that piece in the detail panel. Prefer the returned `url` over
building one; the inbox tools already return a stack's `url` the same way.

## The object model

| Object | Purpose | Tools / reference |
|---|---|---|
| Media asset | Generated image/video, production reference or external inspiration; may link to its prompt | save_asset / save_assets, list_assets_page, search_gallery, preview_assets; references/ingest.md |
| Skill | Reusable technique, recipe or tutorial with text and optional ordered prompt/media steps | create_skill, list_skills, search_skills, get_skill, update_skill, file_skill, delete_skill; references/ingest.md |
| World | A story universe represented by a root collection; production assets must fit its exact style | list_collections; authenticated references/worlds.md and native style locks |
| Character | A named person in one world with a stable code (DA-CH-001), costumes (-C01), a canonical sheet and face, and typed links to every asset that shows them | list_characters, get_character, create_character, update_character, save_character_costume, link_character_assets; references/characters.md |
| Collection | Where assets and Skills live; root plus at most one level of children. A child can carry a display group (Styles, Places, Cast) and sortOrder | list_collections, create_collection, update_collection; references/ingest.md |
| Asset comment | Michael's note on one asset from its detail panel or the Inbox (text, or a voice note: audioUrl, transcribe it yourself), or an agent's reply; read them before working on a piece and reply with what was done | get_gallery_item (comments), list_asset_comments, add_asset_comment |
| Moodboard | An ordered set of gallery images that defines one look, mirrored to a Midjourney moodboard and its --profile code; belongs to one collection | list_moodboards, get_moodboard, save_moodboard, add_moodboard_items, reorder_moodboard_items, set_moodboard_midjourney, list_moodboard_generations; references/moodboards.md. Any change to a board's images is synced to its Midjourney board before the edit is done (rule in that file) |
| Inbox stack | A world's decisions for Michael ("Decisions" in the gallery): stacks of sort, duplicates, artifact, A/B, choose-one and rule cards. Agents state facts and never judge taste; he decides; agents apply and learn | post_inbox_cards, list_inbox_stacks, list_inbox_decisions, close_stack, find_similar_groups; references/inbox.md |
| Task | One piece of work in the queue ("Tasks" in the gallery, /tasks): Michael's asset comments and Inbox answers become tasks by themselves; agents list, claim (a lease), work and complete with a result naming the ids produced, or blocked with a question for him. Start every session or cron run with list_tasks | list_tasks, get_task, create_task, claim_task, release_task, complete_task, comment_task; references/tasks.md |
| Newspaper | One edition per Prague day (/newspaper), compiled at 07:30 from the tables: per world the journal's changes, new assets with thumbnails, storybooks, moodboards with sync drift, characters; tasks done and blocked, open Inbox stacks, and needsYou. Pure facts; an agent adds the prose. Never stars, publishes or deletes | get_newspaper, write_newspaper, compile_newspaper; references/newspapers.md |
| Tags | Piece type, visual medium, platform, content, style and named model | list_tags, upsert_tags, add_tag_aliases; references/data-model.md |
| Story | Private text for any story worth keeping, from any source: narration, post, article, premise, own idea, script. World-free by default; style locks are the world-only kind | save_story, list_stories, get_story, update_story; references/stories.md |
| Storybook | A collection (kind storybook) holding one production-ready episode of 60 seconds or less: plain story, cast with character sheets, location plates and descriptions, asset links, gap flags | create_collection, update_collection, update_gallery_item; references/storybooks.md |
| X bookmark | The post's text, author, quote and note; linked to actual media when saved | save_bookmarks / list_bookmarks; references/bookmarks.md |
| YouTube reference | Separate video/channel research and copied stills; themes are labels rather than collection IDs | save_video_refs / list_video_refs / get_video_ref; references/video-refs.md |
| Curated view | Reusable gallery filter preset using owner menu-filter IDs | list_menu_filters, list_filter_presets, save_filter_preset; references/stories.md |
| Midjourney sref library | Liked style codes/mixtures with version settings, source prompts and saved examples in a normal collection | save_sref / list_srefs; references/midjourney-srefs.md |

Motion and Cinematography are discovery views over tagged media/Skills, not new
storage objects. Read references/motion.md or references/cinematography.md.
An ordinary group of images belongs in a collection or asset pack. A Skill is
reusable knowledge; do not turn every group or prompt variation into a Skill.
Legacy table/function names containing workflow or folder are implementation
details. Use Skill and collection in explanations to Michael.

## Inspiration intake

When Michael sends raw material with a project name ("this is for Anya",
"cars", "NOISE"), run the intake procedure in references/intake.md: sort each
item to its world, save a clean UI-free source as inspiration, make the world's
own processed version by its native style lock, save both with lineage, show
the batch on the project board and report. A video or scene whose story he
likes runs further: take it apart into frames, beats and a source-analysis Story,
then, once he names a world, write the treatment, do pre-production (cast sheets,
location plates, style frames) and package it as a storybook. Be proactive; ask
only about a truly ambiguous destination, a casting choice that is his, or a
cost above the limits there.

## Make media findable

Resolve named collections from `open_world`'s shelves, or with
`list_collections` filtered by `world` (or `parentFolderId`, `rootsOnly`,
`search`); the unfiltered list is the whole vault. Reuse an exact existing
name case-insensitively; ask before creating a missing collection unless creation
was requested. Pass folderIds for multiple memberships; the first is primary.
Leave a piece uncategorized when no destination was requested or clearly fits.

- Piece type: exactly one of character, location, scene, inspiration. These are
  tags, never folders. Vehicle and costume-study are additional content tags.
- Medium: exact animation tag for illustrated, drawn, clay, stop-motion or
  stylized animated work. The current Live action filter includes everything
  without that tag, including photoreal rendered output; it does not prove footage
  was photographed. Judge the actual visual rather than its filename.
- Reuse existing tags; keep them lowercase, singular and hyphenated. Add about
  up to 5 useful tags. Read the world's `docs/tags.md` (from `open_world`) first;
  saves fold case, `-`, `_` and punctuation into one tag and `add_tag_aliases`
  redirects spellings, so call `list_tags` only filtered (`search`, `category`,
  `minUsage`; slim rows, paged), never whole. Use typedTags and source: agent for
  inferred labels. Preserve the source's model name only when stated; never guess
  it from a look or prompt.
- Write agentDescription on agent-created media and video references: one or two
  plain sentences, at most about 45 words/400 characters, describing the actual
  subject/look and why it was kept. Keep Michael's caption in description and his
  own notes in userNote. Stories use title/body; Skills use title/description/body.
- Preserve sourceUrl as the original post/page permalink, full prompt and
  generation parameters, assetRole, ingestSource: agent, and stable ingestKey.
  Use inspiration_capture for someone else's work, reference for material pulled
  into production, generated_output for Michael's own result.

The API accepts some incomplete metadata for compatibility. An accepted upload
is not yet a complete agent save if its provenance or retrieval fields are missing.
Semantic indexing is asynchronous; stored readback and search readiness are
separate checks. Leave the retired pillar field unset on ordinary saves.

## Find and inspect

Use search_gallery for meaning or visual similarity; find_similar expands around
an asset. Use list_assets_page with filters and its opaque cursor for a complete
inventory. Continue until isDone: true; list_assets is a bounded convenience read.
For a world, includeDescendants includes its parts; an empty root does not mean an
empty world. For a complete unfiltered inventory use the Bun client's
all_assets command: it downloads the cached export (rebuilt at most daily, plus
assets saved since) instead of reading every asset again. With filters, or
{"live":true}, it pages list_assets_page.

Use preview_assets to visually compare numbered references before selecting.
List and search rows are projections (ids, caption, agentDescription, tags,
collections, urls, a 300-character prompt excerpt); get_gallery_item returns
the full prompt, tags, source and media for asset:<id> or pack:<id>, and
get_story the full text of a story. references/query.md lists each read's size
and knobs.
Search Skills, Stories, bookmarks and YouTube references with their own tools;
asset semantic search does not search every object. Inspect a video beyond its
poster before claiming anything about movement or the first 30 seconds.

## Filing and publication rules

Fetch authenticated references/worlds.md before filing, selecting world references,
writing a world story or generating a character. Read its native style lock too.
Current human direction governs creative intent; code/schema and live verified
behavior define supported payloads. Old memories, copied lists and historical
handoffs do not override a newer rule.

- Keep real project/world material together, including useful outside references
  and alternate styles. Select a coherent rendering lane for each produced scene
  or storybook; style alone does not decide world membership. CASSANDRA and ART
  require Michael's request for reorganization. A full-gallery audit and sorting
  request supplies that authorization; read-only inspection is always allowed.
- Pinterest and other outside work stay inspiration_capture with the inspiration
  piece type and source credit. Use ART/DESIGN and cross-file into genuine projects
  or worlds when useful; a reference remains a reference. File extensions do not
  determine ownership. Do not recreate INSPIRATION VAULT, REUSABLE ASSETS or
  exploration/development shelves.
- A storybook is a production package, not a grid of frames. Before creating,
  auditing or editing one, read references/storybooks.md. It must carry a plain
  60-second-or-shorter episode, a character sheet in the original style for every
  character, a plate and description for every location, the asset links to feed
  Seedance 2.5, and a status with explicit gap flags. Never leave a missing
  character or place unflagged. Longer or source text lives in a native Story.
- Preserve public, featured and liked flags when filing. Michael's curator star
  publishes/features an asset; never star, publish, feature or set the public taste
  collection unless requested. Non-curator stars are private; isLiked is separate.
- Save a generation prompt with its actual result media. If that requested media
  is unavailable, report it and ask before a prompt-only fallback. Native textual
  Stories and explicitly requested text recipes need no placeholder media.
- Extract text from a screenshot whose payload is a prompt; do not treat that
  screenshot as the generated result. External inspiration and website screenshots
  remain valid media assets when they are the requested reference.
- For an X media save, capture every attachment, full prompt and every --sref;
  use the post permalink, then link bookmark text. Bookmarking a post alone can
  retain only its preview; that is not an original-video save.

## Character-sheet generation

For Michael's character sheets, use `leera-character-reference-sheet`: generate
a detailed face close-up first, review it, generate separate front/back body
masters from the original design plus accepted face, then assemble with only
one visible face. Suppress the front-body face in the final composite and retain
the original masters. A one-call three-view sheet is not this workflow. A sheet
is drawn in the same style as the original reference with an identical face; a
new character such as a daughter is designed from the anchor's look first.
Every character in a storybook needs one (references/storybooks.md).

Before generating any character, call `open_world` for its world and follow
that WORLD.md's cast rules and current style lock; the skill carries no
per-world canon. Respect the user's cumulative budget and test scope rather
than launching the whole cast. Save full prompts, declared completions and
stage/source provenance.


## Access and safe completion

Deletion needs both technical access and the user's explicit approval. Before
calling delete_collection or delete_filter_preset, name the targets and explain
the consequences, then obtain approval for that named collection/preset or
clearly listed batch. Approval already given for those targets in this session
persists; do not ask again after access is granted. General organization, vague
cleanup requests, Write access and enabling Delete do not approve future deletions.

The `gallery:delete` scope is a separate permission gate. If it is missing, the
signed-in owner can edit an active manual token's permissions at `/agents`.
Delete is off by default. OAuth tokens require reconnection and fresh owner
consent; agents cannot upgrade themselves or bypass permission checks.

Deleting a collection removes its shell and membership links, preserving assets,
prompts, Skills and native story text. Children become root collections. Its
route disappears and story/preset links may need repair. Deleting a filter preset
removes only that saved view. These approval rules are agent instructions, not a
claim that an agent-supplied flag proves human consent.

1. Prefer authenticated Gallery MCP at https://gallery.laniameda.space/api/mcp.
2. Without MCP, run scripts/gallery.mjs with `node` (20+) or `bun`; token auth
   reaches the same tools. The token comes from `LANIAMEDA_GALLERY_AGENT_TOKEN`
   or, when that variable is empty, from the `export` line in
   `~/.config/laniameda/gallery.env` (override the path with
   `LANIAMEDA_GALLERY_ENV_FILE`). Michael issues tokens at /agents; never
   guess or print one. `scripts/mcp-headers.sh` is only the `headersHelper`
   for a repo `.mcp.json` static header, not part of this fallback.
3. Direct Convex scripts are local/admin compatibility tools only and require
   signed owner auth. Read authenticated references/maintenance.md first.

```bash
node <this skill>/scripts/gallery.mjs check
node <this skill>/scripts/gallery.mjs tools
node <this skill>/scripts/gallery.mjs schema save_assets
node <this skill>/scripts/gallery.mjs all_assets --out ./inventory
```

Upload local bytes with prepare_uploads, run its returned PUT commands, then
save_assets using uploadId (up to 50 per batch). Supply posterUploadId for video
cards. To change an existing video's poster, use set_video_poster; replacing media
with an image changes the actual asset and is not a thumbnail edit.

Read back persisted IDs, memberships, tags, source, prompt and media after saves.
Partial saves can return HTTP 207 with ok:false, partial:true, persisted result,
failedStep and requestedFolderIds. Inspect/repair that ID rather than creating a
fresh duplicate. Batches report persisted and partial counts per item. Stable
ingest keys make create retries safe; use update for replacements and additive
membership/tag deltas for filing. Pass the last-read expectedRevision on Story
changes; exact retries/new Stories have their own idempotent save behavior.

See references/web-access.md for the importable client, references/ingest.md for
writes, references/query.md for retrieval, and references/data-model.md for schema.
Report what was saved, skipped or remains partial; never equate a running job,
preview, draft or an API acceptance with a verified final asset.
