# Swipe decks: what is on the branch

Branch `feat/swipe-deck`, cut from origin/main 52924c2 (19 Oct 2026). Not
deployed and no PR: Michael is widening this into a per-world Inbox with more
card types, and a revised brief follows. Everything below carries over.

## Data (`convex/swipe.ts`, validators in `convex/swipeValidators.ts`)

- `swipeDecks`: title, question, note, agent, ingestKey, ordered
  `itemAssetIds` (≤ 200), `targets` (2–9; hotkey 1–9 in order, label, kind
  moodboard/collection/option, moodboardId or folderId), status open/closed.
- `swipeDecisions`: one row per deck and asset with the latest `choice`
  (target or skip), `targetHotkey`, `applied` (what the drop added),
  `commentText`, `audioStorageId` + duration + content type.
- All functions are signed-owner with return validators: listSwipeDecks,
  countOpenSwipeDecks, getSwipeDeck (cards, no decisions, so a drop does not
  re-run it), listSwipeDecisions, createSwipeDeck (idempotent on ingestKey),
  closeSwipeDeck, deleteSwipeDeck, decideSwipe, clearSwipeDecision,
  generateSwipeAudioUploadUrl, setSwipeComment.
- Apply: a moodboard drop appends the image once; a collection drop adds an
  assetFolders link (recounts, sets primary only when none, syncs public
  counts). Undo and changed decisions reverse only what `applied` recorded.

## Surfaces

- `/api/agent/swipe` (list, get, create, close, delete) and MCP tools
  create_swipe_deck, list_swipe_decks, get_swipe_deck, close_swipe_deck,
  delete_swipe_deck; Bun client `swipe` namespace; contract 2026-10-19.2;
  skill 1.12.0 with `references/swipe.md`.
- UI: `/swipe` (open/closed decks with progress) and `/swipe/[deckId]`
  (`components/swipe/*`). Swipe link with an open-deck badge in the sidebar
  and mobile nav.

## Verification (19 Oct 2026)

- `tests/swipe.test.ts` (14), plus route, MCP contract and skill discovery
  tests. Lint, typecheck and build pass; the full suite has only the 10
  failures and 3 errors already on origin/main.
- Exercised end to end against a local anonymous Convex backend (seeded with
  six real R2-hosted renders by key, two moodboards, one collection), the app
  on port 3318 and decks placed through the local MCP: drag at 375 px and with
  a mouse at 1440 px, keys 1–3/S/Z/⇧Z/⌘Z/Enter/Esc, undo taking an image back
  off a moodboard, text comment, a voice note (the pane blocks the microphone,
  so a synthetic tone stream stood in for it; upload, playback and agent
  download worked), 100 % zoom, sidebar badge. Test decks deleted.

## Deploy note

Production Convex (`dev:perfect-buffalo-375`) has PR #53's moodboards but
not PR #52's backend (inventoryExport, split semantic storage tables and
functions). A push from main would publish #52 too.
