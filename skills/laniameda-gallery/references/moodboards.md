# Moodboards: looks made from gallery images, mirrored to Midjourney

A moodboard is an ordered set of gallery images that defines one look. It is
mirrored to a Midjourney moodboard, whose personalization code (`88ji6bg`)
carries the look into prompts as `--profile 88ji6bg`. Each board belongs to
one plain collection: a world root (`DEAR ANNETE`) or one of its children
(`DA FILM`). Storybooks hold no boards.

Boards are separate from collections and tags. Adding an image to a board
never changes its tags, captions or collections, and one image can sit on
several boards.

## The record

| Field | Meaning |
|---|---|
| id | `moodboard:<id>`; tools also accept the bare ID |
| name | `DA FILM · Golden`. Unique inside its collection; a repeated create returns the same board |
| description | What the board carries and when to use it |
| styleTag | Lowercase hyphenated style key, e.g. `da-film` |
| status | `draft` → `in-midjourney`; `archived` keeps a board out of default lists |
| mjCode | The personalization code Midjourney shows, kept as a string as given |
| mjMoodboardId | Midjourney's own moodboard id; prompts can use `--profile m<id>` |
| mjUrl | Link to the board on midjourney.com |
| mjSyncedAt, mjSyncedItemCount | When the last sync was recorded and how many board images Midjourney held then |
| mjCodeHistory | Earlier codes, newest last, each with when it was replaced |
| notes | Like rates, recipe partners (`+ DARI h2eu2z6`), what to avoid |
| coverAssetId | The board's face; always an image on the board |
| itemCount, revision | Exact item count; revision guards concurrent edits |

Items keep their position: the board order is the upload order. A board
holds at most 1000 items.

## Tools

```text
list_moodboards { folderId?, includeChildren?, status?, includeArchived? }
get_moodboard { moodboardId }
save_moodboard { folderId, name, description?, styleTag?, notes?, mjCode?, mjMoodboardId?, mjUrl? }       create
save_moodboard { moodboardId, expectedRevision?, ...fields, status?, coverAssetId?, folderId? }          patch; null clears
add_moodboard_items { moodboardId, assetIds (1–100), note? }
remove_moodboard_items { moodboardId, assetIds (1–100) }
reorder_moodboard_items { moodboardId, assetIds }        every current item exactly once
set_moodboard_midjourney { moodboardId, mjCode?, mjMoodboardId?, mjUrl?, syncedItemCount?, note? }
list_moodboard_generations { moodboardId, limit? (≤ 60) }
delete_moodboard { moodboardId }                          needs gallery:delete and Michael's word
```

- `list_moodboards` with a world root and `includeChildren: true` returns the
  root's boards, then each child's, in the world's group order. Rows carry
  up to six preview images, the code and its `profile` flag.
- `get_moodboard` returns every item in position order with `asset:<id>`,
  full-size `url`, `width`, `height`, `kind`, a prompt excerpt, tags and the
  agent description. `imageUrls` lists the image URLs alone, in order, ready
  to push into Midjourney. `sync` says what changed since the last recorded
  sync (`addedSince`, `removedSince`, `upToDate`).
- `add_moodboard_items` appends in the given order, skips assets already on
  the board (reported in `skipped`) and makes the first image the cover when
  none is set.
- Changing `mjCode` with `save_moodboard` corrects the record and keeps the
  old code in history, but records no sync. A real sync is
  `set_moodboard_midjourney`. A draft that gets its first code or id this way
  becomes `in-midjourney`.
- `list_moodboard_generations` is "made with this board": the owner's assets
  whose prompt carries the board's code, an earlier code or `m<id>`, newest
  first, each marked `onBoard`.

## Sync procedure: gallery board → Midjourney

Michael asks for a board to go to Midjourney, or copies the agent request
from the board's Send to Midjourney menu. With a signed-in Midjourney web
session (Comet or another browser the agent drives), the web app's own API:

1. `get_moodboard` for the board. Use `imageUrls` (images only; Midjourney
   moodboards take no video) with each item's `width` and `height`.
2. No `mjMoodboardId` yet: create the Midjourney board with
   `POST /api/moodboards` and `{ session_id, title }`, title = the board name.
3. Make every image reachable for Midjourney: `POST /api/storage-upload-link`
   with `{ url }` for each public image URL.
4. Add them in board order: `PATCH /api/moodboards?moodboard_id=<id>` with
   `{ session_id, add: [{ url, width, height }] }`. For an existing board,
   add what is missing and remove what is no longer on the gallery board.
5. Midjourney fixes the board's personalization code when the first job uses
   it, and `--profile m<id>` resolves to the current code. Run that first job
   when the code is not shown yet, then read the code Midjourney displays.
6. `set_moodboard_midjourney` with `mjCode`, `mjMoodboardId`, `mjUrl` and
   `syncedItemCount` (how many board images Midjourney now holds). A changed
   code goes onto `mjCodeHistory` on its own.

### Readback before reporting done

Read the board again with `get_moodboard` and check that `mjCode`,
`mjMoodboardId` and `mjUrl` are what Midjourney shows, `status` is
`in-midjourney`, `mjSyncedAt` is this sync and `sync.upToDate` is true. Report
the code as `--profile <code>` and the board link. A code typed from memory, a
running upload or an unconfirmed session is not a finished sync. Never
publish, star or re-file the board's images as part of a sync.

## Rules

- **A gallery change propagates to Midjourney.** When a gallery moodboard's
  images change (add, remove or reorder), the gallery agent updates the linked
  Midjourney moodboard before calling the edit done. Use the sync procedure
  above. The gallery board is the source: Midjourney ends holding the same
  images in the same order. Then `set_moodboard_midjourney` and read the board
  back. With no signed-in Midjourney session, say the gallery board changed and
  the Midjourney copy is waiting. Do not claim it synced. The Chrome extension
  never pushes to Midjourney; it only shows the gallery boards.
- A board is its own record, never a collection. Do not make a collection
  that mirrors a board (the per-board collections under `Midjourney Srefs`
  are legacy; Michael decides whether they go). In the app, boards live in
  the Moodboards tab and in their world's Moodboards panel, where Choose from
  gallery adds images with the full gallery filters.
- Make a board in the collection whose look it carries: a world's film look
  in that world (or its Styles child), a place in its place collection.
- Cite boards by name and code in prompts and notes. Keep the recipe partners
  (another code that pairs well) in `notes`.
- Archive rather than delete. Delete only a board Michael names; deleting
  removes the board and its item list, never the images or the Midjourney
  board.
- Deleting an image takes it off every board. Deleting a child collection
  moves its boards to its world; deleting a root deletes its boards (the
  images stay).

## Collection groups

A child collection can carry a display group (`Styles`, `Places`, `Cast`,
`Design`, `Moods`, `Footage`; at most 40 characters) and a `sortOrder`, so a
world reads in groups instead of one alphabetical run. Set them with
`create_collection` or `update_collection { folderId, group?, sortOrder? }`;
`update_collection` keeps the name when it is omitted and `null` clears a
group. `list_collections` returns both. Groups list in order of their
smallest member `sortOrder`, then by name; ungrouped children come last.
