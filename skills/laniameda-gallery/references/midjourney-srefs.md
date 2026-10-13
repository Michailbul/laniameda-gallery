# Midjourney srefs

Michael keeps liked Midjourney style references in a normal private collection
named `Midjourney Srefs`. Resolve its ID with `list_collections`. Reuse the exact
name case-insensitively; create it only when requested. This is a shared style
library, not a fictional world or a native reusable Skill.

## Save a source

For an X post, call `save_bookmarks`, then read back `list_bookmarks` to extract
every attachment and its ALT prompt. Save all original images/videos with
`save_assets`, the original post permalink as sourceUrl, full promptText and
every `--sref`. Use stable per-attachment ingest keys, inspiration_capture for
outside examples, and useful tags such as inspiration, midjourney and sref.
Re-save the bookmark to link the stored attachments. Preserve publication flags.

Do not infer a code, model version or style version from an image's appearance.
Keep codes as strings, including leading zeros and long values. Retain code
mixtures, per-reference weights, `--sw`, `--sv` and the stated `--v`. The same code
can behave differently across versions. `--sref random` is not a reusable saved
code; obtain the resolved code first.

## Save and retrieve recipes

`save_sref` takes folderId, parameters, optional title, note and sourceUrl.
Parameters may be a bare numeric code or an entire recipe, e.g.
`--sref 3534013297 --sw 500 --v 8.2`. Numeric mixtures and HTTP(S) image-reference
URLs are supported. This explicitly requested text recipe needs no image.
Actual example media should still be saved separately with its full prompt.

The save is idempotent per owner, collection and exact normalized parameters.
It returns promptId, created and parameters. Exact retries preserve the original
note; they do not act as edits. Metadata edits use update_gallery_item targeting
the returned prompt, preserving domain and the finalPrompt/generationNotes
representation below.

`list_srefs` takes folderId and optional search. It reads all direct members of
that collection, groups identical parameter combinations and returns value,
parameters, modelVersion/styleVersion/styleWeight when stated, title/note,
sourceUrls, promptIds and saved examples with URLs/full prompts. It does not
include child collections. Search matches all words across those fields.
Always read back the saved recipe and its actual examples before reporting done.

## Implementation contract

No new table: media and bookmarks retain their existing representation. A text
recipe is a prompts row with domain `midjourney-sref`, modelProvider midjourney,
promptType other, workflowType asset_recipe and its collection folderId. promptSections.finalPrompt
holds the normalized recipe. promptSections.generationNotes contains JSON with
optional title, note and sourceUrl. prompt text also retains those fields for
normal keyword/semantic retrieval. These records are private and do not change
asset likes, curator stars or publication flags.

The owner UI opens the library from the collection, with search, a Save sref
form, source links and Copy sref / Copy with settings / Copy prompt buttons.
The MCP tools use `/api/agent/srefs`, action list/save, with gallery:read or
gallery:write respectively. Discover live tools before use: local instructions
may precede deployment.
