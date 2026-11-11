# Progress

> What's been built. For all pending/future work see `agent-docs/BACKLOG.md`.

Last updated: 2026-11-11

---

## ✔ Shipped

### 2026-11-11 — Search finds the right pieces, and takes instructions (branch `fix/search-relevance`, backend pushed 11 Nov 13:30)
- Cause 1: imageless assets (455 videos) stored a text vector in the legacy
  pixel lane. Against a text query those outscore every picture, so they
  filled the lane's 256 hits: on 14 of 20 test queries the pixel lane returned
  no picture at all. The indexer no longer writes that vector
  (`clearEmbedding`), `semanticIndex:stripImagelessPixelVectors` removed the
  stored ones (452 rows), and the vector index had to be dropped and re-added
  before it stopped serving them (see `OBSERVATIONS.md`).
- Cause 2: lanes were merged by position, half and half. For a name the pixel
  model does not know ("dari", "cassandra") its 256 hits are noise, and half
  of every page was noise. `blendLanes` now scores a hit by its place between
  its lane's best and worst hit, lets words lead, and weighs the pixel lane by
  how many of its best 40 hits the text lane also found (measured on 42 live
  queries: names agree on 0–2, visible subjects on 7 or more). "dari": 30 of
  the first 60 results were right, now 60 of 60.
- Every search (`searchAssets`, `findSimilarAssets`, `searchAssetsPage`) takes
  one 256-hit pass a lane and reads the same ranking. The per-lane cutoffs and
  the two-pass widening are gone; `minRelativeScore` is a cutoff on the
  blended score, off by default. `semanticSearch:inspectLanes` (internal)
  shows every raw lane hit for a query.
- Search by instructions (`lib/search-instructions.ts`): a search is a thread
  of steps. "dear annete world" stays inside that world and its shelves (a
  cue word is needed, so "cars" still searches everything), "interiors / city
  street" finds either, "no cars" leaves out pieces described or tagged as
  cars and pieces that clearly show them, "only videos", "locations", "liked",
  "animation" filter. Enter keeps a step, chips show how each was read, a chip
  can be removed, Backspace on an empty field steps back, and earlier
  searches come back from the search box (kept in the browser).
  Backend: `searchAssetsPage` takes `alternatives`, `exclude`, `textHint`;
  `loadSearchHits` takes `exclude`.

### 2026-11-10 — Search keeps loading on scroll (branch `fix/search-load-more`, backend pushed 10 Nov 22:08)
- Cause: the grid asked `semanticSearch:searchAssets` once (limit 120, capped
  at 100 on the server) and nothing fetched more at the end of the list, so
  every search stopped at 100 pieces.
- `semanticSearch:searchAssetsPage` ranks every candidate once (256 hits a
  lane, Convex's ceiling), returns the first 60 pieces and the ranked hits not
  read yet; `semanticSearch:loadSearchHits` reads the next 60 from those hits.
  Hits handed back by the browser are only candidates: scope and filters are
  checked again at hydration. The head is the cutoff-fused list the one-shot
  search returns; weaker hits follow. "Similar" pages the same way
  (`similarToAssetId`). `searchAssets` / `findSimilarAssets` are unchanged for
  agents.
- Grid: the end of the list loads the next ranked page; when the ranked hits
  run out, a search by words carries on with whole-word keyword matches read
  from the rest of the gallery pages (`galleryWordMatcher`: "car" finds "cars",
  not "character").
- Live check: "car" 100 → 352 ranked + keyword matches past 1,000; "porsche"
  100 → 217; "castle" 100 → 433. Read costs: `DATABASE_IO.md`.

### 2026-11-09 — Describe → our prompt, with a style lock (extension 0.29.0, branch `feat/mj-describe-to-prompt`, backend pushed 9 Nov 20:23)
- Extension: `mj-describe-hook.js` (MAIN world) reads Midjourney's own
  `POST /api/describe` answers and its IndexedDB cache (`mjDatabase2.descriptions`);
  `mj-describe.js` shows the MAKE IT OURS card; `describe-panel.js` is the side
  panel's Describe tab (drop, paste, recent describes, right-click "Describe to a
  prompt"); `mj-describe-core.js` is the shared UI.
- Backend: `promptEditRunner.describe` (the quick-edit agent with the picture,
  Haiku routes fal → Pika), `styleRecipes.describeStyleOf` (style lock, line,
  template, composed recipe), routes `/api/extension/prompt-describe`,
  `/api/extension/styles` (worldStyles.listStyles), `/api/extension/mj-queue`
  POST `{action:"queue"}`; `mjQueueItems.describe` lineage; the extension save
  route passes `agentDescription`. Pure helpers `lib/mj-describe.ts` (tests).

### 2026-11-06 — Director review: CASSANDRA's review page, rounds, feedback, full agent control (branch `feat/director-review`)
- `/review/<slug>` (public for CASSANDRA at www.mishabuloichyk.com/cassandra):
  the director signs in with Google (or a private invite link), browses the
  current round by folder (locations, characters, scenes) and style, and likes,
  dislikes and comments on frames. Michael sees the draft and each frame's
  making-of. Rounds v0.1, v0.2 …: a draft collects promoted frames, publish
  makes it current, older rounds stay viewable, set current rolls back.
- Tables `reviewProjects`, `reviewFolders`, `reviewVersions`, `reviewItems`,
  `reviewFeedback`, `reviewComments` (convex/review.ts). Reviewer tokens
  (`reviewer:<email>`) open only the review functions.
- Gallery hotkey R / Shift+R promotes frames into a project's draft round.
- Agents: `/api/agent/review` and MCP tools review_open, review_items,
  review_feedback, review_setup, review_promote, review_organize,
  review_round, review_comment. Handles resolve by name (folder slug, style
  label, round label, frame code). Publish, rollback and discard need
  `confirmed: true`; agents cannot vote. Skill 1.30.0, references/review.md.
- Spec, verification and limits (frame codes can collide at a few hundred
  frames): agent-docs/features/director-review/PRD.md.

### 2026-11-08 — Midjourney dock keys and world picker fix (extension 0.27.0)
- `extension/mj-hotkeys.js` (shared by the dock and the side panel): actions board/profile/preset 1–9 (positional, dock order), world prev/next/pick, preset save; defaults ⌥N, ⌥⇧N, ⌃⌥N, ⌥[ ⌥] ⌥W ⌥S; combos are `Ctrl+Alt+Shift+Meta+<event.code>` (code, so ⌥1 is not "¡" on a Mac); stored in sync `stgMjHotkeys` {enabled, bindings}. ⌥E and ⌥⇧N are reserved.
- Dock: capture keydown on window, acts only while its own dock is on screen (getClientRects), so a second loaded copy never toggles a code twice; skips other inputs; hold a modifier for key badges (`data-key` + `.stg-mb-dock--keys`).
- Side panel: tab renamed MJ settings; `mj-hotkeys-settings.js` prepends a key editor (record, Backspace clears, a taken key moves with a note, Reset).
- World picker: native `<select>` replaced by a dock-owned list (`.stg-mb-wmenu`). Cause of "the picker disappears": `layout()` re-inserts the dock at the end of `<body>` whenever Midjourney appends there, and moving a focused `<select>` closes its native popup. The new list's buttons never take focus from the prompt.
- 0.26.2 (same day): an unpacked copy with no token seeds it from a git-ignored `extension/local-config.json`.

### 2026-11-08 — Midjourney dock second pass: families, main profiles, live updates (extension 0.26.0)
- Moodboards render one line per family from `groupBoards()` (prefix before
  "·", short world prefix dropped; families of one and loose boards → MORE;
  under 9 boards or one family → a single MOODBOARDS line). Chips carry the
  board's `thumbUrl` (20 px, lazy). PROFILES is its own line.
- `orderProfiles(profiles, pins)` puts pinned profiles first in pin order;
  pins live in chrome.storage.sync `stgMjProfilePins:<world>`, default from
  `DEFAULT_PROFILE_PINS` (dear-annete: da4, da5, dav3, dav82, dearannette2,
  cinematic, locations). Shift-click toggles.
- Rows use flex, not grid: grid plus the thumbs tripled typing layout time
  on the busy test page (63 → 130–350 ms per 6 s); flex is back to 66–71.
- Update in place: background `reinjectContentScripts()` gives Midjourney
  tabs the full manifest list. Each dock and quick edit copy stamps
  `data-stg-instance`; a style hides the others; `dropDock()` removes only its
  own dock (the old class-wide remove made two copies rebuild each other);
  a copy with a dead runtime retires (observer off, dock removed).
- Data: DA V3 (9u99tie) set active again for dear-annete; it was retired, so
  the dock never got it.

### 2026-11-08 — Midjourney dock presets, moodboards first (extension 0.25.0)
- Dock row 1: moodboards | profiles. Row 2 (`.stg-mb-row--meta`): world,
  presets, Save, flag, Packs (quiet, closed by default).
- Presets live in chrome.storage.sync under `stgMjPresets:<worldKey>`:
  `{ id, name, codes[], params, packs[] }` (max 16 per world). Apply =
  setProfileFlag + setParams + insertPack(mode "after"); a second click
  removes them (removeParams, removePack). Sticky now carries `params` and
  `packs`, so an active preset rides along into the next prompt.
- New pure helpers in moodboard-dock.js with tests: setProfileFlag,
  readParams, setParams, removeParams, hasParams.

### 2026-11-08 — Midjourney dock: one slim line, faster (extension 0.24.0)
- moodboard-dock.js builds one bar: world select, ↻, moodboard chips,
  profile chips, the flag (only leftover room; hidden when clipped) and the
  Packs button from prompt-packs.js `createSection()`. The old separate
  `.stg-pp-bar` is gone; packs open inside the dock, Dear Annete worlds only.
  `.stg-mb-dock--above` (bottom prompt) reverses the column.
- Perf: one MutationObserver (returns at once while not composing),
  findPromptPanel cached 250 ms (reset on resize, pointerup, focusin), style
  writes only on change, no setInterval refresh (refresh when composing starts
  and data is >45 s old), world <select> rebuilt only when its list changes.
  Measured on a stand-in page mutating every 30 ms: script time while typing
  136 → 75 ms per 6 s, idle 55 → 42 ms.
- Dock world change also writes quickEditWorld (dear-annete* → dear-annete,
  andromeda* → andromeda-anya). Sticky flag uses the live value after a
  keystroke, so fast typing keeps it.

### 2026-11-07 — Midjourney quick edit in the extension (0.23.0)
- extension/mj-quick-edit.js (midjourney.com only): ✎ pill on a selection in
  the Imagine bar or page text, ⌥E, a one-line box (world chip, model chip,
  instruction); the result replaces the selection (or the whole prompt) with
  Undo. Shadow DOM. Defaults per world in mj-quick-edit-defaults.js; the side
  panel's Prompt edit tab (mj-quick-edit-settings.js) edits them
  (chrome.storage.local quickEditWorld / quickEditModel / quickEditPrompts).
- /api/extension/prompt-edit → convex/promptEditRunner.ts `rewrite`
  (signed owner action): keys from Settings (providerVault), fal OpenRouter
  route first (anthropic/claude-haiku-5.5, deepseek/deepseek-v4.1-flash),
  Pika /v1/chat/completions when fal is blocked (Haiku 4.5 stands in there).
  Image links masked as [[IMGn]] and restored (lib/mj-quick-edit.ts).
- On 7 Nov both fal (locked, TOP_UP) and Pika (insufficient balance) were out
  of credit: the route answers "Could not edit: fal needs a top-up · Pika
  needs a top-up" until one is topped up.

### 2026-11-07 — Midjourney queue on the gallery website
- components/mj-queue/mj-queue-board.tsx: threads in a rail (To send / All,
  grouped by world), a thread's prompts with reference thumbnails, note,
  warnings, the full command (tap to expand), COPY, COPY ALL (what is left),
  Mark sent / Undo sent through api.mjQueue.updateItem (sent + sentCommand),
  copyable thr- and mjq: ids, ?thread=thr-… in the address.
- Two places: the world's Queue tab (/w/<world>/queue, WORLD_TABS, collection
  tabs, lazy WorldQueueTab chunk) and /queue (all worlds, world chips);
  sidebar and browse sheet link it. Same Convex rows as the extension panel.
- Speed: the rail subscribes to listQueue with a batch no thread has (counts,
  no items); the open thread subscribes to its own items. No backend change.
- /api/agent/mj-queue returns `url` (lib/gallery-routes mjQueueUrl) on batches,
  items and queue results; skill references/mj-queue.md "On the gallery website".

### 2026-11-07 — Midjourney queue threads (extension 0.22.0, skill 1.36.0)
- 0.22.0: the queue lives in the side panel's MJ Queue tab (extension/mj-queue-panel.js); on midjourney.com
  mj-queue.js only does the bar work (inject, Enter on his Send click, readback, job id) by message.
- The Queue panel shows batches as threads (rail grouped by world, progress,
  left to send, To send / Sent / Skipped / All tabs, ⌥⇧↑↓). Each thread has a
  copyable id thr-xxxxxxxx (FNV-1a of the batch key, twin in lib/mj-queue.ts and
  extension/mj-queue-compose.js); /api/agent/mj-queue returns threadId and
  accepts the id as `batch`. The iMac's agents' Midjourney Chrome runs the same
  extension through ~/.config/laniameda/mj-chrome/keeper.py (LaunchAgent
  com.laniameda.mj-chrome): branded Chrome ignores --load-extension, so it
  installs over the DevTools pipe each start and restores Michael's settings.

### 2026-11-07 — Private originals for inspiration (branch `feat/inspiration-private-media`)
- Personal photos, faces and voice are kept in Convex file storage and served
  only through /api/inspiration/media/<id> (Michael's session or an owner
  agent token, private no-store, byte ranges) via the first Convex HTTP
  route. Tool inspiration_private_media; skill 1.35.0. Detail:
  agent-docs/features/inspiration-review/PRD.md (Private originals).

### 2026-11-07 — Inspiration dispatch safety: generation off by default, one dispatcher, priced jobs (branch `feat/inspiration-gates`)
- Paid generation for inspiration takes is off until Michael allows it in
  /inspiration (Generation strip: cap per 48 h, days, Pause). One dispatcher
  lease with a fencing token; every paid call is a priced reservation first;
  unknown outcomes stay held and are never resubmitted. Tools
  inspiration_dispatch, inspiration_job; skill 1.34.0. Detail:
  agent-docs/features/inspiration-review/PRD.md (Dispatch safety).

### 2026-11-06 — Inspiration review: library, takes, versions, Michael's verdicts (branch `feat/inspiration-review`)
- `/inspiration` lists saved references (raw and with takes) with filters;
  `/inspiration/<source>` shows the source beside each project take, its
  version timeline, cost and references, Michael's notes on what he likes,
  and separate Keep / Drop / Approve / Change / Promote / Undo controls.
  Phone first (390px checked), sidebar and browse-sheet entrance.
- Tables `inspirationSources`, `inspirationAdaptations`,
  `inspirationVersions`, `inspirationEvents`. Draft outputs live on version
  rows, never as assets. Notes are inert; a redo opens exactly one task
  (source `inspiration`). Revision-guarded, idempotent by event key.
- Owner decisions require a browser-session token (`via: "session"` claim,
  `ownerSessionMutation`); agent tokens get 403 / "Only Michael".
- Agent tools: list_inspiration, get_inspiration, list_inspiration_feedback,
  register_inspiration, propose_inspiration_adaptation,
  post_inspiration_version, block_inspiration_adaptation; skill 1.29.0,
  references/inspiration.md. Newspaper facts gain an Inspiration block.
- Limits and follow-ups: agent-docs/features/inspiration-review/PRD.md
  (public R2 media, no leases/fencing/budget ledger yet).

### 2026-11-05 — Edit in place: Ideogram 4.5 precise on fal; approve or discard a take
- Ideogram 4.5 precise runs on fal first (`ideogram/v4.5/edit`, Precise Edit,
  medium quality, $0.06 a take), Magnific behind it. Krea 3 stays the default.
- A landed take is pending: stored on its `editJobs` row (`takeMedia`,
  `review`), never an asset, so the grid, search, world pages and public
  views cannot show it. It sits beside its source in Edit in place with
  Approve (key 1) and Discard (key 2), on the hovered take or the one in the
  wipe; both update optimistically.
- Approve puts the take's picture on the same asset (id, tags, collections,
  links unchanged), reindexes and rehashes it, and records versions in the new
  `assetVersions` table (v1 the original). The panel's Versions strip restores
  any version. Discard archives the take into the Archive tray; Restore brings
  it back. Nothing is deleted.
- Agents: `review_asset_edit` (approve, discard, reopen) and
  `restore_asset_version` through `/api/agent/edits`; skill 1.28.0.
- Hosts (Inbox zoom, styles page) ask `lib/edit-take-keys.ts` before their own
  1 / 2 so the take keys win while a take is hovered or compared.

### 2026-11-05 — Gallery review keys sit in the dock; archived frames stay visible; sidebar rows truncate; tile KEEP removed
- The D / C / V hints and the Archive tray toggle are one segment of the
  bottom dock (`ReviewDockHints` in `BottomMenu`'s `trailing` slot), so they
  can never overlap it; under 1100px only the key letters show. The expanded
  view carries the same keys in its header. Notices use the coral toasts.
- An archived frame keeps its picture, grayed, with one chip: ARCHIVED, the
  countdown and RESTORE (narrow tiles drop the label, then the timer). D on an
  archived frame restores it; double-click still works. The tray opens above
  the dock and closes on Escape. The old `::after` label shared `.card-base`'s
  full-tile overlay and painted a solid box over the picture.
- Archive state is an external store (`useArchivedAt(id)` via
  useSyncExternalStore): archiving re-renders that one card, not every tile.
- Sidebar: Radix ScrollArea's `display: table` wrapper is now block, so world
  names truncate and the list cannot scroll sideways; status icons and the
  count share one non-shrinking column.
- The tile KEEP / KEPT pill and its coral ring are gone. `isLiked` data, the
  Liked-only filter and bulk Like stay.
- Keys: Escape in a field of the expanded view leaves the field instead of
  closing the view; Escape in the collection menu closes only the menu.

### 2026-11-05 — Test suite green, backlog reconciled (#146, branch `docs/backlog-reconcile`)
- `bun test` on main had 33 failures and 3 unloadable files. Skills tests moved off the removed `convex/workflows`; mock leaks between route tests fixed (see OBSERVATIONS, Dev workflow). 1142 pass, 0 fail.
- `BACKLOG.md` rewritten against the code: done, dropped (pillar-era items) and still-open items separated.

### 2026-11-03 — Settings: edit keys and Connect Magnific; C in Edit in place is a note for the reviewer (branch `feat/edit-keys-and-comment`)
- `/settings` (sidebar → Settings, owner only): where edits in place run, in
  route order. fal and Pika take an API key pasted here (checked live, sealed
  AES-GCM in `providerCredentials`, only the last four shown; it wins over the
  deployment's FAL_KEY / PIKA_API_KEY). Magnific is a plugin connection: OAuth
  with PKCE against auth.magnific.com (public client registered 3 Nov,
  `lib/magnific-mcp.ts`), tokens sealed and refreshed by `convex/providerVault.ts`.
  Check shows Pika's balance and Magnific's credits.
- Edits run on Magnific first where it has the model (Krea 3 1K, Ideogram 4.5
  precise (new), Seedream 5 Pro, GPT Image 2.5 Flare 2K, Nano Banana 2.1 2K),
  through its MCP server: frame and references uploaded by URL into the
  Magnific project named like the world (else "laniameda.gallery"), then
  `images_generate` and `creations_wait`. Not connected → fal / Pika as before.
  A send is priced on the route each model takes now.
- Edit in place: key C (and in the Inbox zoom with the panel open) writes a
  note for the reviewer, an owner comment on the image in view (the take while
  its wipe is open) that becomes a Tasks item with a context line in its brief.

### 2026-11-02 — Stories tab: markdown first, Human / Agent view, clutter refused (branch `feat/stories-md-first`, backend pushed 2 Nov)
- The tab was a form of eleven fields over a card grid, and 161 records mixed
  stories with 64 agent tickets (`GAL-…`), test saves, `[replaced]` copies and
  superseded versions. Now: an index on the left (Scripts / Ideas / Style
  locks, world chips, search; archived under Archive) and a reader on the right.
  Human renders the markdown with each picture the text names in a strip under
  its line and agent codes left out; Agent shows a front-matter block of ids
  above the raw markdown, with Copy md. Edit is one markdown box (first line is
  the title). `components/gallery/stories-view.tsx`.
- Backend (`convex/stories.ts`): `saveStory` refuses agent-ticket titles, test
  saves and version-copy titles on create or title change; every newly linked
  picture must be named in the body (`asset:<id>`); links to pictures deleted
  since drop out on save instead of blocking it. New lean queries
  `listStoryIndex` (no bodies) and `getStoryPictures`.
- Data: 26 open `GAL-` tickets archived (85 archived in all, 76 stories
  live); dead picture and storybook links removed from 9 records. Nothing
  deleted.

### 2026-11-02 — Gallery tiles look like the board tiles (branch `fix/gallery-board-tiles`)
- Michael pointed at the Dear Annete film board (Art Deco tab) as the look for
  the gallery. A tile is now a bare picture: no shadow, no hover zoom, no dark
  gradient. State is an outline inside the edge: faint linen on hover, coral
  when kept, ember when featured.
- One line of small dark mono chips along the bottom, visible at rest: the
  first collection in linen, the second, type, model, public; VIDEO and pack
  frame counts in ember. The owner's tags join the line on hover (click
  removes one). The line never wraps; the last chip fades at the edge.
- The top bar on hover: an ID chip (copies the id), PROMPT (drops the prompt
  sheet down from the top), download and collection as small squares on the
  left; exclude, delete, star and the KEEP / KEPT pill on the right. The heart
  is gone: the private like is the board's KEEP pill.
- Grid gutter 8 px, as on the board. CSS in `app/globals.css` (`.card-base`,
  `.card-icon-btn`, `.card-chip-btn`, `.card-keep`, `.lm-chips`).

### 2026-11-02 — Tagging moves to OpenAI with a short tag list; Jev files places and romance (branch `feat/tags-luna-shelves-jev`)
- Every new picture is tagged by OpenAI Decisions (`gpt-6-luna`) instead of
  Jev: one request, 0.6 s, about $0.0004 a picture. On 173 pictures labelled
  by eye it got 655 tags right and 10 wrong (Jev at live settings: 453 right).
  `lib/facet-tags.ts`, `convex/tagClassify.ts` (was `jevClassify.ts`), switch
  `TAG_CLASSIFY_ENABLED`.
- The tag list is cut to what helps world building: piece type, medium,
  interior/exterior, light, wide-shot/close-up, 3d-render, character-sheet,
  romance, horror, plus design kind and car angle on designs and cars.
  Couple, melancholy, glamour, world-detail, celebration, crowd, game-view,
  macro and product are retired and taken off the pictures the classifier had
  put them on (`assetClassifications:dropRetiredTags`).
- Fashion now needs 0.95 and the field question names costume art for a story
  world as story art; golden hour needs 0.9.
- Auto-shelving runs on Jev and files only the Places shelf and romance moods
  (`lib/shelf-rules.ts`, version 2); World building and the other moods were
  right too rarely to file unattended.

### 2026-11-02 — Gallery full width everywhere, square tiles, one tag row (branch `fix/gallery-wide-tags`)

Michael: the gallery must be wide on every screen, the tiles had turned round,
and a tile's hover tags overlapped. Width caps lifted: the toolbar island and the
storybook shelf (1180 px), the tasks wall (1216) and deck (1400), Decisions
(max-w-5xl; its stack grid now goes to 4 and 5 columns on wide screens) and
YouTube (1680). Grid tiles, their skeletons and shelf cards use `--lm-radius`
(2 px) instead of 12–16 px. On a tile the badges (type, collections, model,
public) and the removable tags were two absolute rows anchored bottom-left and
bottom-right, so they collided. They are one wrapping row now, with tags that
repeat a badge dropped and tags past three collapsed into +N. Public showcase
pages keep their own 1200–1400 px layout.

### 2026-11-02 — /tasks opens on Decide: one call at a time, then All done (branch `feature/tasks-decide-flow`)

Michael: the wall of ~50 frames (2 questions, 34 reports, 12 queued jobs) was
confusing, with no clear next step. `/tasks` now opens on **Decide**
(`DecideDeck` in `components/tasks/review-wall.tsx`): a progress strip, then
one card. Pictures sit large on the left, and the question and answers sit on
the right (on the phone the question comes first). Questions come first: ask
options as lettered rows (A–D keys, agent pick in ember), Other answer (↵),
Not needed (2). Then finished work: Accept (1) and Send back (C). A decision
stamps the card and the next slides in after 650 ms. → skips, ← steps back, and
Z undoes and returns to that card. The end screen reads All done with a tally
and thumbnails, plus Back to gallery (↵). If any were skipped it reads
"N skipped" and offers to go through them. Picture piles still to sort link to
their desks. **Everything** is the old wall, unchanged, and the world tabs keep
the wall. Stamps, the 6 s pick delay, undo and ghosts are the wall's own `act`,
shared.

### 2026-11-02 — Styles page as full-width masonry, with keys on every frame (branch `feature/styles-masonry-redesign`)

Michael on the first styles page: too much repetition, an Agent mode and sizes
that did nothing, the recipe column in the way. Now `/w/<world>/styles`:
- the carousel of style covers on top, one band under it (name, line, moodboards
  and profiles by name with board thumbnails: `styleFrames:styleMadeWith`, from the
  record or read from the frames' `--profile` codes), storybook chips that filter,
  then the frames as bare masonry over the full width (shortest-column layout,
  1 / 2 / 3 columns by width; pages load at the bottom).
- the open view carries everything else beside the full-resolution frame:
  like / super like pills, Style / Collection / Storybook / Off this style, where
  the frame is filed, what it was made with by name, the prompt with codes read as
  names, Edit in place (with before/after wipe), the style's prompt and what moves
  it, comments (`styleFrames:getFrameView`).
- keys on the hovered or open frame with a confirmation on it: 1 like, ⇧1 super
  like, 2 off this style (grays in place, 2 restores), S style, M collection,
  B storybook + beat, E edit, C comment, O open, I copy id. Moves go through
  `worlds.fileAssetsInWorld` (journaled, session `styles-page`): `setFrameStyle`,
  `placeFrame` (a target in a sibling world moves the frame there). A beat writes
  `asset:<id>` under BEATS TO REFERENCES (`addAssetToBeat`), writing the book's
  shelf-order placements first when it had none.
- `assets.superLikedAt` + `setAssetLikeLevel`: a private super like (the curator
  star publishes, so it is not used here).
- Krea 3 edits that fail rerun once on GPT Image 2.5 Flare (`editJobs.failJob`).
- `assetDocValidator` gained `thumbVariants` (getAsset threw on every image with
  grid renditions) and `superLikedAt`; `tests/asset-return-validator.test.ts`
  checks it covers the schema.

### 2026-11-02 — Every new picture tags itself with Jev (branch `feat/jev-autoclassify`)

- `convex/jevClassify.ts` asks Jev (TypeSafe System One, `jev-latest`) 17 questions about each new
  image or video poster: field (story art, design, vehicle, fashion, architecture, product), medium,
  piece type, setting, light, shot, people, design kind, car angle, character sheet, game view, world
  detail and five moods. One request per picture, about 2.5k input tokens ($0.0001).
- `lib/jev-facets.ts` turns sure answers into the tags the menu tabs already filter on (Characters,
  Locations, Scenes, Live action, Animation, Design, Character sheets, Game views) plus facet tags.
  It only fills empty slots and never removes a tag. Thresholds from 180 Dear Annete frames: at 0.9
  type agreed 89/96, setting 82/85, light 30/30; 3D only at 0.99 (Jev leans to "3D" on cinematic
  Midjourney stills); glamour at 0.95; moods only on story and fashion pictures.
- Runs before the asset's first describe/index (so the tags are in the search text) and hands that
  step on; retries 1, 5 and 30 minutes later on a busy API or a missing video poster.
- `assetClassifications` keeps the answers and the added tag ids; `undoClassificationTags` takes them
  back. Backfill: `jevClassify:backfillJevClassify {ownerUserId}`.
- Off unless `JEV_CLASSIFY_ENABLED=true` and `TYPESAFE_API_KEY` are set on the deployment.
- Style detection by Jev is an experiment only (2 Nov: 25/28 right when sure on Art Deco, but the Ink
  Noir shelf fooled it); nothing files into styles automatically.

### 2026-11-02 — Auto-shelving with OpenAI Decisions; extension asks only for the collection (branch `feat/extension-auto-shelf`)

- A new picture saved into a world also lands on that world's Places, World building and Moods
  shelves the model is sure of (`convex/shelfClassify.ts`, rule `lib/shelf-rules.ts`, rows in
  `assetShelfFilings`, undo `assetShelves:undoShelfFilings`). Cast and Styles are never auto-filed;
  a group already picked by hand is left alone. Off unless `SHELF_CLASSIFY_ENABLED=true`.
- Model choice from four tests on 2 Nov (Jev vs OpenAI Decisions, `gpt-6-luna`): OpenAI wins or ties
  on flaws (writing and bars only), intake crops (37/40 vs 32/40) and speed (~1 s vs 2-3.5 s); Jev is
  cheaper and keeps the ingest tagging. Neither predicts taste or judges hands.
- Extension 0.18.2: Midjourney saves carry no source tags (midjourney, midjourney-web/-explore/-profile/-teach,
  personalize). The save route drops them even from older extension builds; the model field still records
  Midjourney and teach/profile pages still file as inspiration. `personalize` is hidden from the filter bar.
- Extension 0.18.1: the Midjourney moodboard dock retries when Chrome closes the message port (service worker
  mid-restart, or a worker older than the tab) and then asks the gallery directly, so "Could not refresh
  moodboards. The message port closed…" no longer sticks. Timed refreshes keep the codes already shown.
- Extension 0.18.0: the type and medium pickers sit behind "set type or medium by hand"; the panel
  says the rest is filled in automatically. The badge shows the manifest version.

### 2026-11-01 — Storybooks as a board (branch `feat/storybooks-masonry`)

- /storybooks has the HEEL board's shape: one chip row of filters, a strip of
  covers (2×2 mosaic, name, status chip), then the chosen book inline as bare
  masonry by beat (S/M/L, natural aspect, srcset renditions, name chips on the
  frame, section chips that filter). Address follows the selection.
- A frame opens the gallery's detail panel (Edit in place). Story and Agent's
  text tabs replace READ/RAW; the storybook modal is gone, and a book opened
  anywhere lands in this view.
- Quirk: `--lm-font`/`--lm-font-display` resolve to nothing (Tailwind
  `@theme inline` never emits `--font-sans`/`--font-mono`); new CSS reads
  `--font-geist-sans`/`--font-geist-mono` directly, as `.wdoc` does.

### 2026-11-01 — World page opens on its styles (branch `feat/world-page-styles`)

- A world root in the vault (`/w/<world>`, Pieces) now starts with a styles
  strip: every style of the universe as a 2×2 mosaic card (name, medium chip,
  frame count), filtered by medium chips (Film / Art Deco / 3D / Iron Stage)
  instead of reading the sibling worlds one by one. A card opens
  `/w/<world>/styles/<style>`. The strip is its own `dynamic()` chunk and
  subscribes after the grid's first page (`supportQueriesOn`). At the root the
  old style switcher row is hidden and the Styles shelf group moves to the end
  as "Style shelves" (some shelves are not named styles yet).
- Styles page: mosaic carousel cards, medium chips in film / deco / 3D order,
  and "In the stories": one row per storybook of the style's world that holds
  its frames, in the book's filing order with beat numbers, before every frame.
  New query `worldStyles.listStyleStories` (read only, backend pushed 1 Nov
  23:20). "Full recipe" reads "Style lock".
- Same night, audit of the four DEAR ANNETE worlds: 186 type tags corrected
  under session `world-audit-2026-11-01` (undo with world_undo); report and
  logs in `~/AI-video-work/Dear Annette/world-audit-2026-11-01/`.

### 2026-11-01 — World styles: a world holds several named styles (branch `feature/world-styles-page`)

- New table `worldStyles` (name, slug, one-line look, family, status draft/ready/
  archived/merged, its shelf, covers, recipes of moodboards + profiles in stack
  order with parameters, prompt template and frame counts, raises/lowers, style
  lock story). `folders.universeRootId` joins sibling worlds into one universe
  (DEAR ANNETE + 3D + Art Deco + Iron Stage) so they read together.
- Page `/w/<world>/styles[/<style>]`: wide, no sidebar, a carousel of every
  style in the universe grouped by family, then the style's frames in masonry
  with the recipe rail (moodboard and profile names; codes only in the Agent
  view). Keys: ←/→ style, O open frame, A agent view; S/M/L tile size. A Styles
  tab sits in a world's tab row.
- Agent tools: list_styles, get_style, save_style, file_style, merge_styles
  (dryRun), world_universe, and find_assets (batch "is this in the gallery" by
  Midjourney job + index, mj-<job>-<i> file names, board short ids, URLs).
  Route `/api/agent/styles`; registered in the hosted MCP route map.
- Seeded 23 DEAR ANNETE styles as drafts from the Look Library board
  (session `world-styles-seed-2026-11-01`); five looks with no shelf yet wait
  for the 3D-in-Film call.

### 2026-11-01 — Extension 0.17.0: ⌘⇧P saves with the last settings (branch `feat/extension-sticky-save`)

- ⌘⇧P (Ctrl+Shift+P) saves the image under the pointer, or Midjourney's open
  image, with the last save's collections, piece type and style tag, no menu;
  the toast names where it went. A tab opened before the extension loaded gets
  the content script injected on first use. Videos still save through Save.
- Dear Annete "scene" keeps its command without a suggested key (Chrome allows
  four); bind it in chrome://extensions/shortcuts if wanted.
- The unpacked extension reloads itself when the manifest version on disk
  changes (checked on tab switch and shortcut, once a minute).
- Michael's Chrome (profile mbuloichykai) loads it unpacked from the main
  checkout's `extension/`; that checkout was 128 commits behind (0.12.1).

### 2026-11-01 — Tasks: Human view and Agent view (branch `feat/tasks-human-view`)

- Two layers per task: `title` + new `summary` (one plain line) are Michael's;
  `brief` + `result` are the agent's. Agents must write a summary on create
  and on done; a title or summary with a path, id, tool name, flag or markdown
  is refused (`lib/tasks.ts` jargonIn / titleProblem / summaryProblem).
- `edit_task` (route action `edit`) lets an agent rewrite a title or summary.
- Auto tasks: a comment task is titled with his comment's first line, an
  Inbox task "Apply your picks: <stack>".
- The sheet's headline is the title (or the ask); the summary sits under it;
  "Details" is gone from the Human view, replaced by "Agent notes", which opens
  the task in the Agent view.
- The rule reaches every agent: MCP server instructions and task tool texts,
  the skill (tasks.md, SKILL.md), the plugin skill, open_world's task note,
  the repo CLAUDE.md/AGENTS.md and the global CLAUDE.md.

### 2026-11-01 — Speed thread finished (#122, #123)

- Grid page first, sidebar data after: on home the first Convex frame went from
  864,626 B to 407,903 B; the folder tree, tags, counts, saved views and badges
  follow once the grid's first page is in. `listSkills` takes `slim`;
  `listStorybooks` sends story head, first beat and world name.
- Home no longer jumps: the storybook shelf opens from the last visit's books
  (home addresses only). Lighthouse mobile `/` 10 → 56, CLS 0.545 → 0, TBT
  6.1 s → 0.6 s; signed out `/` and `/w/dear-annete` 98.
- `thumbnails:backfillCardThumbnails` takes `assetIds`; the 40 shelf previews
  without 480/960 renditions were rebuilt.
- Grid virtualisation measured unnecessary. Report, data, decisions and next
  steps: `agent-docs/perf/report-2026-11-01.md` (+ `.html`).

### 2026-11-01 — Questions for Michael are pictures (branch `feat/visual-asks`)

- A blocked task needs an `ask`: one-line question (≤140), 2–4 options, each
  a few words and the frames that show it, at least one frame, one optional
  agent pick. `complete_task {blocked: true}` without it is refused (route and
  `completeTask`); the reasoning moves to `result`, behind Details.
- /tasks sheet: the options are picture columns side by side, rows in the same
  order; a click or the letter key A–D sends `Picked B: …` and reopens the
  task. The wall frame and the newspaper show the question, not the prose.
- Rule source: `skills/laniameda-gallery/references/tasks.md`, "A question for
  Michael is pictures and a one-click pick".

### 2026-11-01 — In-place edits (branch `feat/in-place-edits`)

- The reviewer kit's quick edit, in the gallery. "Edit in place" in the asset
  detail panel and beside the Inbox zoom (key E): prompt, model pills priced
  for the image on the route each would take now, takes 1–8, the world's cast
  (canonical sheet and face) attached as `<image-2>` and on. Takes list under
  the source with status, cost and Retry; a landed take opens a before/after
  wipe that follows the pointer.
- `editJobs` table, `convex/editJobs.ts` (start, retry, list, runner
  bookkeeping) and `convex/editRunner.ts` ("use node": submit along the route
  with out-of-credit fall-through, poll by request id via the scheduler, file
  the result). Pure routing, prices and request bodies: `lib/edit-models.ts`.
- Agents: `edit_asset`, `list_asset_edits`, `retry_asset_edit` through
  `/api/agent/edits`.
- `FAL_KEY` and `PIKA_API_KEY` are Convex environment variables.

### 2026-10-31 — Midjourney saves keep their metadata; the copy list (branch `midjourney-save-metadata`, not merged)

- A save from midjourney.com stores `assets.midjourneyMetadata`: job, tile,
  every moodboard and profile code with its type and name, and the job's
  settings. The asset's `sourceUrl` is the job page. The detail panel shows it
  with copyable flags. Field detail: `skills/laniameda-gallery/references/data-model.md`.
  Convex must be pushed before the Next route ships: `ingestFromApi` rejects the
  new argument until it is.
- Copy list (extension): each Midjourney image gets a link control beside Save
  that adds `https://www.midjourney.com/jobs/<id>?index=<n>` to a list Michael
  hands to an agent. Separate from the gallery: adding saves nothing, saving adds
  nothing. Prompt and codes are read after the link is stored and sit beside it.
  A dock on midjourney.com shows the count, Copy all and the list. Copying never
  clears; only Clear list (two clicks) empties it. Stored in
  `chrome.storage.local`, written only through the service worker's queue so two
  tabs cannot overwrite each other. Code: `extension/midjourney-copy-list.js`.

### 2026-10-30 — The morning newspaper (branch `feat/newspaper`)

- `newspapers` table and `convex/newspaper.ts`: `compileFacts` reads the last
  24 hours from the journal, assets, tasks, Inbox stacks, moodboards,
  characters and storybooks (index-backed, 600 rows per table at most) into
  one facts JSON per world plus a `needsYou` list (open stacks, blocked tasks,
  draft boards with images). `convex/crons.ts` runs `compileAll` daily at
  05:30 UTC (07:30 Prague) for `KB_OWNER_USER_ID`; `notify` sends the Telegram
  line through the shared `convex/telegram.ts` when a bot token is set.
- MCP `get_newspaper`, `write_newspaper`, `compile_newspaper` over
  `/api/agent/newspaper`; skill `references/newspapers.md`, version 1.16.0.
- `/newspaper` and `/newspaper/<date>` (`components/newspaper/newspaper.tsx`),
  phone-first: masthead with date picker and Recompile, headline counts,
  Needs you, Done since yesterday per world with thumbnails, Questions and
  decisions, the agent's prose. Newspaper in the sidebar and the browse sheet.
- Tests: `tests/newspaper.test.ts`, `tests/newspaper-mcp.test.ts`.

### 2026-10-29 — Phone navigation and tap targets (branch `feat/phone-nav`)

- The bottom bar's Search tab opens a browse sheet
  (`components/gallery/mobile-browse-sheet.tsx`): a focused search box, the
  Worlds › Shelves tree grouped as in the sidebar, the plain collections, and
  the sections (Storybooks, Stories, Moodboards, Skills, YouTube, Motion,
  Cinematography, Tasks, Decisions). Typing narrows all of it; Enter searches
  the pieces. Rows are 44–56 px. Taps route through `applyLocation`.
- Toolbar chips are 40 px tall on phones with 14 px padding; the PUBLIC/MINE
  segment too. Chip rails fade at the edge that has more (`useChipRail`,
  `.lm-chip-rail[data-fade]`), on desktop as well. The 10 px minus is hidden
  on phones: holding a menu chip excludes it.
- Feature note: `agent-docs/features/phone-navigation/README.md`.

### 2026-10-29 — Every view is a URL (branch `feat/url-state`)

- `lib/gallery-routes.ts` is the one grammar: `/`, `/collections`,
  `/w/<worldKey|rootId>[/<shelfId> | /instructions|journal|tasks|moodboards|folders]`,
  `/storybooks[/<id>]`, `/moodboards[/<id>]`, `/stories[/<id>]`, `/skills[/<id>]`,
  `/bookmarks`, `/motion`, `/cinematography`, plus `?asset=<id>` for the detail
  panel. The dashboard derives the route from its view state, pushes it on
  every change, reads it on load and on back/forward (`popstate`), and titles
  the tab after the place. Old client-state navigation is untouched; it just
  shows in the address now.
- Pages: `app/w/[slug]` serves the public world to a visitor and the vault to
  the signed-in owner (`?public=1` shows the public page anyway);
  `app/w/[slug]/[...rest]`, `app/storybooks`, `app/moodboards`, `app/stories`,
  `app/skills`, `app/collections`, `app/bookmarks`, `app/motion` and
  `app/cinematography` all render `components/gallery/gallery-root.tsx`.
- "Copy link" on the world header (breadcrumb row) and in the detail panel
  (header icon and the copy menu).
- Agent routes return `url`: `open_world` (world list; world with
  `instructionsUrl`/`tasksUrl`/`journalUrl`; shelves, storybooks, moodboards,
  stories), `list_collections`, `list_moodboards`/`get_moodboard`, `get_story`
  (and story saves). Skill 1.15.1 documents it.

### 2026-10-28 — World Instructions: a reader and an editor
- Reader (`world-doc-prose.tsx`, `lib/world-doc-markdown.ts`): a ~72-character
  measure at 16/1.65 Geist, numbered uppercase section titles, tables that
  scroll inside themselves, inline code as copy-on-click mono chips (Midjourney
  codes named from the world's boards and profiles), `story:` / `asset:` /
  `moodboard:` references as chips that open the item (Stories, asset detail,
  Moodboards; asset chips preview the picture on hover), rule attributions in
  mono, LEARNINGS as rows (id, date, text, src) and a sticky contents column
  that folds into a bar on narrow widths.
- Editor (`world-doc-editor.tsx`), opened the same way from HUMAN and AGENT:
  markdown beside a live preview that follows the caret (Write / Split /
  Preview; stacked with a toggle on a phone), a sticky cap meter, ⌘S saves,
  Esc cancels and asks first when dirty, Tab / ⇧Tab indent, the draft kept in
  localStorage per world and path until saved or discarded, and a conflict
  bar (show the newer revision, keep my draft, or take theirs). Still
  `writeWorldDoc` with the base revision; no Convex change.
- AGENT view: real mono (`--lm-font` resolves to sans because `--font-mono`
  is inlined by `@theme inline`), wrapped table rows, a header strip per file.

### 2026-10-28 — World Instructions: HUMAN / AGENT views of a world
- The world's Docs tab is now **Instructions**, second after Pieces, and shows
  on the world root and on every shelf, style branch and storybook inside it.
- HUMAN: WORLD.md / LEARNINGS.md / docs with the existing edit, history and
  undo, plus a world map from `worlds:getWorldContext` (styles and locks,
  moodboards with copyable codes and sync state, profiles, shelves,
  storybooks, characters, recent changes).
- AGENT: the same `getWorldContext` that `open_world` returns, written as one
  raw markdown document (`lib/world-agent-doc.ts`) with docs/*.md bodies
  appended; Copy all / JSON; each file editable as raw text through the same
  `writeWorldDoc` save path (`useWorldDocSave`, revision guard, caps).
- Floating HUMAN / AGENT toggle ported from portfolio-second: localStorage
  `lm-world-view`, `M` toggles outside inputs, both panes stay mounted and
  cross-fade. No backend change.

### 2026-10-28 — world_recount: repair a world's stored collection counts
- `worldCounts:recountWorldCounts`, MCP `world_recount`, `/api/agent/worlds`
  action `recount` (read scope for a dry run, write otherwise). Recounts
  `memberCount` and `publicMemberCount` for the world root and every child from
  `assetFolders` (plus public primary-pointer members), pages under Convex read
  limits (the route follows the cursor), dry run lists stored vs recounted,
  corrections journaled as `world.recount` (undo re-derives, never blocks).
- Audit of every membership write path (world_file move, world_move, world_undo,
  setAssetFolders / update_gallery_item, setAssetFolder, addAssetFolders,
  removeAssetFolder, ingest, inbox, delete, merge, cleanup): all recount and
  resync. On 28 Oct every one of 223 stored counts matched its rows; the
  "stale" DEAR ANNETE shelves were real (a filtered `list_assets_page` page can
  be empty with `isDone: false`). Tests: tests/world-counts.test.ts.

### 2026-10-28 — world_move: a shelf, storybook or moodboard crosses worlds on purpose
- `worlds:moveToWorld`, MCP `world_move`, `/api/agent/worlds` action `move`.
  The ordinary paths (update_collection, save_moodboard) still refuse to cross
  worlds and now point at world_move. A shelf or storybook keeps its id, goes
  under the target root, and its pieces leave the source world (listed when
  they also left other shelves there); stories pointing at it from the old
  world come back as `storiesToRepoint`. A board keeps id, items, code and
  sync record; other-world items need `items: move | drop`. Dry run; journaled
  as `world.move` in both worlds with a shared pair key; `world_undo` reverts
  both entries and the piece memberships together.

### 2026-10-23 (#69, #70; backend pushed 23 Oct, live) — gallery harness 1.0
- Worlds are marked roots (`folders.worldKey`); 12 marked then, 13 since
  `dear-annete-3d` was marked on 29 Oct 2026. Convex refuses any
  write that puts an asset, board item, character link or new story link into
  a second world; shelves cannot move across worlds. Storybooks are children of
  their world (group Storybooks); 17 root storybooks moved in.
- World files (`worldDocs`): WORLD.md / LEARNINGS.md / docs/*.md with caps.
  Seeded for all worlds (12 then, 13 now); the private worlds.md shrank from
  42k to 12.5k (gallery-wide rules only) and is edited over MCP with
  `update_skill_instructions` since 30 Oct 2026 (#104). Backup and migration
  log are private, outside the repo.
- Journal (`worldChanges`) for every world write, including the collection
  editor and update_gallery_item; `world_undo` is content-based, all or
  nothing, exact dry runs. `mjProfiles` with a role per world (9 imported).
- MCP: open_world, world_doc, world_file, world_shelf, mj_profiles,
  world_journal, world_undo, mark_world; `world` filter on search/listing.
- UI: Docs and Journal tabs on world roots.
- Claude Code plugin `plugin/` (1.0.1) + repo-root marketplace `laniameda`.
  Plan: `agent-docs/features/world-harness-1.0/PLAN.md`; `agent-docs/PLUGIN.md`.


### 2026-10-19 (branch `claude/moodboards-feature`, frontend only)
- Moodboards are their own feature. A Moodboards tab in the sidebar and the
  mobile nav (Boards) lists every board grouped by its world, with previews,
  status, image count and the Midjourney code, filtered by world and status
  (remembered per browser). Opening a board shows it in order with reorder,
  remove, the look line, the code and Send to Midjourney.
- Choose from gallery: a board's button opens the normal grid in picking
  mode on the board's collection. Collections, saved views, pills, search,
  piece type and liked all work; a click selects, a bar says "Adding to
  <board> · n selected" with All visible, Clear, Cancel and Add n. Pieces
  already on the board are marked "On board" and cannot be picked. Adding
  (batches of 100) or cancelling returns to the board, in the tab or in the
  world's Moodboards panel. The card menu's Add to moodboard stays.
- Files: `components/gallery/moodboards-tab.tsx`,
  `components/gallery/moodboard-pick-bar.tsx`; `markedAssetIds` on
  `MasonryGrid`/`ImageCard`. No Convex change: it uses the deployed
  `listMoodboards`, `getMoodboard` and `addMoodboardItems`.

### 2026-10-19 (#56, #60; backend pushed 19 Oct 23:25 CEST, live)
- Comments on every asset: a thread in the detail panel (Details tab, under
  Description), oldest first, Enter to send, delete on hover; agent replies
  are marked Agent. Table `assetComments`, functions in
  `convex/assetComments.ts`, removed with the asset. Agents read a thread in
  `get_gallery_item` (`comments`), list one thread or the newest across the
  vault with `list_asset_comments`, and reply with `add_asset_comment`
  (`/api/agent/comments`). Until the backend is pushed, the panel hides the
  section and `get_gallery_item` returns `comments: []`.
### 2026-10-19 (branch `claude/moodboards-tab`, frontend only)
- Collection tabs under the breadcrumb: Pieces, Folders (in a world) and
  Moodboards with its board count, on every world root and style branch and
  on any other collection that has boards. They replace the small Moodboards
  link at the end of the breadcrumb. Saved views and smart filters no longer
  hide or close the Moodboards panel. Icons drop below 640 px so the three
  tabs fit a phone.

### 2026-10-19 (branch `fix/folder-tree-read-limit`, backend hotfix)
- `assets:listGalleryAssets` no longer fails with "Too many reads (limit:
  4096)" on a big world. A world view under the FEATURED or SHUFFLE sort (and
  agents' `list_assets` with `includeDescendants`) read up to 2,000 links per
  folder for the root and every shelf, one `db.get` per link, then hydrated
  every piece. DEAR ANNETE (about 1,400 pieces, 30 shelves) sat at about 3,950
  reads. The world's link ranges are now merged newest first and deduped
  before any piece is fetched, and one call spends at most about 3,000 reads
  (`QUERY_READ_BUDGET`): it returns the newest pieces that fit. Searches and
  hidden-collection checks pay from the same budget. Folder helpers fetch at
  most 2,000 members. The NEWEST world view already pages through
  `listGalleryAssetsPage` and is complete.

### 2026-10-19 (branch `claude/empty-folder-prompt`, frontend only)
- No empty collections left behind: when a collection's last piece leaves
  (deleted, moved, removed, or filed elsewhere by an agent) and it has no
  child collections, a card asks to delete it (Keep / Delete collection).
  A world is asked about once its last asset and last child are gone. A
  folder that still holds a moodboard, story or Skill is never offered, and
  folders that were already empty when the vault opened are left alone.
  Logic `lib/empty-folders.ts`, card `components/gallery/empty-folder-prompt.tsx`.

### 2026-10-19 (branch `claude/style-scoped-folders`, frontend only)
- Styles as the parent of a world's shelves. A world's children in the
  `Styles` group (DEAR ANNETE: Film · Live Action, 3D Animation) scope its
  other folders. Opening a style branch shows the world's shelves as stacks
  holding only that style's pieces (counted from the branch's own pages);
  opening one keeps the scope (breadcrumb Collections › DEAR ANNETE › Film ›
  Streets). A `STYLE` switcher under the breadcrumb (All styles plus each
  style with pieces) appears in worlds with two or more styles. Logic in
  `lib/style-scope.ts`; membership only, no Convex change.
- The folders view opened inside a collection shows that world's children
  under their group headings, with a `Collections` crumb back to every folder.
- A world whose pieces all sit in its folders (DEAR ANNETE — ART DECO) shows
  its grouped stacks at once instead of a skeleton until the world scan ends.

### 2026-10-19 (branch `feat/collection-moodboards`, backend published)
### 2026-10-21 (branch `feat/group-similar`)
- Group similar: a Similar view option in every grid (collection, shelf,
  saved view, search) puts near-identical images side by side in clusters,
  with a Tight–Loose slider, and from a cluster stacks it, sends it to the
  world's Inbox as a duplicates card or selects it. Each image gets a
  perceptual hash at ingest (and from a batched backfill); agents call
  `find_similar_groups`. Detail: `features/inbox/README.md`.

### 2026-10-21 (branch `feat/swipe-deck`)
- The world Inbox, labelled Decisions: each world has stacks of decision
  cards that agents post (sort, duplicates, artifact, A/B, choose one, rule)
  and Michael answers one at a time on his phone or with keys, at
  `/inbox/<world>`, with a badge per world. Decisions apply through the
  gallery's own data (moodboards, collections, a hidden Out collection,
  stacks of alternates shown as one card in the grid), undo reverses exactly
  that, and duplicate deletion is confirmed once per group. Notes on images
  are asset comments, now with voice notes. Five MCP tools, skill
  `references/inbox.md`. Detail: `features/inbox/README.md`.

### 2026-10-19 (branch `feat/collection-moodboards`, awaiting backend publish)
- Moodboards: ordered sets of gallery images that define one look, mirrored to
  a Midjourney moodboard and its `--profile` code. Each belongs to a plain
  collection. A collection's header has `Moodboards · N`, which opens board
  cards with cover mosaics, a board page (drag to reorder, cover, remove,
  Send to Midjourney: zip, image links or an agent request, sync state and
  "Made with this board") and `New moodboard`. Any card menu or a selection
  adds images through a picker with ticks. Agents use nine MCP tools on
  `/api/agent/moodboards` and record the code with `set_moodboard_midjourney`.
  Asset and collection deletes cascade. Skill 1.11.0, contract 2026-10-19.1.
- Collection groups: a child collection can carry a display `group` (Styles,
  Places, Cast) and `sortOrder`. A world page shows its child stacks under
  group headings; the sidebar and collection cards list children group by
  group. Ungrouped children keep today's order. Detail:
  `features/collection-moodboards/README.md`.

### 2026-10-18 (#52; backend pushed 19 Oct 23:25 CEST, runbook step 1 only)
- Convex Database I/O cuts after the Free-plan deployment was disabled. Search
  asks each lane for 2× its limit (32–96) before widening to 256, cuts split
  lanes by score before mapping hits, and hydrates about its limit instead of
  60 assets. Unchanged reindexes no longer rewrite the 56 KB legacy row.
  Optional split semantic storage (`SEMANTIC_STORAGE`) keeps vectors at 768
  values in their own rows, with a provider-free, resumable migration and a
  10-query eval. The cached inventory export replaces paging every asset; the
  extension batches and caches saved-status lookups. Figures in
  `DATABASE_IO.md`, steps in `SEMANTIC_SPLIT_RUNBOOK.md`.

### 2026-10-16
- Named characters are first-class: each person in a world gets a stable code (`DA-CH-001`), costumes as `-C01`, a canonical sheet and face, and typed links to every asset that shows them. Agents use nine MCP tools (list/get/create/update characters, costumes, link/unlink, delete); `get_gallery_item` names the people in an asset. The sidebar's Characters view shows the cast by world and status and a page per character. Detail: `features/characters/README.md`.

### 2026-10-09
- Gallery bookmark cards remain visible in the regular grid and now have a dedicated owner-only filter-bar toggle, separate from curated tag filters and the Bookmarks view. Design inspirations discard stale linked asset/prompt IDs during create/update while retaining ownership checks for links that still exist.

### 2026-10-06
- Restored world cards on Featured and published flat-world routes such as `/w/cassandra`. World addresses no longer depend on retaining subfolders; private members remain excluded. Cassandra's public presentation retains its original published assets and omits internal audit notes.
- Private **Stories / Scripts**: text-only ideas, scripts and world style locks, with world/type/status filtering, search, linked visual boards, revision history and stale-edit protection. The owner UI, scoped agent API, hosted/stdio MCP and canonical gallery skill share the same contract. Original and rewritten text from 14 audited storybooks is preserved in this section.
- Owner filter presets save curated include/exclude pills, collection, media, favorites, ordering, stack expansion and whether Skills appear. Starter views are No skills, Inspirations, Animated characters, Locations and Game views. Removed collections or unresolved positive tag filters cannot silently broaden a saved view.
- The new private tables require signed owner identity even during the older gallery's legacy auth rollout. Missing source links have an explicit repair action that retains earlier references in history.
- Sparse tag filters now search older batches when recent items do not match, so presets can find older reference sheets and game views. Collection views retain their own indexed read path.
- Gallery curation separates Pinterest inspiration from production worlds, Dear Annete's LIZ animation from development and Unreal Engine, and reusable references from Skills. The legacy `/w/liz` address redirects to `/w/dear-annete`. Full audit evidence is under `recovery/gallery-audit-2026-10-06/`; current filing/style rules are in the gallery skill's `references/worlds.md`.

### 2026-10-05
- YouTube cards and thumbnail wall reuse their existing overlay for up to 24 timed storyboard frames: auto-cycle, horizontal scrub and keyboard arrows/Home/End. Frames load only on hover/focus behind the existing gate, with stored stills as fallback. Removed material-origin badges, controls and source-look writeups; legacy metadata remains compatible.
- The existing YouTube view now displays private niche-bending proposals for the signed-in owner: title, thumbnail layout, animation style, structure, first 30 seconds, demand/saturation thumbnail evidence and an external demand reading. Proposals use the existing `bendIdea` field and toolbar, with no new dashboard or schema. Shared-password visitors receive no private fields.

### 2026-10-03
- Bookmarks from a link, with their text. Agents save an X post by its URL (`save_bookmarks` MCP tool, `scripts/bookmarks.ts`, `/api/agent/bookmarks`): the gallery reads the author, text, media, quoted post and counts itself, so text-only posts are saveable too. A post whose images or video were already in the gallery is linked to those pieces instead of copied; they keep their role and gain the post in the detail panel and in search. 25 posts behind 47 existing X pieces were linked this way.
- The island bar has a **Bookmarks** pill (tag `bookmark`). With it on, each post shows once as a post card with its text. The vault's keyword search now matches post text, author and note; `list_bookmarks` reads saved posts as text for agents.
- Deleting one piece of a multi-image post no longer deletes the bookmark while other pieces remain.
- Fixes found on the way: the hosted MCP never registered `/api/agent/video-refs`, so the video-reference tools failed there; `next dev --webpack` crashed on first compile since the `.claude/skills` symlink landed (Tailwind's source scan now skips `.claude` and `skills`).

### 2026-10-02
- X post bookmarks: the extension (v0.12) puts a Save button on every post on x.com. It saves the post's author, text, permalink, time, media, quoted post and counts as a bookmark, filed into the collections you pick, with an optional note. Bookmarks render as post cards in the grid, have their own Bookmarks view in the sidebar (collection chips, search), and lead the detail panel with the full post. Detail: `features/x-bookmarks/README.md`.
- The extension creates a root **Cars** collection once per install.
- Agents can now SEE the gallery, not just read its JSON. `agentPreview:contactSheet` (Convex Node action, owner-scoped) composes up to 48 assets into one numbered JPEG grid from their card thumbs or video posters, with a legend mapping each number to its `asset:<id>`, tags and agent description. Sheets cap their long edge at 1568px, the size Claude scales images down to for vision anyway. Labels are drawn from a built-in bitmap font (`lib/contact-sheet.ts`), so they don't depend on system fonts. Three entry points: the MCP tool `preview_assets` (an inline image block, from a query, filters or ids), the skill CLI action `preview` (writes `sheet-N.jpg` files for the agent's image reader, up to 96 pieces across sheets), and the agent API action `contactSheet` on `/api/agent/gallery`.

### 2026-09-26
- Gallery tiles now load WebP card thumbnails instead of originals. Before: 1,810 of 2,427 image tiles pulled the full original (629 of them over 2 MB), 48 video tiles mounted the full video for want of a poster, and existing thumbs were quality-100 JPEG or PNG at a median of 500 KB. Scrolling the whole grid now costs 160 MB for images (was 4.5 GB) and 8 MB for video posters (was 670 MB); the median tile is 47 KB. All ingest paths (API, agent, cinema frames, design saves, browser posters) share one sharp encoder; `thumbnails:backfillCardThumbnails` rebuilt the existing thumbs and `scripts/backfill-video-posters.ts` gave 18 poster-less videos a poster via local ffmpeg.
- Public pages (Featured, Worlds, Browse) render their first screen at hydration: the static page (rebuilt every 5 minutes) carries the first screen's data and preloads its thumbnails with the HTML, and the page no longer waits for `/api/auth/me` before querying. On a throttled first visit the first screen finishes in 0.7–1.0 s instead of about 2.1 s. Grid video tiles on Featured mount only after their poster has painted.
- The tile rule counts portrait thumbs by height (`isCardThumbSharp`), so a 540×960 thumb no longer sends a 3 MB original into the grid. The public lightbox paints the cached thumb at once and swaps the original in after it decodes.
- Prompt families (REMOVED 9 Oct 2026 in 11a7d0a: each variation is its own tile again; `lib/prompt-family.ts` remains but the grid no longer calls it): the grid folds the same prompt saved as separate rows, and variations of one prompt (e.g. a Masa template with the spoken line rewritten), into one pack. Rules live in `lib/prompt-family.ts` (content-word similarity, generation params ignored, variations within 3 days, identical text at any distance); web bookmarks and cinema frames never fold.
- Packs render as stacked, self-rotating decks: cards peek out behind the front one, the front frame flips on its own (staggered per card, held on hover, still when off-screen or under reduced motion), and carousel tabs across the top show progress and jump to a frame. Clicking opens the expanded view on the frame on show.
- Expanded view for packs: glass arrows at the stage edges, a filmstrip of the pack's frames with a `Pack 02 / 05 · N prompt variations` line, ←/→ walking the pack before the next card (and never while typing), swipes on mobile doing the same. Every field and action (description, tags, star, public, filing, delete, download) now applies to the frame on show, not the cover.

### 2026-08-14
- Collection-aware asset typing removes duplicate classification controls across the app and extension: Characters, Locations, and Scenes/Stills destinations now supply their canonical type automatically during uploads, shortcuts, moves, copies, and drag filing, while general collections retain the manual choice.
- Midjourney job-page Add now uploads the verified original PNG directly from the extension service worker to R2, then sends only its key and metadata through Next.js/Convex; multi-megabyte originals no longer fail at Vercel's request-body limit.
- Midjourney Add now dispatches non-blockingly: the current image and Add settings are snapshotted, the button releases immediately, and original-PNG capture/save finishes with an in-page result toast while the user moves to the next image.
- Add mode now carries two explicit, remembered classification axes—asset tag (`Character`, `Location`, `Scene`) and style tag (`Animation`, `Live action`, `Other`)—alongside freeform descriptive tags; the same combined tags apply to Midjourney Add, the keyboard shortcut, and local batches.

### 2026-08-13
- Browser extension v0.10 now has focused Add to gallery and Bookmark modes in the persistent Chrome side panel. Add mode accepts local image/video files or recursively dropped folders, uses one optional collection plus freeform descriptive tags (without duplicating collection pillars as tags), and exposes the selected Midjourney job image through a one-click Add card.
- Midjourney job-page Add resolves the selected job/index to the canonical CDN PNG and verifies its PNG signature before saving; a missing original aborts instead of silently re-encoding the compressed WebP preview.
- The extension's `Command+Shift+L` (`Ctrl+Shift+L` elsewhere) command adds the active Midjourney job image with Add mode's remembered collection and descriptive tags, with in-page success/error feedback.
- Midjourney prompt packs (28 Oct 2026): a quiet bar next to the moodboard dock on the Imagine page inserts short Dear Annete phrases into the prompt box. Phrases live in `extension/prompt-packs-data.js`; insert/remove logic is `togglePack` in `extension/prompt-packs.js`. A click inserts at the cursor (Cursor mode), or in front of / behind the user's words (Before / After); clicking the same pack removes it; `--profile`, `--ar` and every other flag stay untouched.
- Local extension uploads stream directly to R2 with previews, content hashes, per-item progress, duplicate-aware results, and retryable save failures instead of sending large media through the Next.js route; repeated assets update tag/collection organization on the original row

### 2026-08-12
- Parent collection views now offer `Expand all` / `Show folders`, letting the owner switch between child stack cards and the collection's complete flat asset view
- Parent collection views now expose an inline `New folder` action for arbitrary user-defined child folders alongside Characters, Locations, Scenes, and Inspirations

### 2026-07-27
- Standardized nested collection pillars now render in the fixed order `Characters` → `Locations` → `Scenes` → `Inspirations`; categorized members collapse behind their stack cards in an unfiltered parent view
- Dear Annete was visually audited and organized across the four child pillars (69 characters, 32 locations, 37 scenes, 81 inspirations), with Midjourney personalization/profile references routed to Inspirations
- Browser extension v0.6 adds a collection-pillar picker and creates/reuses the matching nested pillar while preserving the parent collection membership
- Nested plain collections now surface inside their parent as first-class visual gallery entries, with an owner-scoped indexed query, exact member counts, and preview stacks
- ORPHEUS was migrated to `Characters` (10 images) and `Locations` (16 images) child collections while retaining all storybook and project-direction memberships

### 2026-05-26
- Added multi-user agent token foundation: logged-in users can issue/revoke scoped gallery agent tokens, and agent calls derive `ownerUserId` server-side
- Added `/api/agent/*` routes for token-authenticated ingest, update/delete, and gallery reads without exposing Convex URL or owner env vars to agents
- Added `laniameda-gallery` stdio MCP server that talks to the app API with `LANIAMEDA_GALLERY_AGENT_TOKEN`
- Added token-authenticated `/api/agent/customize` and MCP tools for user pillars, user tag catalogs, and folders
- Documented local-only Claude/Codex MCP setup and added `check_connection` for local agent smoke tests
- Consolidated local MCP visual reference writes/reads around assets; UI/design references are now classified by tags instead of separate design-specific MCP tools

### 2026-05-08
- Custom user pillars/boards added via `userPillars`: default pillars still resolve virtually, and users can add boards such as `inspirations` without changing the existing asset APIs
- Dashboard filters and manual upload now read the user's dynamic pillar list instead of hard-coded tabs
- Browser extension image saves now open a pillar picker before saving, and the popup can fetch/create custom pillars while preserving the existing page bookmark flow

### 2026-05-08
- Image delivery moved to the existing R2 media path: new ingested images and generated thumbnails store `r2Key`/`thumbR2Key`, gallery hydration resolves R2 URLs first, and Convex storage remains a fallback for legacy rows
- Added image-aware R2 migration/cleanup support so older Convex image blobs can be copied to R2 before removing the Convex originals

### 2026-05-02
- Video/workflow saving finished end-to-end: video uploads/URLs store as `kind: "video"`, render in gallery cards/detail view, and can carry prompt/workflow metadata
- Generation lineage shipped for multi-stage workflows via `generationLineage` and ingest `upstreamInputs`, including owner checks, idempotent upserts, and cleanup on prompt/asset delete
- Upload and extension paths refreshed for workflow metadata, Midjourney prompt capture, and canonical gallery extension settings

### 2026-04-02
- Gallery packs promoted to a first-class dashboard card concept: pack members now collapse into one card with hover preview cycling and detail-panel carousel support
- Prompt-linked multi-asset records now auto-sync into `assetPacks` at the mutation layer, so create/update/delete flows keep pack membership and cover state consistent
- Added a backend consolidation path for legacy prompt groups via `assetPacks:consolidateOwnerPromptPacks`

### 2026-03-17
- Private gallery data access moved behind Next.js API routes so the browser no longer needs direct private Convex calls
- Auth path cleaned up to Telegram-only runtime flow; dead WorkOS and AN route surface removed from the app
- Env/docs/scripts refreshed to match the actual deployment contract, including `bun run typecheck`, stricter prod env checks, and server-side Convex access
- Prompt-only workflows shipped: the dashboard now has a text-only prompt view, and prompt-only ingest requires explicit `allowPromptOnly` opt-in across maintained ingest paths

### 2026-03-13
- Historical: separate ingest skill was introduced, then merged into the current skills/laniameda-gallery master Skill.
- Skill contract docs now live with the project and are intended to ship in lockstep with ingest schema changes
- Explicit ingest management contract added: `update` + `delete` actions/routes for prompts, assets, and design inspirations, plus skill support for all three operations

### 2026-03-07
- Telegram integration split: dedicated login token (`TELEGRAM_LOGIN_BOT_TOKEN`) and dedicated Convex notification token (`TELEGRAM_NOTIFY_BOT_TOKEN`) with legacy fallback support
- Removed obsolete Next.js Telegram webhook route and webhook setup script; ingest remains OpenClaw -> Convex
- Env/docs refresh for two-bot architecture and production setup

### 2026-03-04
- Iteration hardening phase 1: authz canonicalization, design token enforcement, shared UI primitives, and gallery query N+1 reduction
- Product management docs for iteration hardening: scorecard + now/next/later roadmap
- Gallery interaction reliability pass: scope-safe folder filtering (`mine` only), stale folder filter normalization, and selected-detail reset on scope switch

### 2026-03-03
- Folders backend v1 — owner-scoped folder model (create/list/update/delete), cross-user folder guardrails, and asset folder assignment mutation
- Folder lifecycle cleanup — deleting a folder now clears linked `folderId` on owner prompts/assets
- Backend test harness for Convex handlers + folder lifecycle permission tests
- Feature docs added: `agent-docs/features/folders/PRD.md` and `agent-docs/features/folders/TICKET.md`

### 2026-03-01
- Image focus mode (IFM Phase 1) — tabbed detail panel (Prompt/Details/Actions), mobile bottom sheet, keyboard nav, swipe gesture hook, state contract
- Gallery redesign — warm editorial theme, pillar-aware accent colors, CSS animation system
- Backend: hidden ingest tool + Telegram streaming pipeline
- Dev Telegram simulator + structured observability (`runs`, `run_events`, `run_artifacts` tables)
- AI workspace panel + run contract system

### 2026-02
- 4-pillar system (`creators` | `cars` | `designs` | `dump`) — schema field, query filter, upload selector, TopFilterBar tabs
- Model name (`modelName`) field on assets — tagged on ingest, filter chips in TopFilterBar
- Gallery dashboard — masonry grid, Convex-backed assets/tags/search (no mock data)
- Detail modal — progressive thumbnail → full-res load
- Upload panel — drag-drop, URL, prompt, tags, folder, model metadata
- Image thumbnails auto-generated on ingest (Jimp, no native deps)
- Telegram auth routes (`/api/auth/telegram`, `/api/auth/me`, `/api/auth/logout`) + `TelegramAuthProvider`
- Guest-visible gallery; auth required only for protected actions

### Foundation
- Convex schema: `assets`, `prompts`, `tags`, `folders`, `runs`, `run_events`, `run_artifacts`, join tables
- Core Convex queries/mutations/actions for assets, prompts, tags, folders
- Ingestion action with idempotency key (`ingestKey`)
- `/api/ingest` route + ingest helpers
- Historical OpenClaw ingest integration now uses the master laniameda-gallery Skill.
- ESLint + Bun test baseline green (60 tests)

---

## 🔥 Active Sprint

Current work is selected by the user request and branch-local feature docs.
The dashboard-polish sprint file is historical; do not start its tickets without
checking current BACKLOG and authorization.

- 2026-10-08: Restored the gallery's main address as a login entry when signed
  out, including missing/expired sessions and Telegram callback errors. The
  public selected-work navigation now links visibly to **My gallery**. Returning
  from Telegram to the original signed-out tab refreshes the session and opens
  the gallery without a manual reload. Canonical-host redirects and signed
  session renewal remain in place.

- 2026-10-08: Gallery pagination holds older Skills behind the loaded asset
  frontier and preserves exposed tile order as batches arrive. Page prefetching
  no longer waits for every local tile to mount. Gallery, pack and Motion video
  previews use delayed horizontal frame scrubbing with bounded seeking instead
  of hover autoplay; idle poster cards do not request videos by default. Browser
  fixtures verify row stability, view resets, cursor seeking, swept-hover gating
  and cancellation on scroll.

- 2026-10-08: Batch **Delete selected** is implemented in the owner gallery toolbar,
  using the existing authenticated asset-delete endpoint. Confirmation snapshots
  the selected IDs; progress locks other bulk actions; successful deletions leave
  the grid and failures stay selected for retry. The mobile toolbar uses the screen
  width instead of reserving space for the hidden sidebar. Local browser checks cover
  cancellation, mixed results, retry and mobile visibility with intercepted
  DELETE requests; these checks do not delete real gallery assets.

---

## Quality Gates

```bash
bun run lint   # must be clean
bun test       # all tests passing
```

## Decide is one flow; Feedback from any page (3 Nov 2026)

Michael: Tasks was full of "accept it?" confirmations, the Decisions screen
felt outside the gallery, a card said "136 frames" but showed three, the
"Stack decided" page meant nothing, and he wants to leave feedback for the
agent from anywhere.

- /tasks Decide holds only questions (blocked tasks with an ask). Done tasks
  leave the wall (`listTaskCards` skips them unless `includeDone`, used for a
  newspaper `?task=` link); the newspaper is where finished work is read.
- One pass: the last question answered opens the next Decisions pile; a pile's
  last answer opens the next pile, then the questions, then the gallery
  (`Onward` in `components/inbox/stack-screen.tsx`). The "Stack decided"
  summary is gone; a fully answered pile opens on its cards to change them.
  The back arrow goes to the world in the gallery.
- Cards take `group` (`assetIds` 1–24, `total`, `label`): the pictures a
  question is about, shown as a strip above the options. Choose cards show
  each option's `labels` entry.
- `components/feedback/feedback-button.tsx`, mounted in the root layout:
  a Feedback pill (and the ` key) on every page for the signed-in owner files a
  task with `source: "feedback"`, the page URL, the open asset or pile linked.
- Skill 1.27.0: inbox.md (group rule, one-pass flow), tasks.md (feedback
  tasks, no progress-only blocks), data-model.md.

## The world page is a pitch (5 Nov 2026)

/w/<slug> for visitors is now a cinematic pitch made only of the world's
pictures (`components/world-page`, `convex/worldPage.ts`).

- Hero: the world's reel full-bleed, poster first, film attached after the
  page settles (later on phones, never on Save-Data or 2g/3g), paused off
  screen, sound toggle. Source: `worldPage.heroReelAssetId`, else the newest
  member tagged `showreel`, else a featured video. DEAR ANNETE has a drawn
  wordmark (Bodoni Moda outlines, crossbar-less A with a lozenge; pure SVG).
- Live action / 3D switch (`worldPage.sides`, the root plus universe siblings)
  and All / Characters / Scenes / Locations tabs switch in place; the URL
  follows (`?side=3d&view=characters`). Other sides subscribe on idle.
- Grid: windowed masonry (only frames near the screen mount), 1 / 2 / 3 / 4
  columns, a full-width 2.39:1 band every ~9 frames, featured frames first,
  then `leadAssetIds`, then newest. Takes of one job sit apart. Lightbox is
  code-split, full screen, phones get the 1440 rendition.
- Data: `worldPage.allMembers` shows every member not `worldPageHidden`;
  reference and inspiration pieces never show. DEAR ANNETE exclusions are data
  (duplicate takes, off-world, artifacts, the rejected reel).
- Owner: F features, D archives on the hovered frame, here (`?public=1`) and
  in the vault (`lib/asset-hotkeys.ts`). proxy.ts sends a signed-in owner's
  /w/<slug> to the vault at the same address (`/w/<slug>/owner-view`).
- "Taste profile" in the vault is now "Public / Worlds"; /worlds opens it.

## World page v6: hero inserts, a level wall, an admin view (6 Nov 2026)

Michael approved the DEAR ANNETE v6 prototype layout
(dear-annete-pitch/v6): full-screen hero, one scroll, a sticky filter bar, a
big wall cut by full-screen hero inserts. Built into /w/<slug>.

- Hero inserts are data: `folders.worldPage.heroInserts` (`[{assetIds}]`,
  1–3 frames: full, split, triptych). The first opens the page (wordmark and
  the world's line over it), the rest cut into the wall every ~18 frames
  (10 on phones), pinned for 1.4 screens with a slow pull-back. Empty = the
  old reel hero. Hero frames leave the public wall; owner views keep them
  there with a HERO chip.
- H on a hovered frame (vault grid, world page, admin) toggles it as a hero
  of its world; Shift+H pairs it into the previous insert.
  `worldPage:setHeroInsert`, `worldPage:listHeroAssetIds`.
- /w/<slug>/admin (owner only, 404 otherwise): the same page with every
  member; private, dropped and letterboxed frames marked. Keys: F feature, H
  hero, C comment (inline composer, an `assetComments` row and its task),
  2 drop (`worldPageHidden`), D delete (ten-minute undo), O open. Key hint
  pinned at the bottom.
- The wall (`components/world-page/wall-layout.ts`) packs columns from known
  aspect ratios, lays the last two rows tallest-first and lets each chunk end
  move by up to two frames to find the levellest cut, then stretches short
  columns' last frames (cover, ≤35%, ≤60% to close a small remainder). Any gap
  left gets a filler: a slow drifting detail of the neighbouring frame. No
  holes above an insert or at the end.
- Clips play muted in view on every device (two at once on phones, eight on
  desktop), posters only on Save-Data or 2g/3g.
- Frames tagged `letterboxed` stay off the public page.
- Type and colour sit in `world-brand.ts` (Cormorant Unicase, the stamen
  wordmark, the tagline) and the token block at the top of `world-pitch.css`,
  ready for the coming type treatment. "The archive" is a quiet text link
  with a hairline glyph that fades once past the hero.
- Skill 1.30.0: data-model.md (heroInserts, setHeroInsert, admin reads,
  letterboxed, H/2/O keys).

## Hero frames in 4K, films never cropped (6 Nov 2026)

- A still promoted to hero gets `assets.heroRendition`: Topaz Standard V2 at
  5120 wide plus a 2560 step, JPEG in R2. The hero insert's srcset offers
  them, so large and retina screens get 4K and phones keep the ≤1440 thumbs.
  `worldPage.setHeroInsert` schedules `heroRendition.upscale`, which runs only
  when the deployment has `TOPAZ_API_KEY` (not set yet); meanwhile
  `scripts/upscale-hero.ts` does it with the local keys (a key out of credit
  is skipped).
- Michael: a 16:9 film is never cropped. A film insert plays whole, full
  width at its own aspect (no pin, no push, contain); splits and triptychs
  take stills only (Shift+H on a film adds it alone; a stored group with a
  film is played apart); the wall never stretches a film tile, a filler
  closes its column instead.

## Midjourney prompt queue (6 Nov 2026, branch `feat/mj-prompt-queue`)

Michael: "a queue of prompts … all predefined, all refs set, so that I can only
review and click send." Agents prepare; he sends, one job per click.

- Table `mjQueueItems` (`convex/mjQueue.ts`, validators `mjQueueValidators.ts`):
  batch label + order, prose, image prompts, style refs, omni/character ref,
  profile codes, params, note, status queued → injected → sent (or skipped),
  sentCommand, jobId, ingestKey. `asset:<id>` references resolve to public R2
  URLs and thumbnails when queued.
- Command composer `lib/mj-queue.ts` with a line-for-line twin in
  `extension/mj-queue-compose.js` (parity test). V8.2 has no `--oref`/`--cref`
  (Edit model): added only when params pin `--v 7` / `--v 6`, else a warning.
  `--draft` and `--relax` are valid V8.2 prompt params.
- Agents: `/api/agent/mj-queue` (list, queue, update) and MCP
  `queue_mj_prompts`, `list_mj_queue`, `update_mj_queue_item`. Extension:
  `/api/extension/mj-queue` (GET list, POST update).
- Extension 0.19.0: QUEUE pill + panel on midjourney.com (`mj-queue.js`,
  `mj-queue.css`). Inject, read-back (AS QUEUED / EDITED), Send = one Enter on
  his trusted click, or his own Enter in the bar; Edit/Skip/Restore/↑; Next →
  and ⌥⇧N; ⌥⇧Q toggles. Job id taken from the new feed row whose text carries
  the prompt's first words (page DOM only, no Midjourney API calls).
- Skill 1.33.0: references/mj-queue.md, data-model.md, SKILL.md row.
