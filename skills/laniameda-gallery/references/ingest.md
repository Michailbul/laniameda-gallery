# Save, revise and file gallery objects

Read SKILL.md first. Resolve the object: media, Skill, collection/World, native
Story, X bookmark or YouTube reference. These are separate contracts. Human
direction governs filing/publication; a valid API payload alone is not permission.

## Media and collections

1. Resolve existing names with list_collections. Creation must be requested or
   approved when a named collection is missing.
2. Inspect the actual media. Provide agentDescription, sourceUrl where applicable,
   useful tags, assetRole, ingestSource: agent and a stable ingestKey.
3. Upload local files with prepare_uploads, run the returned PUT commands and use
   uploadId in save_asset/save_assets. A public image/video URL can use url.
4. Pass folderIds for every requested membership; the first is primary.
5. Inspect per-item results, then read the saved ID back. Verify original media,
   prompt, provenance, tags and collection names.

save_assets accepts up to 50 items. Save retries with the same key/identical
content hash reuse the original asset and merge requested organization
additively. A create retry is not a replacement or general metadata update.
API tags/description can be optional for compatibility; agent media saves still
need meaningful retrieval fields. Keep description for Michael's caption and
agentDescription for the agent's visual account.

create_collection supports parentFolderId for a plain child collection and
kind: storybook for a root visual book. One nesting level is supported; books do
not nest. Collection objects are folders internally. Piece types character,
location, scene and inspiration are tags rather than section folders.
Read the live update_collection schema for supported rename, parenting and other
controls. Do not infer publication or cover changes from a collection save.

## Update and partial results

update_gallery_item with target: asset or prompt changes the specified record.
tagNames and folderIds are full replacement sets; omitted fields are preserved,
folderIds: [] clears memberships. For filing, read current values and make minimal
deltas, preserving unrelated memberships/tags and all public/featured/liked flags.
If additive fields are offered by the current schema, prefer them for additions.

Asset update with file/url replaces the underlying media. It does not update
only a thumbnail. Prompt update with media attaches/replaces a linked asset using
assetIngestKey. Use selectors from returned IDs/keys, not guessed IDs.

Requested collection IDs and upstream lineage sources are checked before writes;
replacement media is processed before changing prompt text or asset metadata.
A later media, lineage, inspiration or filing failure can return HTTP 207:
ok:false, partial:true, persisted IDs/result, failedStep and error. Filing errors
also include requestedFolderIds. Batch results report partial/persisted counts
and persisted IDs per item. Read those IDs and repair the failed step; retry with
the original stable key rather than creating another record.

## Video and posters

For hosted/local token tools, upload video plus JPEG/PNG poster and pass uploadId
and posterUploadId. Invalid or foreign poster slots reject rather than silently
discarding the poster. Supply real dimensions and inspect playback/audio when
the task needs a verified video; a poster confirms only one still.

To change an existing poster, upload the new still and call set_video_poster:

```json
{"assetId":"<video asset ID>","posterUploadId":"<uploaded still slot>"}
```

This thumbnail-only operation requires gallery:write and an owned video. It
preserves video bytes, kind, prompt and filing. Never point normal media update at
an image when the intended change is only a poster.

The local/admin direct ingest.ts path prepares video with ffprobe dimensions,
browser-compatible remux, poster extraction and direct R2 upload. The same path
works for Skill step videos; r2Key, dimensions and posterFile are supported.
Direct updateFromApi is a separate older base64 path and lacks R2 replacement.
Prefer token tools; read authenticated maintenance notes for admin compatibility.

## Skills

A Skill is reusable knowledge: a technique, tutorial or recipe with a markdown
body/how-to instructions and optional ordered prompt/media steps. Collections
group ordinary assets. Shared prompts and asset packs group related media;
they do not automatically turn that group into a reusable Skill.

create_skill requires title and stable ingestKey, plus a body, agentInstructions
or at least one step. Markdown-only Skills are supported without fabricated media
or prompt-only approval. Optional description, tagNames and folderIds organize
the card. Steps take promptText and optional modelName/modelProvider/tagNames/media;
each media entry uses exactly one url, uploadId or fileBase64. Videos also take
posterUploadId. Preserve factual source and stage provenance on step media.

```json
{"ingestKey":"skill:contact-sheet-review:v1","title":"Review a reference contact sheet","description":"Choose compatible references and preserve their source IDs.","body":"# Steps\n1. Narrow by tags.\n2. Inspect the numbered previews.\n3. Read the selected IDs back.","tagNames":["reference-review"]}
```

Identical create_skill retries return the existing Skill unchanged. Reusing
the same ingestKey with changed content rejects; use update_skill for edits.
Incomplete multipart creation can return HTTP 207 with partial:true, skillId
and failedStep. Retry the same request/key to resume, keeping its persisted
Skill ID; do not create another recipe. Read with get_skill; list/search use
list_skills/search_skills. update_skill
changes body/metadata/tags; file_skill adds/removes collection membership.
delete_skill deletes only the organizing
recipe/filing and preserves original step prompts/media as standalone assets.
Use only when Michael requests deletion; inspect the schema before use.
Cinematography Skills carry cinematography and appear in their dedicated view.
Skill examples are stored as skill_example and normally stay out of the main media
grid; semantic search can still retrieve an intermediate frame.

Native storage/functions are skills/skillFolders and skills:*. Canonical handles
read skill:<native-id>. Previously copied workflow/Skill IDs and retired pack IDs
resolve through owner aliases for read/update/delete/filing. They do not create
new Workflow containers. The direct script supports operation: skill; the old
operation spelling remains an input alias. The public create_skill contract has
no pillar requirement; do not ask Michael to choose one.

## Prompts, Stories and bookmarks

A saved generation prompt normally links to its actual image/video. Only use
save_prompt/allowPromptOnly when Michael requested or approved a text-only prompt.
Native Stories/Scripts are intentionally textual: save_story for ideas, scripts,
style locks, without placeholders. Read references/stories.md for revision guards.
An X bookmark stores post text/preview, not necessarily original attachments;
read references/bookmarks.md and extraction.md for complete-media saves.
YouTube research uses videoRefs, not ordinary media ingest.

## World filing and public presentation

Fetch authenticated references/worlds.md and the native style lock before filing
or story production. Preserve exact look/cast, source membership and existing
public routes, covers and flags. Pinterest is inspiration; source WebP policy is
in the private world contract, with derived thumbnails explicitly exempt.

Showcasing a collection publishes the set identity, never its private members.
A world page shows individually public assets. Michael's curator star publishes
and features a piece; unstarring leaves it public. isLiked is private/separate.
Only perform requested publication. Verify the resulting public world/home reads
before claiming a public change complete; backend flags alone do not prove routing.

## Cinema frames and generation lineage

Film frames have no generation prompt. The specialized local/admin
cinemaInspiration:ingestCinemaFrame contract takes media and cinemaMetadata with
movieTitle; use factual observations and mark uncertain camera/lens claims.
Do not pretend an inferred focal length is source metadata. They carry the
legacy cinema-inspiration pillar and cinema_frame role internally.

upstreamInputs records a result's starting image, edit source, style or motion
reference. Use source IDs or stable keys already saved; unresolved sources reject.
Lineage is separate from grouping a collection and separate from a reusable Skill.

## Completion

Read back stable IDs, media, tags, source, prompts and requested memberships.
Report created, reused, partial and skipped items accurately. Indexing happens
later; media storage, searchable readiness and verified final quality are distinct.
The signed local/admin scripts require CONVEX_AUTH_PRIVATE_KEY and owner env;
token clients never supply ownerUserId. Never log credentials or signed upload URLs.
