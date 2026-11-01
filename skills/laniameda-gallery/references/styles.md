# Package a style: recipe to style lock, examples and moodboard

A found look becomes reusable when an agent can read one record and make it
again. That record is a world style lock (a Story of kind `style-lock`) with
the recipe, a copy-ready prompt, the example frames with their full prompts,
the moodboards behind the codes and what raises or lowers the look.
`package_style` builds it in one call. Use it when Michael likes a recipe and
asks for it to be kept, or when a board of likes shows one recipe that works.

## Before the call

1. `open_world` for the world the look belongs to. Decide the world by the
   picture, not the recipe: a recipe that renders glossy 3D belongs in the 3D
   world even when its moodboard is an Art Deco board. A look that is its own
   universe (Iron Stage) has its own world.
2. The examples are saved in that world with their full prompts. Check with
   `get_gallery_item`; save missing frames with `save_assets` first (full
   Midjourney command, `sourceUrl` = the job permalink, `generated_output`).
   Frames in another world are refused; move them with `world_file` only when
   Michael said so.
3. A style shelf in the group Styles (`world_shelf`) is optional. Given, the
   lock and the examples are filed there.
4. Count what you can: how many takes of the recipe hit the look, how many he
   liked, what one change (a word, `--raw`, a profile) did. Those numbers go
   into `raises`, `lowers` and `evidence`. Write "not measured" over guessing.

## The call

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

## What it does

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

## After the call

- Read the lock back with `get_story` and check the examples and moodboard
  lines against live reads before reporting.
- A name the agent proposed, a status change or a shelf rename is Michael's
  call: post it to the world's Inbox (`post_inbox_cards`, a rule card).
- If the board is borrowed from another world, add a line to that board's
  `notes` (`save_moodboard` patch) naming the style that uses it, so the link
  can be found from both sides.
- Register a profile the recipe uses with `mj_profiles` (op save, world) if
  the world does not list it yet.
- Add the style to WORLD.md's Styles section (`world_doc`).
