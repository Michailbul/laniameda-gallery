---
name: laniameda-gallery
description: >-
  Michael's gallery: save and find media, references, reusable Skills, Worlds,
  collections, tags, native Stories/Scripts, X bookmarks and separate YouTube
  research. Use for gallery saves, organization, reference selection and retrieval.
version: 1.5.0
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
a connector, use the dependency-free Bun client described in references/web-access.md.
Keep credentials in the environment; never print or paste tokens into reports.
Local source can be newer than the deployed contract until publication.

## The object model

| Object | Purpose | Tools / reference |
|---|---|---|
| Media asset | Generated image/video, production reference or external inspiration; may link to its prompt | save_asset / save_assets, list_assets_page, search_gallery, preview_assets; references/ingest.md |
| Skill | Reusable technique, recipe or tutorial with text and optional ordered prompt/media steps | create_skill, list_skills, search_skills, get_skill, update_skill, file_skill, delete_skill; references/ingest.md |
| World | A story universe represented by a root collection; production assets must fit its exact style | list_collections; authenticated references/worlds.md and native style locks |
| Collection | Where assets and Skills live; root plus at most one level of children | list_collections, create_collection, update_collection; references/ingest.md |
| Tags | Piece type, visual medium, platform, content, style and named model | list_tags, upsert_tags, add_tag_aliases; references/data-model.md |
| Story | Private text idea, script or style lock, linked to a world, visual storybook and source assets | save_story, list_stories, get_story, update_story; references/stories.md |
| X bookmark | The post's text, author, quote and note; linked to actual media when saved | save_bookmarks / list_bookmarks; references/bookmarks.md |
| YouTube reference | Separate video/channel research and copied stills; themes are labels rather than collection IDs | save_video_refs / list_video_refs / get_video_ref; references/video-refs.md |
| Curated view | Reusable gallery filter preset using owner menu-filter IDs | list_menu_filters, list_filter_presets, save_filter_preset; references/stories.md |

Motion and Cinematography are discovery views over tagged media/Skills, not new
storage objects. Read references/motion.md or references/cinematography.md.
An ordinary group of images belongs in a collection or asset pack. A Skill is
reusable knowledge; do not turn every group or prompt variation into a Skill.
Legacy table/function names containing workflow or folder are implementation
details. Use Skill and collection in explanations to Michael.

## Make media findable

Resolve named collections with list_collections first. Reuse an exact existing
name case-insensitively; ask before creating a missing collection unless creation
was requested. Pass folderIds for multiple memberships; the first is primary.
Leave a piece uncategorized when no destination was requested or clearly fits.

- Piece type: at most one of character, location, scene, inspiration. These are
  tags, never folders. Vehicle and costume-study are additional content tags.
- Medium: exact animation tag for illustrated, drawn, clay, stop-motion or
  stylized animated work. The current Live action filter includes everything
  without that tag, including photoreal rendered output; it does not prove footage
  was photographed. Judge the actual visual rather than its filename.
- Reuse existing tags; keep them lowercase, singular and hyphenated. Add about
  4–10 useful tags. Use typedTags and source: agent for inferred labels. Preserve
  the source's model name only when stated; never guess it from a look or prompt.
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
empty world. The Bun client's all_assets command collects complete pages.

Use preview_assets to visually compare numbered references before selecting;
get_gallery_item returns prompt, tags, source and media for asset:<id> or pack:<id>.
Search Skills, Stories, bookmarks and YouTube references with their own tools;
asset semantic search does not search every object. Inspect a video beyond its
poster before claiming anything about movement or the first 30 seconds.

## Filing and publication rules

Fetch authenticated references/worlds.md before filing, selecting world references,
writing a world story or generating a character. Read its native style lock too.
Current human direction governs creative intent; code/schema and live verified
behavior define supported payloads. Old memories, copied lists and historical
handoffs do not override a newer rule.

- Keep worlds and exact rendering lanes coherent. Styles are tags; retain
  established project parts. CASSANDRA and ART require Michael's request for
  reorganization. Read-only inspection is allowed during an authorized audit.
- Pinterest stays inspiration_capture in inspiration collections, with optional
  world-reference tags. Source WebP saves retain INSPIRATION VAULT and never join
  worlds/storybooks; derived WebP thumbnails are exempt.
- A visual storybook is a collection of selected frames; its evolving text belongs
  in native Stories/Scripts. Maintain links and revision history.
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
the original masters. A one-call three-view sheet is not this workflow.

Dear Annete's live-action cast must read as believable human photography, like
the Dari photoreal direction. Adding skin pores to a LIZ/Arcane/game-style face
does not qualify. Keep LIZ animated anchors and new live-action interpretations
separate in filing and storybooks; read `references/worlds.md` before generation.
Respect the user's cumulative budget and test scope rather than launching the
whole cast. Save full prompts, declared completions and stage/source provenance.


## Access and safe completion

1. Prefer authenticated Gallery MCP at https://gallery.laniameda.space/api/mcp.
2. Without MCP, run Bun scripts/gallery.mjs; token auth reaches the same tools.
3. Direct Convex scripts are local/admin compatibility tools only and require
   signed owner auth. Read authenticated references/maintenance.md first.

```bash
bun <this skill>/scripts/gallery.mjs check
bun <this skill>/scripts/gallery.mjs tools
bun <this skill>/scripts/gallery.mjs schema save_assets
bun <this skill>/scripts/gallery.mjs all_assets '{"pageSize":200}' --out ./inventory
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
