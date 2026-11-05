# Collection moodboards and collection groups · spec (19 Oct 2026)

Michael (19 Oct): "We should have the moodboards panel in collection to be able to create moodboards in there and
then transfer it to Midjourney. Preview those moodboards. Add assets to moodboards." And: make the DEAR ANNETE
collection super organized, agents first, folders and groups. This branch (`feat/collection-moodboards`, cut from
origin/main 7bfb917) adds two things: Moodboards (a new native object scoped to a collection) and Groups for child
collections. Everything is additive: no existing table, field, route or tool changes behaviour.

The real-gallery Convex deployment (`dev:perfect-buffalo-375`) is production. Do not publish from this branch;
the orchestrating agent reviews the schema diff and publishes. Do not run `npx convex deploy` or the `--once`
wrapper. Local `.env.local` points at live data: no writes to live data while building.

## 1. Moodboards

A moodboard is an ordered set of gallery assets that defines one look, mirrored to a Midjourney moodboard
(personalization code). It belongs to one owned plain collection (a world root or one of its children).

### Schema (convex/schema.ts)

```ts
moodboards: defineTable({
  ownerUserId: v.string(),
  folderId: v.id("folders"),            // owning collection: plain root or plain child, never a storybook
  name: v.string(),                      // e.g. "DA FILM · Golden"
  normalizedName: v.string(),            // unique per (owner, folder)
  description: v.optional(v.string()),   // what the board carries and when to use it (≤ 2000)
  styleTag: v.optional(v.string()),      // lowercase hyphenated style key, e.g. "da-film"
  status: moodboardStatusValidator,      // "draft" | "in-midjourney" | "archived"
  mjCode: v.optional(v.string()),        // short personalization code, e.g. "88ji6bg" (string, keep as given)
  mjMoodboardId: v.optional(v.string()), // Midjourney moodboard id, e.g. "7510337594627371941" (use --profile m<id>)
  mjUrl: v.optional(v.string()),
  mjSyncedAt: v.optional(v.number()),
  mjSyncedItemCount: v.optional(v.number()),
  mjCodeHistory: v.optional(v.array(v.object({ code: v.string(), at: v.number(), note: v.optional(v.string()) }))),
  notes: v.optional(v.string()),         // agent/Michael notes: like rates, recipe partners ("+ DARI h2eu2z6")
  coverAssetId: v.optional(v.id("assets")),
  itemCount: v.number(),                 // kept exact by every item write and the asset delete cascade
  revision: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner_folder_normalizedName", ["ownerUserId", "folderId", "normalizedName"])
  .index("by_owner_updatedAt", ["ownerUserId", "updatedAt"])
  .index("by_owner_mjCode", ["ownerUserId", "mjCode"]),
moodboardItems: defineTable({
  ownerUserId: v.string(),
  moodboardId: v.id("moodboards"),
  assetId: v.id("assets"),
  position: v.number(),                  // ascending display order; append = last + 1
  note: v.optional(v.string()),
  addedAt: v.number(),
})
  .index("by_moodboard_position", ["moodboardId", "position"])
  .index("by_moodboard_asset", ["moodboardId", "assetId"])
  .index("by_asset", ["assetId"]),
```

### Backend (convex/moodboards.ts, validators in convex/moodboardValidators.ts)

Follow `convex/characters.ts` on origin/main: signed owner actor, return validators on every function,
ConvexError for user-facing errors, indexed reads only, idempotent mutations.

- `listMoodboards({ folderId?, includeChildren?, status? })`: boards of a collection; for a root with
  `includeChildren`, also its children's boards. Each row: board fields + `folderName` + up to 6 preview items
  (`assetId`, `thumbUrl`, `url`, `width`, `height`, `kind`). Archived excluded unless asked.
- `getMoodboard({ moodboardId })`: board + every item in position order with asset summaries
  (`assetId`, `kind`, `url`, `thumbUrl`, `width`, `height`, `promptText` first 400 chars, `tagNames`,
  `agentDescription`). Missing/foreign assets are skipped and reported in `missingAssetIds`.
- `createMoodboard({ folderId, name, description?, styleTag?, mjCode?, mjMoodboardId?, mjUrl?, notes? })`:
  idempotent on (owner, folder, normalizedName): an existing board is returned with `created: false` and only
  empty fields are filled. Folder must be owned, plain (not a storybook).
- `updateMoodboard({ moodboardId, expectedRevision?, name?, description?, styleTag?, status?, coverAssetId?, notes?, folderId? })`:
  patch; `expectedRevision` mismatch rejects. Moving folders re-checks uniqueness. Cover must be an item.
- `addMoodboardItems({ moodboardId, assetIds (1–100), note? })`: append in the given order, skip assets already on
  the board (report them), assets must be owned. Updates `itemCount`, sets a cover when none.
- `removeMoodboardItems({ moodboardId, assetIds })`, `reorderMoodboardItems({ moodboardId, assetIds })`
  (full order of the current items; reject when the set differs).
- `setMoodboardMidjourney({ moodboardId, mjCode?, mjMoodboardId?, mjUrl?, syncedItemCount?, note? })`: records a
  sync. When `mjCode` changes, push the previous code onto `mjCodeHistory`. Sets `mjSyncedAt` now and status
  `in-midjourney`.
- `deleteMoodboard({ moodboardId })`: deletes the board and its items; assets untouched.
- `listMoodboardGenerations({ moodboardId, limit≤60 })`: when the board has `mjCode`, the owner's assets whose
  linked prompt text contains the code (prompts `search_text` index, then assets `by_owner_prompt_createdAt`),
  newest first. This is "made with this board".
- `listMoodboardsForAsset({ assetId })`: boards an asset is on (for the card menu tick marks).
- Cascades: deleting an asset removes its `moodboardItems` rows and fixes `itemCount`/`coverAssetId` (hook the
  same place the characterAssets cascade runs). Deleting a collection moves its boards to the parent collection;
  a root's boards are deleted with their items (assets stay). Add both to the existing delete paths.
- Limits: name ≤ 120, description ≤ 2000, notes ≤ 4000, styleTag `^[a-z0-9]+(-[a-z0-9]+)*$` ≤ 48,
  ≤ 1000 items per board, mjCode/mjMoodboardId ≤ 64 chars.

### Agent API and MCP

- `app/api/agent/moodboards/route.ts` (zod, like srefs/characters): actions `list`, `get`, `generations`
  (gallery:read); `save` (create or patch by `moodboardId`), `add`, `remove`, `reorder`, `set_midjourney`
  (gallery:write); `delete` (gallery:delete). Register in `lib/server/mcp-agent-routes.ts`.
- MCP tools in `mcp/laniameda-gallery/tools.ts`: `list_moodboards`, `get_moodboard`, `save_moodboard`,
  `add_moodboard_items`, `remove_moodboard_items`, `reorder_moodboard_items`, `set_moodboard_midjourney`,
  `list_moodboard_generations`, `delete_moodboard`. Descriptions written for agents: what a moodboard is, that
  `get_moodboard` returns full image URLs an agent can push into Midjourney, and how to record the code after.
  Asset ids accept `asset:<id>` or raw ids. Bump the contract version reported by `get_gallery_contract`.

## 2. Collection groups

Child collections get an optional display group so a world reads as Styles / Places / Cast / Design / Moods /
Footage instead of 30 alphabetical stacks.

- `folders.group: v.optional(v.string())` (≤ 40 chars, display text, e.g. "Styles") and
  `folders.sortOrder: v.optional(v.number())`. Only meaningful on children; accepted on roots and ignored there.
- `createFolder`/`updateFolder` accept both (`group: null` clears). The customize route, `create_collection` and
  `update_collection` MCP tools accept `group` and `sortOrder`; `list_collections` returns them. `update_collection`
  must not require resending the name just to change the group (keep the existing name when omitted, if that is
  backward compatible; otherwise document it).
- Ordering of `listChildCollectionEntries` (and anywhere children are listed): when any child has a group,
  groups appear in order of their smallest member `sortOrder` (then group name); inside a group by `sortOrder`
  then name; ungrouped children last, in today's order. With no groups, today's order is unchanged.

## 3. UI (components/gallery, dashboard)

Gallery UI language: dark default, `--lm-*` tokens, Geist Mono uppercase microcopy (10–11px, 0.1–0.14em),
Geist Sans titles, hard 2px radius, coral accent, lucide icons. No serif or italic display type. Match
`characters-view.tsx` and `midjourney-srefs-view.tsx`; reuse existing primitives.

- **Grouped child stacks.** On a root collection page, child collection stacks render under small group
  headings (uppercase mono, count). Ungrouped children follow under no heading, as today.
- **Moodboards toggle.** In the collection header actions (`CollectionViewActions` / breadcrumb trailing
  controls) a `Moodboards · N` button for any plain collection switches the main area to `MoodboardsView`
  scoped to that collection (a root includes its children's boards, grouped by child collection). Back returns
  to the grid. Keep the choice in component state like the other views.
- **MoodboardsView.** Board cards: a 2×2 cover mosaic of the first four items, name, code chip (`88ji6bg`),
  item count, status pill, style tag. `New moodboard`: name, description, style tag, owning collection (this
  one or a child). Empty state explains what a moodboard is in one line.
- **Moodboard detail.** Header: name, description, notes, owning collection; copy buttons for
  `--profile <code>` and `--profile m<id>`; `Open in Midjourney` when `mjUrl`; status; edit (name, description,
  style tag, notes, code/id/url); archive; delete with confirm. Items in a dense justified grid (existing layout
  helper), hover to remove, drag to reorder (or move left/right buttons if drag is too costly), click opens the
  normal asset detail. Section "Made with this board" from `listMoodboardGenerations` when a code is set.
- **Send to Midjourney.** A `Send to Midjourney` menu: `Download images` (zip of the original files through the
  same-origin download route, JSZip as in the Skill export), `Copy image links` (one URL per line), and
  `Copy agent request` (a one-paragraph request naming the board id, for an agent with Midjourney access to create
  or update the Midjourney moodboard through `get_moodboard` and record the code with
  `set_moodboard_midjourney`). Show sync state: "In Midjourney as 88ji6bg · synced 19 Oct · 3 images added since".
- **Add to moodboard.** In the image card menu and the multi-select actions: `Add to moodboard…` opens a picker of
  boards (current collection's boards first, then all, search) with tick marks from `listMoodboardsForAsset`, plus
  `New moodboard` inline. Toast on success.

## 4. Docs, tests, version

- New public reference `skills/laniameda-gallery/references/moodboards.md`: the object, tools, the
  Midjourney sync procedure (Comet/web-app API: `POST /api/moodboards {session_id,title}`, `PATCH
  /api/moodboards?moodboard_id=<id> {session_id, add:[{url,width,height}]}`, public images via
  `POST /api/storage-upload-link {url}`, code freezes on first job; `--profile m<id>` resolves to it), and
  readback rules. Update `SKILL.md` (object table), `references/data-model.md` (tables, folder group/sortOrder),
  `references/midjourney-srefs.md` (cross-reference), the manifest/resource list in
  `lib/server/gallery-skill-resources.ts`, and bump the skill version to 1.11.0.
- `agent-docs/PROGRESS.md` entry and `agent-docs/features/collection-moodboards/README.md` (what shipped).
- Tests (bun:test, `tests/helpers/mock-convex-context`): moodboards backend (create idempotency, add/skip
  duplicates, reorder validation, remove, set_midjourney history, asset-delete cascade, folder-delete move),
  folder group ordering, MCP contract (tool list and schemas), skill discovery (new resource). Keep existing
  tests green.
- Gates before handing back: `bun run lint`, `bun run typecheck`, `bun test`, `bun run build` all pass.
