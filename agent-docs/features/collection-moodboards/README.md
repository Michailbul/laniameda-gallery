# Collection moodboards and collection groups: what shipped

Spec: `SPEC.md` in this folder (19 Oct 2026). Branch `feat/collection-moodboards`,
cut from origin/main 7bfb917. The Convex backend is not published from the
branch; the orchestrating agent reviews the schema diff and publishes.

## Data

- `moodboards`: one look per row, owned by a plain collection (root or child,
  never a storybook). Name unique per owner and collection (`normalizedName`),
  status draft / in-midjourney / archived, Midjourney identity (`mjCode` kept
  as a string, `mjMoodboardId`, `mjUrl`), sync record (`mjSyncedAt`,
  `mjSyncedItemCount`, `mjCodeHistory`), notes, cover, exact `itemCount`,
  `revision`. Indexes: owner/folder/normalizedName, owner/updatedAt,
  owner/mjCode.
- `moodboardItems`: one asset on one board with an ascending `position`,
  optional note and `addedAt`. Indexes: board/position, board/asset, asset.
- `folders.group` (display text, at most 40 characters) and
  `folders.sortOrder`: optional, meaningful on children.

## Backend (`convex/moodboards.ts`, validators in `convex/moodboardValidators.ts`)

All functions are `signedOwnerQuery` / `signedOwnerMutation` with return
validators. Reads: `listMoodboards` (a collection, a world with its children,
or every board; archived on request; up to six previews, cover first),
`getMoodboard` (items in order with asset summaries, `missingAssetIds`),
`listMoodboardsForAsset`, `listMoodboardGenerations` (prompt search for the
code, earlier codes and `m<id>`, then a whole-token check). Writes:
`createMoodboard` (idempotent per collection and name; a retry only fills
empty fields), `updateMoodboard` (revision guard, unique names, cover must be
an item, move between collections, Midjourney identity corrections that keep
code history), `addMoodboardItems` (1–100, appends, skips duplicates),
`removeMoodboardItems`, `reorderMoodboardItems` (full set only),
`setMoodboardMidjourney` (records a sync), `deleteMoodboard`.

Cascades: `deleteAssetCascade` calls `detachAssetFromMoodboards` (count and
cover repaired). `cascadeDeleteFolder` calls `rehomeFolderMoodboards`: a
child's boards move to its world (renamed `<name> · <child>` on a clash), a
root's boards are deleted with their items. Assets are never touched.

`createFolder` / `updateFolder` accept `group` and `sortOrder` (`null`
clears); `updateFolder.name` is now optional and keeps the current name.
`listChildCollectionEntries`, the sidebar and the collection cards order
children group by group (`lib/collection-groups.ts`); with no group set the
order is unchanged.

## Surfaces

- `/api/agent/moodboards`: list, get, generations (gallery:read); save
  (create or patch by moodboardId), add, remove, reorder, set_midjourney
  (gallery:write); delete (gallery:delete). Registered for the hosted MCP.
- MCP: list_moodboards, get_moodboard, save_moodboard, add_moodboard_items,
  remove_moodboard_items, reorder_moodboard_items, set_moodboard_midjourney,
  list_moodboard_generations, delete_moodboard. create_collection and
  update_collection take `group` and `sortOrder`; update_collection no longer
  needs the name. Contract 2026-10-19.1. The Bun client has a `moodboards`
  namespace.
- Skill 1.11.0: `references/moodboards.md` (object, tools, Midjourney sync
  procedure, readback rules, collection groups), SKILL.md object table,
  data-model.md, ingest.md, midjourney-srefs.md, web-access.md.
- UI: a collection's breadcrumb carries `Moodboards · N`; it swaps the main
  area for `MoodboardsView` (board cards with cover mosaics, grouped by child
  collection on a world, archived behind a chip, `New moodboard`). A board
  page has copyable `--profile` flags, sync state with `Mark synced`, Send to
  Midjourney (zip of originals through `/api/assets/<id>/download`, image
  links, agent request), edit, archive, two-step delete, a justified grid
  with drag reorder, move buttons, cover and remove, and "Made with this
  board". `Add to moodboard…` sits in every card's collection menu and in
  the selection bar; its picker ticks the boards an image is on. A world's
  grouped child stacks render under group headings above the grid.

## Verification

- Tests: `tests/moodboards.test.ts` (helpers, schema parity, create
  idempotency, validation, add/skip, reorder validation, remove and cover
  fallback, sync history, updates, listing, generations, asset and collection
  delete cascades, delete, privacy), folder group tests in
  `tests/folders-backend.test.ts`, route and MCP contract tests, skill
  discovery. The mock Convex context gained an opt-in `indexOrder` and
  `withSearchIndex`.
- Gates on the branch: lint, typecheck, `bun test` (770 pass; the 10 failures
  and 3 errors are identical on a clean origin/main checkout), `bun run build`
  with a loopback Convex URL.
- The UI was rendered through a local harness (real components, mocked
  Convex hooks, the app's compiled CSS, system Chrome) at 1600px and 390px, in
  dark and light themes. No live data was read or written.

## Left for the orchestrator

- Publish the Convex schema and functions to `dev:perfect-buffalo-375`.
- In-app check against real data: the toggle count, a board's previews, the
  picker from a card menu and from a selection, drag reorder, the zip, and
  the grouped stacks of a world once groups are set.
- `convex/_generated/api.d.ts` was edited by hand (two module lines). Offline
  codegen (`--system-udfs`, run in an isolated scratch copy with no live env)
  lists the same 66 modules in the same order, but its template drops the r2
  component declaration, so the hand edit keeps the committed app template.
