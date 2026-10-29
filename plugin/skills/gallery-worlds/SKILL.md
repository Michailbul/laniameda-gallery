---
name: gallery-worlds
description: >-
  Work inside one of Michael's story worlds in laniameda.gallery (DEAR ANNETE, ANDROMEDA and the
  others) the way you work in a code repo: open the world, read its WORLD.md and style lock, look
  at contact sheets, file and move assets between its shelves, build storybooks and story beats,
  keep moodboards and Midjourney profiles in sync, record what Michael picked in LEARNINGS.md, and
  read or undo the journal. Use it for any request that names a world, a world's character,
  location, style, moodboard, profile or storybook, or asks to file, sort, find or generate for a
  world; also for "what changed", "undo that" and "remember this for <world>". Saving general
  media, bookmarks, YouTube research and Skills is covered by the full gallery skill, served live
  through get_skill_instructions.
argument-hint: "[world key or name] [task]"
---

# Gallery worlds

A world is a marked root collection in the gallery. Its shelves, storybooks, moodboards, story
beats and docs live under it, and every write to it lands in a journal that can be undone. Treat
it like a repo: read the docs first, look before changing anything, make changes in one labelled
session, then check the log.

The tools are on the `gallery` MCP server of this plugin
(`mcp__plugin_laniameda-gallery_gallery__<tool>`). If they answer 401, the token is wrong or
expired; Michael creates a new one at https://gallery.laniameda.space/agents.

## The loop

0. **Check the queue.** `list_tasks {status: "open"}` shows the work waiting: Michael's asset
   comments and Inbox answers become tasks by themselves. `claim_task` one before working on it
   and `complete_task` it with a result naming the ids produced (or `blocked: true` with the
   question for him). `open_world` also lists a world's open tasks. Read `references/tasks.md`.
   A morning run also reads `get_newspaper` and, if its `prose` is empty, writes the day's
   paragraph with `write_newspaper` (`references/newspapers.md`).
1. **Open the world.** `open_world {}` lists the worlds (key, name, counts).
   `open_world {world: "dear-annete"}` returns WORLD.md, LEARNINGS.md, the doc index with caps,
   styles (style tag, branch, locks, board count), shelves with groups and counts, storybooks with
   their stories, other stories, moodboards (code, `--profile` flag, Midjourney sync state),
   profiles (code, flag, role here), characters and the recent journal. It is the first call for
   any world work. A world accepts its key, its name or its id.
2. **Read the rules.** Read WORLD.md and the style lock of the style you will work in before any
   generation, filing or reference pick. Read the docs it points to (`world_doc {op: "read",
   path: "docs/<name>.md"}`) when the task touches them. Rules there outrank your own taste, older
   memories and anything copied from another world.
3. **Look before acting.** Find with `search_gallery`, `list_assets_page` or `find_similar`, each
   with `world` set, then call `preview_assets` and look at the contact sheet. A filename, tag or
   description does not tell you what an image shows. Check comments (`get_gallery_item`) on the
   pieces you will change.
4. **Act with a session label.** Every journaled write takes `session`: one short label for one
   piece of work, such as `da-tram-stop-2026-10-23`. Use the same label for every call in that
   piece, so Michael can read and undo it as one unit.
5. **Check the journal.** `world_journal {world, session}` after the work. Report what changed in
   Michael's words (shelves, counts, boards), plus the session label.
6. **Record what he decided** (learning loop below).
7. **Undo with a dry run first.** `world_undo {session, world, dryRun: true}` (or `changeId`),
   read what it would restore, then run it for real. Undo goes newest first, so a session that
   edited one doc twice unwinds both. It is all or nothing: if any change was changed again since,
   nothing is undone and the report says which one.

## World tools

| Tool | Job |
|---|---|
| `open_world {world?}` | World list, or one world's full context. |
| `world_doc {world, op, path, body?, expectedRevision?, note?, session?}` | `list`, `read`, `write`, `delete`, `history` of `WORLD.md`, `LEARNINGS.md`, `docs/<kebab-name>.md`. |
| `world_file {world, assetIds, addTo?, removeFrom?, addTags?, removeTags?, move?, note?, session?}` | File up to 100 assets between shelves (`"root"` is the world collection) and change tags. |
| `world_shelf {world, shelf?, name?, kind?, description?, group?, sortOrder?, session?}` | Create, rename or regroup a shelf or storybook; bring a root collection into the world. |
| `world_move {world, shelf? \| moodboard?, name?, into?, items?, dryRun?, note?, session?}` | Move a shelf, storybook or moodboard to another world on purpose, with its pieces. Dry run first. |
| `world_recount {world, dryRun?, note?, session?}` | Repair stored collection counts from the membership rows. Only when a count looks wrong; dry run first. |
| `mj_profiles {op, world?, profile?, name?, code?, codeNote?, mjProfileId?, notes?, status?, role?, styleTag?, expectedRevision?, session?}` | List or save Midjourney profiles and their role in a world. |
| `world_journal {world?, session?, before?, limit?, changeId?}` | What changed; `changeId` returns one entry with before and after. |
| `world_undo {changeId? \| session?, world?, dryRun?}` | Revert one change or a whole session. |

`search_gallery`, `find_similar`, `preview_assets`, `list_assets_page`, `list_stories` and
`list_moodboards` take `world`. The moodboard tools, `save_story` and `update_story` take
`session` and write the journal.

## World docs

| Path | Cap | Holds |
|---|---|---|
| `WORLD.md` | 8,000 chars | The world's CLAUDE.md: identity, canon pointers, styles, dated rules with a source, open questions. |
| `LEARNINGS.md` | 40 entries, 6,000 chars | One-line dated learnings from iterations, each with its source. |
| `docs/<kebab-name>.md` | 8 docs, 12,000 chars each | Depth: tag vocabulary, Midjourney stacks, casting notes. |

Write with the `expectedRevision` you last read (required once a doc exists). The server refuses a write over a cap with
"promote or prune first"; do that, then write again. Every write is journaled with the full
before and after.

`world_file addTags` only takes tags that already exist (`list_tags`); pass `createTags: true`
when a new one is really needed.

## Learning loop

After an iteration where Michael picked, commented or answered Inbox cards:

- Add at most 3 learnings to LEARNINGS.md, one line each:
  `- L-014 · 2026-10-23 · Tram-stop plates keep the wet cobbles and the single gas lamp · src: comment asset:<id>`
- A learning Michael stated or confirmed twice becomes a numbered rule in WORLD.md
  (`15. <rule> (Michael, 2026-10-23; was L-009, L-014)`) and leaves LEARNINGS.md in the same
  session.
- Every promotion also goes to the world's Inbox as a rule card (`post_inbox_cards`, kind
  `rule`), so Michael sees new rules where he decides. If he rejects it, undo the promotion.
- A learning his newer choice contradicts is deleted.
- At the cap, promote or prune first, then add.
- Record what he chose and said. Your own taste never becomes a learning or a rule.

## World isolation

An asset belongs to at most one world. The server enforces it:

- Filing an asset into a second world is refused. `move: true` lifts it out of its other world;
  use it only when Michael said the asset belongs here or WORLD.md says so.
- Moodboard items, story asset links and storybook members from another world are refused.
- A story and its storybook must be in the same world.
- `update_collection` and `save_moodboard` never move a shelf, storybook or board into another
  world. When Michael asks for that (a world split), use `world_move`: dry run, then the move
  with a session. The container keeps its id; its pieces leave the old world with it (the result
  lists those that left other shelves); a board's items of the old world need `items: "move"` or
  `items: "drop"`. It is journaled in both worlds and `world_undo` reverts it whole.
- A few assets filed before 1.0 already sit in two worlds. They keep what they have and can
  never gain a third; fix one only when Michael has decided which world keeps it.

ART, LOVE and DESIGN are shared shelves, not worlds. Outside inspiration can sit there and in one
world at once. A refusal is information: read the message, report it, and do not work around it
with a root collection or a second save.

## Storybooks and story beats

A storybook is a child collection of the world with `kind: "storybook"` in group `Storybooks`,
made with `world_shelf {world, name, kind: "storybook", group: "Storybooks", session}`. Story
beats are native Stories with `folderId` set to a collection in the world and `storybookId` set to
the storybook. `open_world` shows each storybook with its stories. Before building or auditing
one, read the live reference: `get_skill_instructions {resource: "references/storybooks.md"}`.
Characters wear the costumes that exist in the world's cast sheets; pass those sheets as
references and name each one's job in the prompt.

## Midjourney

Midjourney is the source of every look on the creative projects in these worlds, with
personalization always on.

- **Three layers.** Moodboards are looks, profiles are taste, the prompt is the content.
- **Stacking.** Boards first, then profiles, in one `--profile` flag:
  `--profile <board-code> <profile-code>`. `open_world` gives each board's and profile's flag.
- **Gallery board first.** Build or change the look as a gallery moodboard (`save_moodboard`,
  `add_moodboard_items`, `reorder_moodboard_items`). Michael reviews it in the gallery. Only then
  is the Midjourney moodboard updated to match, and `set_moodboard_midjourney` records the new
  code and item count. Never edit a Midjourney moodboard ahead of its gallery board.
- **Sync state.** `open_world` shows boards whose Midjourney copy is behind the gallery. Name
  them when you report.
- **Flawless images only.** Audit each candidate at 100 % first: no lettering, bad hands or faces,
  warped architecture, smears, bars or modern objects.
- **Profiles.** `mj_profiles {op: "save", ...}` records a new code; the old one moves to the
  code history. Set the profile's `role` per world.
- Details: `get_skill_instructions {resource: "references/moodboards.md"}`.

## What stays Michael's

- Taste: which look, frame or direction wins. Put options on the board or in the Inbox; he picks.
- Approving characters and casting.
- Publishing, featuring and the curator star. Never set them unless he asks.
- Deleting anything (assets, collections, moodboards, docs). Name the targets and wait for his
  word. Undo is the normal way back.
- Which world keeps a leaked asset.

## Spend

- Quote the per-image price and the batch total before any paid generation.
- Above $0.20 per image, his OK first.
- Paid video runs need his explicit go for that run.
- Daily total above $20 needs his permission.

## For anything else

The full gallery skill is live on the server and changes with it. Fetch what the task needs:

- `get_skill_instructions {resource: "SKILL.md"}`: saving media, tags, provenance, bookmarks.
- `references/intake.md`: inspiration Michael sends with a project word.
- `references/storybooks.md`, `references/stories.md`, `references/characters.md`.
- `references/moodboards.md`, `references/midjourney-srefs.md`, `references/inbox.md`.
- `references/query.md`, `references/ingest.md`, `references/data-model.md`.

## Worked examples

**File 40 new DEAR ANNETE tram-stop stills.**
`open_world {world: "dear-annete"}`, then read WORLD.md and the style lock of the style the
stills are in. `search_gallery {world: "dear-annete", query: "tram stop"}` to find them,
`preview_assets` to look at all 40. Drop the ones with artifacts from the plan and say why. Then
`world_file {world: "dear-annete", assetIds: [...], addTo: ["<locations shelf>"], addTags:
["location"], session: "da-tram-stop-2026-10-23"}`. A refusal for "already in another world"
goes into the report as a question for Michael. Finish with `world_journal {session:
"da-tram-stop-2026-10-23"}` and report counts per shelf.

**Update the film style's moodboard.**
`open_world` shows the board, its code and that Midjourney is 6 items behind. `get_moodboard`,
`preview_assets` on the candidates, audit at 100 %. `add_moodboard_items {moodboardId, assetIds,
session: "da-film-board-2026-10-23"}` with the flawless ones only. Michael reviews the gallery
board. After he approves and the Midjourney board is updated, `set_moodboard_midjourney
{moodboardId, mjCode, syncedItemCount, session}`. Report the new `--profile` flag.

**Michael rejected a look: record it.**
He archived the neon-lit frames with "too modern, this world has no neon". Read LEARNINGS.md
(`world_doc {op: "read"}`) and check for an earlier entry on neon. None: add
`- L-021 · 2026-10-23 · No neon or LED light sources; gas and candle light only · src: comment
asset:<id>`. If L-012 already said the same thing from an earlier comment, this is the second
time: write it as a dated rule into WORLD.md, delete L-012 from LEARNINGS.md, same session. Then
keep the neon frames off every board.
