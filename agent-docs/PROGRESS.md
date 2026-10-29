# Progress

> What's been built. For all pending/future work see `agent-docs/BACKLOG.md`.

Last updated: 2026-10-28

---

## ✔ Shipped

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
- Worlds are marked roots (`folders.worldKey`); 12 marked. Convex refuses any
  write that puts an asset, board item, character link or new story link into
  a second world; shelves cannot move across worlds. Storybooks are children of
  their world (group Storybooks); 17 root storybooks moved in.
- World files (`worldDocs`): WORLD.md / LEARNINGS.md / docs/*.md with caps.
  Seeded for all 12 worlds; the private worlds.md shrank from 42k to 12.5k
  (gallery-wide rules only). Backup and migration log are private, outside the repo.
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
- Prompt families: the grid folds the same prompt saved as separate rows, and variations of one prompt (e.g. a Masa template with the spoken line rewritten), into one pack. Rules live in `lib/prompt-family.ts` (content-word similarity, generation params ignored, variations within 3 days, identical text at any distance); web bookmarks and cinema frames never fold.
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
