# Textual stories, scripts, style locks and filter presets

Stories are private textual records, separate from visual storybook collections,
prompts, assets, Skills, and YouTube video research. Their sidebar section is
**Stories / Scripts**. They never require an image or `allowPromptOnly`.

## Save and retrieve

Use `save_story` with a stable `ingestKey`, `title`, and full `body`. Kind is
`idea`, `script`, or `style-lock`. Status is `idea`, `draft`, `ready`, or `archived`.
Optional fields: `logline`, `hook`, `folderId` for the world/format, `styleTag`,
`tagNames`, `assetIds`, and `storybookId` for its visual board. Resolve collections
and source assets first. A world story must use one compatible look. A source
reference is not a generated scene or a verified final.

```bash
bun skills/laniameda-gallery/scripts/gallery.mjs save_story '{"ingestKey":"story:ann:missed-tram:v1","title":"The missed tram","body":"She is already running when the doors shut. ...","kind":"script","status":"draft","tagNames":["relationship","short-story"]}'
bun skills/laniameda-gallery/scripts/gallery.mjs list_stories '{"search":"tram","status":"draft"}'
bun skills/laniameda-gallery/scripts/gallery.mjs get_story '{"id":"story:<id>"}'
```

`list_stories` filters by `search`, `folderId`, `kind`, `status`, and `limit`
(1–500, default 200). Results include full text. The browser offers world,
status, and type filters and keyword search over the returned texts.

## Revise without losing the original

`update_story` takes `id`, changed fields, and `expectedRevision` from the last
read. Revisions preserve the old full text and metadata. A stale edit is rejected;
reload and reconcile instead of overwriting. Exact retries of `save_story` do not
create extra versions. `get_story_revisions` retrieves older versions.
Omitted fields are preserved on a patch; `folderId: null` and `storybookId: null`
explicitly clear those links. A root world filter includes its format children.
`get_story` returns `linkStatus` alongside the text. If linked assets or folders
were deleted later, remove only the unavailable links before saving; prior
revisions retain the original source IDs. The browser offers this repair action.
`delete_story` permanently removes the text and history, only on an authorized
deletion request. Archiving changes status and keeps history.

## World style locks

Keep one `kind: "style-lock"` entry for each world/format/look, with a stable
`ingestKey` such as `style-lock:<world>:<look>`. Lock rendering medium, geometry,
palette, light, architecture, cast identity and wardrobe, forbidden mismatches,
and actual anchor `assetIds`. Update the same record as the direction evolves,
using `expectedRevision`. Read it and `worlds.md` before creating scenes or sheets.

Dear Annete's main animation direction is LIZ. Older painted/cel explorations
are development material; Unreal Engine and real live action stay separate.
The combined Daddy Issues / Retro-future universe has distinct look tags and
never combines incompatible looks in one visual storybook.

## Gallery presets

`list_filter_presets` reads saved filter combinations. `save_filter_preset`
upserts by name. Filters are `selectedFilterIds` and `excludedFilterIds` of
curated **menuFilters**, not tag IDs, plus `folderId`, `mediaKind`, `onlyLiked`,
`includeSkills`, `flattenStacks`, and `sortOrder`. Positive pills are AND groups;
each pill's tags are OR. Exclusions win. The UI refuses a preset whose filter
or collection has been deleted. Save it again under the same name to repair it.
An included filter with no available tags is refused rather than displaying
the entire gallery.

Starter presets: No skills, Inspirations, Animated characters, Locations,
Game views. No skills hides Skills cards in the main grid and inside collections;
the dedicated Skills section remains accessible. `delete_filter_preset` removes
only the preset. It never deletes an asset or changes publication.

## Contract

Tables: `stories`, `storyRevisions`, `galleryPresets`. All functions use signed
owner auth, even while older gallery functions allow the legacy rollout fallback.
Agent routes `/api/agent/stories` and `/api/agent/presets` require
gallery:read, gallery:write or gallery:delete according to action. Both MCP
servers register those routes. Story saves validate owner access to every linked
collection and asset. Backend: `convex/stories.ts`, `convex/galleryPresets.ts`,
`convex/storyValidators.ts`; shared API schemas: `lib/story-contract.ts`.
