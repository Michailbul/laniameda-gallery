# The world Inbox ("Decisions")

Design: `INBOX-DESIGN.md` (Dear Annette art-direction folder, 19 Oct 2026).
Branch `feat/swipe-deck`; the earlier swipe deck grew into this.

## What it is

Every world (a root collection) has an Inbox, labelled **Decisions** in the
UI because the gallery already has collections and presets named "Inbox".
Routes: `/inbox` (worlds with open counts, all open stacks), `/inbox/<worldId>`
(that world's stacks, newest first, open/closed) and
`/inbox/<worldId>/<stackId>` (one card at a time). `/swipe` redirects to
`/inbox`. The sidebar has a Decisions link with the total and a coral badge on
each world row; the mobile nav has a Decide item.

## Data (`convex/inbox.ts`, validators in `convex/inboxValidators.ts`)

- `inboxStacks` (world, title, note, agent, ingestKey, status, cardTypes),
  `inboxCards` (immutable: type, assets, labels, targets, evidence, ruleText,
  key), `inboxDecisions` (latest answer, what it applied, card comment with
  voice), `inboxCounts` (cards/decided per stack, so badges never read cards).
- Card reads (`getInboxStack`) and decisions (`listInboxDecisions`) are
  separate queries: answering a card never re-runs the image read.
- Applying: moodboard item, collection membership, Out (a hidden `Out` child
  collection of the world, created on first use), stack (an `assetPacks` row
  of `kind: "stack"`, cover first). Undo reverses only `applied`. A prompt
  pack is rebuilt on undo only for images that had one before the stack.
  `syncPromptAssetPack` leaves stack members alone.
- Duplicate deletion: the decision records `deleteAssetIds`; the screen
  deletes through `/api/assets/<id>` (admin-checked, the gallery's cascade),
  then `recordInboxDeletions` records what is gone. Undo cannot restore them.
- Notes on single images are `assetComments` (now with an optional voice
  note, `source: "inbox"`), so they show in the detail panel and in
  `get_gallery_item`, `list_asset_comments` and `list_inbox_decisions`.

## Agent surface

`/api/agent/inbox` (post, list, decisions, close, delete) and MCP tools
post_inbox_cards, list_inbox_stacks, list_inbox_decisions, close_stack,
delete_inbox_stack. Contract 2026-10-20.1, skill reference
`references/inbox.md`.

## Verification (21 Oct 2026)

- `tests/inbox.test.ts` (10), route, MCP contract and skill discovery tests;
  the full suite has only the failures already on main.
- Exercised against a local anonymous Convex backend seeded with real
  DEAR ANNETE film stills by their public URLs, decks posted through the
  local MCP: every card type at 375 px and 1440 px, drag, keys, undo and redo,
  a card comment with text and voice (a synthetic tone stood in for the
  blocked microphone), a note on one image shown on both cards that hold it,
  real deletion of a URL-only copy through the admin route, Out, a stack shown
  as one card in the grid and dissolved again. Test stacks deleted.

## Not built here

- Desktop grid mode (select many, drop on a target) from the design.
- An archive flag on assets: Out is a hidden collection, so an Out image still
  shows inside its world's own views.
- Ordering stacks by what unblocks the most work: they are newest first.

## Group similar (PR 2)

- `assetHashes`: one 64-bit dHash per image (16 hex), in small rows of their
  own so grouping never reads asset rows. Computed by
  `perceptualHash:hashAsset` (Node, sharp, the card thumbnail or video poster
  shrunk to 9×8 grey) a minute after ingest, and by
  `perceptualHash:backfillPerceptualHashes`, one page of 25 per action in a
  sequential chain. Deleted with the asset.
- Grid: the **Similar** pill next to the sort, with a Tight–Loose slider
  (3–20 bits). Clusters (single link, largest first, the view's own order
  inside) render as sections with a divider, count and widest distance, each
  with Stack (an asset pack of kind stack under the first image, with Undo),
  To Inbox (a duplicates card in the open world's Inbox, idempotent per
  cluster per day; first 8 images) and Select. The rest follows under Not
  grouped. Only loaded tiles group; hashes load only while Similar is on.
- Agents: `find_similar_groups` (world or collection, children, maxDistance,
  minSize, limit) returns groups with `assetIds` ready for a duplicates card.
  It reads link rows, legacy primary members and hash rows, capped at 3,000
  pieces (`truncated`).
- Embeddings were not used: `SEMANTIC_STORAGE` is still legacy, where each
  asset's vectors sit in one ~56 KB `semanticDocuments` row (two 3,072-float
  vectors). Clustering a 1,400-piece world from them would read ~78 MB per
  toggle. After the split migration (768-value vectors in their own rows) an
  embedding distance can join the hash for "same subject" grouping.
