# Stories, scripts, style locks and filter presets

**Stories / Scripts** is Michael's private place for any story worth keeping.
It is not tied to a project, a world or the Laniameda cast. A story can come from
anywhere: a narration he heard, a transcript, a post, an article, a film or
book premise, a dream, a joke, a one-line idea he typed. It is saved so he can
find it later and, when he wants, adapt it into an episode. Stories are private
text records, separate from visual storybook collections, prompts, assets,
Skills and YouTube video research. They never require an image or
`allowPromptOnly`.

## What to save

Save the story, whatever its source and shape.

- `kind: "idea"` is the default for inspiration: a premise, a narration, a
  retelling of something found, a rough thought. This is the right kind for
  almost everything saved from outside.
- `kind: "script"` is text written to be filmed or voiced: scenes, beats,
  dialogue, a narration meant for production.
- `kind: "style-lock"` is only for a world's look (below). Never use it for a
  story.

Status: `idea` for a raw capture, `draft` while it is being shaped, `ready` when
Michael calls it done, `archived` to shelve it. Keep the story's own wording.

## Capture rules for found stories

- Save the original wording as found, in `body`. Do not summarize it away, rewrite
  it into Michael's project, or add characters from his worlds. If he wants an
  adaptation, save it as a second record that links to the first.
- Start `body` with a short source block, then a blank line, then the text:
  `Source: <url or title, author, medium>`, `Found: <date>`, and `Form:` for how
  it reached him (narration, transcript, post, article, own idea). Mark what is
  quoted and what is the agent's own note. Never invent a source or an author.
- `logline`: one plain sentence of what happens. `hook`: the first image or
  action. Both are the agent's reading, so keep them factual and name the same
  characters the body names.
- `tagNames`: a few retrieval words (genre, mood, setting, length). Reuse
  existing tags. Piece-type tags (character, location, scene, inspiration) are
  for media, not stories.
- `folderId` and `styleTag` are optional. Leave them empty when the story
  belongs to no world. Do not file a found story under a world just because it
  could fit.
- A story with several parts or episodes is one record per self-contained
  episode, each runnable under a minute. Long originals are kept whole in one
  record and referenced from the episode records.

## Save and retrieve

Use `save_story` with a stable `ingestKey`, `title`, and full `body`. Optional
fields: `logline`, `hook`, `folderId` for the world/format, `styleTag`,
`tagNames`, `assetIds`, and `storybookId` for its visual board. Resolve
collections and source assets first. A world story must use one compatible look.
A source reference is not a generated scene or a verified final.

```bash
bun skills/laniameda-gallery/scripts/gallery.mjs save_story '{"ingestKey":"story:found:missed-tram:v1","title":"The missed tram","body":"Source: a radio narration, Czech Radio, heard 9 Oct 2026\nForm: narration\n\nShe is already running when the doors shut. ...","kind":"idea","status":"idea","tagNames":["relationship","short-story"]}'
bun skills/laniameda-gallery/scripts/gallery.mjs list_stories '{"search":"tram","status":"draft"}'
bun skills/laniameda-gallery/scripts/gallery.mjs get_story '{"id":"story:<id>"}'
```

`list_stories` filters by `search`, `folderId`, `kind`, `status`, and `limit`
(1–500, default 200). Results include full text. The browser offers world,
status, and type filters and keyword search over the returned texts.

## From story to storybook

A story becomes a storybook only when Michael asks for production. Then follow
references/storybooks.md: pick one episode (60 seconds at most, starting in the
action), list its cast and places, find or flag character sheets and location
plates, and write the book's status and gaps. The story stays as the source;
the storybook holds the production adaptation. Link them with `storybookId`.
Adapting a found story into one of Michael's worlds needs his say-so and the
world's authenticated rules.

## Revise without losing the original

`update_story` requires `id`, changed fields, and a positive `expectedRevision`
from the last read. Re-saving changed text under an existing `ingestKey` also
requires its last-read revision; omit it only for a new record or an exact retry.
Revisions preserve the old full text and metadata. A stale edit is rejected;
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
using `expectedRevision`. Read it and the authenticated content of
`references/worlds.md` before creating scenes or sheets. Style locks belong to
worlds; inspiration stories do not.

The private world policy records the current world map and exact rendering
lanes. Read its current content rather than copying world identities into this
public reference. A visual storybook keeps one coherent style and cast.

## Gallery presets

`list_menu_filters` reads the owner-curated pill IDs.
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
There is no source-URL field on a story; the source block at the top of `body`
carries provenance.
