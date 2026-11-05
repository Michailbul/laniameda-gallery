# Styles: a world's named looks, their recipes and frames

A world holds several styles. DEAR ANNETE has Ink Noir, Lantern Dusk, Lacquer
& Brass, Long Sun and more, spread over its sibling worlds (Film, 3D, Art Deco,
Iron Stage). A style is **how a frame is made**: medium, rendering, light,
palette. It holds any subject. Places, compositions, motifs, shot types and
sheet setups are not styles (Michael, 1 Nov 2026); keep those as tags
(`motif-*`) or shelves in other groups.

Each style is one record (`style:<id>`) with:

| Part | What it is |
|---|---|
| name, line | The style's name and one plain sentence on how a frame in it looks |
| family | Carousel group inside the universe (Film, Art Deco, 3D); default the world's short name |
| status | `draft` → `ready` (Michael's word only); `archived`; `merged` (set by merge_styles) |
| shelf | The child collection (group Styles) holding its frames. Frames = the shelf's members |
| covers | Up to 12 frames, in order; the first is its face in the carousel |
| recipes | Up to 8, the first is the main one: gallery moodboards and Midjourney profiles in stack order, codes with no gallery record yet (`unknownCodes`), parameters, a copy-ready prompt template, how many frames it made, a note |
| raises, lowers | What pushes the look up and what breaks it, with numbers when measured |
| lock | The style lock story (`package_style`) holding the long recipe text |

The styles page shows it: `https://gallery.laniameda.space/w/<world>/styles[/<style slug>]`
(`list_styles` and `get_style` return the `url`). Full width, no sidebar: every
style of the universe across the top as cover cards, grouped by family; under
it one band with the style's name, its line and its moodboards and profiles by
**name** (from the record, else read from the `--profile` codes of its newest
frames); then its frames as big bare masonry (two columns on a desktop, chips
on the frame). Storybook chips filter the masonry to the frames a book uses.
Prompt, recipe, where the frame is filed, edit in place and comments appear
only in the open view, beside the full-resolution frame. Codes stay off the
surface (hover title only); the prompt reads codes as names and copies as the
runnable text.

Keys on the hovered or open frame: `1` like · `⇧1` super like (private, never
publishes; the curator star does) · `2` off this style (grays in place, `2`
brings it back) · `S` change style · `M` add to a collection · `B` add to a
storybook and pick its beat · `E` edit in place (Krea 3; a failed Krea take
reruns once on GPT Image 2.5 Flare) · `C` comment · `O` open · `I` copy id.
Every filing is journaled under session `styles-page` (`world_undo`). A beat
pick writes `asset:<id>` under BEATS TO REFERENCES in the book's record; when
the book still placed frames by shelf order, those placements are written
first so none moves.

## Universes

Sibling worlds of one story universe read together. `world_universe {world,
universe}` puts a world into another world's universe (DEAR ANNETE — 3D,
— ART DECO and IRON STAGE join `dear-annete`); `universe: null` takes it out.
One level only. It changes nothing about membership: filing, moodboards,
stories and characters stay per world, and an asset still belongs to one world.
`open_world` returns `universe` (the head world and its members) and
`world.stylesUrl`.

## Tools

```text
list_styles  { world, universe?: true, includeArchived?, covers?: 2 }
get_style    { style, world?, frames?: 0..60 }          // frames with prompt excerpts
save_style   { world, style?, name?, line?, family?, status?, shelf?, coverAssetIds?, addCoverAssetIds?,
               recipes?: [{ name?, moodboardIds[], profileIds[], unknownCodes[], parameters?, template?, frames?, note? }],
               raises?, lowers?, lockStoryId?, notes?, sortOrder?, expectedRevision?, session }
file_style   { style, world?, assetIds[], remove?, covers?, move?, note?, session }
merge_styles { from, into, world?, move?, dryRun?, session }
world_universe { world, universe | null, session }
find_assets  { items[] }                                // "is this in the gallery?"
```

- A style is named by `style:<id>`, or by its name or slug with `world` (the
  world's own styles first, then the rest of its universe).
- `save_style` without `style` creates. With no `shelf`, it uses the shelf of
  the same name or makes one in the group Styles. To adopt an existing Styles
  shelf, name it (`list_styles` lists `unrecordedShelves`: Styles shelves with
  no record yet). A rename also renames the shelf when the shelf carried the
  old name. `shelf: null` unlinks it; the shelf and its frames stay.
- `coverAssetIds` replaces the covers, `addCoverAssetIds` puts frames first and
  keeps the rest. Covers must be pieces of the style's world.
- Recipes take ids: moodboards from `open_world` / `list_moodboards`, profiles
  by id, name or code from `mj_profiles`. A code the gallery has no board or
  profile for goes in `unknownCodes`; the page shows it as "unnamed profile"
  until it is registered (`mj_profiles save`) or its board is made (gallery
  board first, references/moodboards.md).
- `file_style` is `world_file` onto the style's shelf, 100 per journaled change,
  any number per call. `covers: true` also makes them the first covers.
- `merge_styles` (dry run first): the `from` frames move onto `into`'s shelf
  (off `from`'s shelf), recipes, covers, raises and lowers join, `from` becomes
  `merged` pointing at `into`, and its empty shelf moves to the group Merged.
  Nothing is deleted. Across two worlds of a universe only with `move: true`
  on Michael's word (the frames change worlds).
- Every write is journaled in its world (`style.save`, `style.merge`,
  `world.universe`, plus the `assets.file` and `shelf.*` entries it makes);
  `world_undo` with the session reverts it as a unit.
- Never publish, star or delete as part of style work.

## "Is this in the gallery?" for local boards

`find_assets { items }` takes up to 500 references in any mix and answers each
with `found`, the matching `asset:<id>`s, their Midjourney job and tile, the
worlds and styles they are in and a thumbnail:

- `https://www.midjourney.com/jobs/<job>?index=2`, `https://cdn.midjourney.com/<job>/0_2.png`
- the saved file name `mj-<job>-2.png`
- a local board's short id `<first 8 hex of the job>-<tile>` (`04fc5ee9-2`)
- a bare job id (every tile of the job), `asset:<id>`
- any other source URL, an exact file name or an ingestKey

A board builder runs it once over its frame ids before a round and marks what
is saved and where. `check_sources` stays for exact post permalinks.

## Making a style from a found look

1. `open_world` for the world the look belongs to. Decide the world by the
   picture, not the recipe: a recipe that renders glossy 3D belongs in the 3D
   world even when its moodboard is an Art Deco board.
2. Check the frames are saved (`find_assets`); save missing ones with
   `save_assets` (full Midjourney command, `sourceUrl` = the job permalink,
   `generated_output`).
3. `save_style { world, name, line, recipes, covers }`, then
   `file_style { style, assetIds }`. Count what you can: how many takes of the
   recipe hit the look, how many he liked, what one change did. Those numbers
   go into `recipes[].frames`, `raises` and `lowers`. Write "not measured"
   over guessing.
4. For the long recipe text, `package_style` (below) and then `save_style
   { style, lockStoryId }`.
5. A name the agent proposed, a status change to ready or a merge is
   Michael's call: post it to the world's Inbox (`post_inbox_cards`).

## package_style: recipe to style lock

A style lock (a Story of kind `style-lock`) carries the long recipe: a
copy-ready prompt, the example frames with their full prompts, the moodboards
behind the codes and what raises or lowers the look. `package_style` builds it
in one call.

```text
package_style {
  world, name, styleTag,                      // da-3d-patent-noir
  shelf?,                                     // style shelf id or exact name
  logline?, status?: draft | ready,           // ready only on Michael's word
  recipe: { opener, moodboardCodes[], profileCodes[], parameters, template?, midjourneyFolder? },
  exampleAssetIds[1..12], raises[], lowers[], evidence?, notes?,
  ingestKey?,                                 // default style-lock:<worldKey>:<slug of name>
  expectedRevision?, dryRun?, fileExamples?, session
}
```

Run it with `dryRun: true` first and read the body. Then run it without.

- Reads every example, refuses one outside the world, and copies its full
  prompt into the lock.
- Matches each moodboard code (current code, an earlier code, or `m<id>`) to
  its gallery board:
  - **linked**: the board is in this world. The lock names it with its id.
  - **other-world**: the board lives in another world. The lock cites it by
    code and id, says where it lives, and nothing is linked or boarded across
    worlds. Change that board only in its own world.
  - **MOODBOARD NOT CREATED YET**: no gallery board carries the code. The lock
    says so at the top. Do not build the Midjourney board to fill the gap:
    the gallery board comes first (references/moodboards.md), Michael picks,
    then Midjourney.
- Files the examples on the style shelf (journaled under `session`).
- Saves the lock: title `<WORLD> · <name> · Midjourney recipe`, tags
  `style-lock` and the style tag, the examples as `assetIds`, status `draft`
  unless given. Same `ingestKey` updates the same lock; an existing lock needs
  `expectedRevision`, and the error names the story and its revision.
- Never creates, edits or syncs a moodboard, never touches Midjourney, never
  stars or publishes.

After the call: read the lock back with `get_story`; link it to the style
(`save_style { style, lockStoryId }`); if the board is borrowed from another
world, add a line to that board's `notes` naming the style that uses it;
register a profile the recipe uses with `mj_profiles` (op save, world) if the
world does not list it yet; add the style to WORLD.md's Styles section
(`world_doc`).

`open_world` still lists `styles` (style tags with their locks and board
counts) beside `worldStyles` (the named style records). The style tag is a
lane (da-film, da-deco) that many named styles share.
