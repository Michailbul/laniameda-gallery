# Query: browse, search, fetch, download


The read path for `laniameda.gallery`. For how to search for Michael's taste (tags, piece types, medium, liked and starred), start with the query recipes in `SKILL.md`.

It covers two read surfaces:

- asset-centric reads: browse assets, semantic search, fetch one asset, download media
- pack reads: fetch a saved asset pack and its member assets from a copied gallery ID

Counterpart to `references/ingest.md` (which writes).

## Runtime env

Prefer the available hosted Gallery MCP. A local stdio client uses:

- `LANIAMEDA_GALLERY_API_URL`
- `LANIAMEDA_GALLERY_AGENT_TOKEN`

When MCP tools are available, use:

- `list_assets`, `search_gallery`, `get_gallery_item`
- `list_tags`, `list_collections` for the authenticated user's taxonomy

Collections are owner-scoped groupings (the `folders` table; "collection" is the product-facing name). Filter `list_assets` / `search_gallery` to one by passing its `folderId` (`scope: "mine"` only).

The script below is direct-Convex access for this local single-owner workspace
and admin migrations when MCP is unavailable:

- `CONVEX_URL` or `NEXT_PUBLIC_CONVEX_URL` — required
- `KB_OWNER_USER_ID` and `CONVEX_AUTH_PRIVATE_KEY` — required for signed owner-scoped reads (`scope: "mine"`)

Best practice:

- do not use `KB_OWNER_USER_ID` for multi-user agents
- do not hardcode Michael's Telegram ID into wrappers or prompts
- use `scope: "public"` only for public asset discovery

## Script

```bash
cd ~/work/laniameda/laniameda.gallery
bun run skills/laniameda-gallery/scripts/query.ts '<JSON>'
```

## Actions

### `list`

Browse assets with structured filters.

Supported filters:

- `scope`: `mine` or `public` (`mine` default)
- `kind`
- `modelName`
- `folderId` (`mine` only)
- `assetRole`
- `search` (text filter on hydrated asset content)
- `limit`

Example:

```json
{
  "action": "list",
  "scope": "mine",  "assetRole": "reference",
  "folderId": "<raw-folder-id>",
  "limit": 10
}
```

### `search`

Semantic asset search via `semanticSearch:searchAssets`.

Supported filters:

- `scope`
- `query`
- `kind`
- `modelName`
- `folderId` (`mine` only)
- `assetRole`
- `limit`

Example:

```json
{
  "action": "search",
  "query": "dark moody editorial portrait with film grain",
  "scope": "mine",  "assetRole": "generated_output",
  "limit": 5
}
```

### Filters shared by `list`, `search`, `similar` and `refs`

| Field | Meaning |
|---|---|
| `tagNames` | every tag must be present |
| `anyTagNames` | at least one must be present |
| `excludeTagNames` | none may be present |
| `pieceType` | `character` / `location` / `scene` / `inspiration` (plural and `still` spellings count) |
| `medium` | `animation` (tagged animation) or `live-action` (everything else) |
| `onlyLiked` | `isLiked` pieces only |
| `onlyStarred` | starred pieces; Michael's curator stars are public/featured |
| `folderId` | one collection; `list` also takes `includeDescendants` |

Tag names match canonically: case, `-`, `_` and punctuation fold, plurals
don't (except piece types). On `list`, a `tagNames` entry that isn't a tag at
all returns nothing.

### `search` modes

`mode`: `hybrid` (default) runs the pixel lane and the text lane with a query
embedding from each lane's model and merges them by rank; `visual` is pixels only (looks alike);
`text` is words only (agent description, caption, prompt, tags, source).
Without filters each lane keeps results close to its best match (pixels
within 85%, words within 75%); with filters the cutoff is off so the best
in-filter matches come back. Override with `minRelativeScore` (0–1).

Videos have no pixels, so they live in the text lane only and rank by their
words; a video at the top of the text lane scores 1, the same as an image at
the top of both lanes. `mode: "visual"` therefore returns images only. To
look at videos, pass `kind: "video"`.

### `similar`

More like one asset. `mode` defaults to `visual`; `hybrid` also weighs what the
pieces are about.

```json
{ "action": "similar", "assetId": "asset:abc123", "medium": "animation", "limit": 8 }
```

### `refs`

Search (with `query`) or list (without), download each match and write
`refs.json` and `refs.md` into `outDir` (default
`/tmp/laniameda-gallery/refs/<query-slug>`). `download: false` skips the bytes.

```json
{ "action": "refs", "query": "rainy neon alley at night", "pieceType": "location", "limit": 6, "outDir": "<scratchpad>/refs" }
```

### `preview`

Look before you pick. Search (with `query`), list (filters only) or take
explicit `ids`, then have the gallery compose the hits into numbered
contact-sheet JPEGs (thumbs, not originals) and write them to `outDir`
(default `/tmp/laniameda-gallery/previews/<query-slug>`). Open each
`sheets[].path` with your image reader: one read shows up to 48 pieces.

- Cells are numbered left to right, top to bottom, and the numbers restart on
  every sheet. `sheets[].cells[]` maps each number to its `asset:<id>`,
  `kind`, size, `score` (search only), tags and `agentDescription`.
- A ▶ badge is a video; the cell shows its poster frame. A crossed-out cell
  has no preview (`previewError` says why, e.g. a video with no poster).
- `limit`: default 24, max 96. `perSheet`: default 24, max 48. A sheet's long
  edge stays at 1568px (`maxEdge` up to 2400), so 24 per sheet keeps cells
  around 250px; drop to 6–12 per sheet when details matter.
- `ids` with 1–4 assets renders them large, for a closer look at a shortlist.
- Takes the same filters as `search` / `list`, plus `columns`.

```json
{ "action": "preview", "query": "rainy neon alley at night", "pieceType": "location", "limit": 24, "outDir": "<scratchpad>/previews" }
```

```json
{ "action": "preview", "ids": ["asset:abc123", "asset:def456"], "outDir": "<scratchpad>/previews" }
```

### `sources`

Which source URLs are already saved. Run it before an extraction pass.

```json
{ "action": "sources", "sourceUrls": ["https://x.com/a/status/1", "https://x.com/a/status/2"] }
```

Returns `alreadySaved`, `saved` (with asset IDs) and `notSaved`.

### `tags`

The tag vocabulary, most used first, with aliases. `search` narrows by name.

```json
{ "action": "tags", "search": "light" }
```

### `get`

Fetch one owner-scoped asset with hydrated prompt/tag metadata.

```json
{
  "action": "get",
  "assetId": "asset:abc123"
}
```

Raw Convex asset IDs are also accepted for `assetId`, but copied gallery IDs use the typed `asset:<id>` form.

### `getPack`

Fetch one owner-scoped asset pack and its hydrated member assets.

```json
{
  "action": "getPack",
  "packId": "pack:abc123"
}
```

### `getById`

Resolve a copied gallery ID without first deciding which table to query.

Supported copied ID formats:

- `asset:<id>`
- `pack:<id>`

These tokens are produced by the gallery UI when the user clicks:

- The corner copy button on any asset card (hover on desktop)
- The persistent `asset:<id>` chip in the detail panel metadata strip
- "Copy asset / pack ID" items inside the detail panel Copy dropdown

Accept the pasted token verbatim — do not strip the prefix. Raw Convex IDs are also accepted, but the typed form lets the skill resolve the correct table automatically.

Example:

```json
{
  "action": "getById",
  "id": "pack:abc123"
}
```

### `download`

Download one owner-scoped asset to local disk.

```json
{
  "action": "download",
  "assetId": "asset:abc123",
  "outDir": "/tmp/laniameda-gallery"
}
```

### Skills: `searchSkills`, `skills`, `getSkill`

Skills (text knowledge with optional ordered prompt/media steps, table `skills`) are searched on their own, not
through `search`. Each is embedded on its words: title, description, tags,
models, step labels and markdown body.

```json
{ "action": "searchSkills", "query": "composition-first seedance control", "tagNames": ["seedance"], "limit": 5 }
```

```json
{ "action": "skills", "tagNames": ["cinematography"], "folderId": "<folderId>", "search": "dolly" }
```

```json
{ "action": "getSkill", "id": "skill:<id>" }
```

`searchSkills` ranks by meaning, then appends keyword matches the embedding
missed. `skills` lists newest first; every `tagNames` entry must match
(canonically). `getSkill` returns the full document: `body` (markdown),
`agentInstructions`, `tagNames`, `collections`, `modelNames` and every step
with its prompt sections and media URLs. `getById` accepts `skill:<id>` and the
old `workflow:<id>` and retired pack IDs through owner aliases. New copies use `skill:<native-id>`.

Packs tagged `cinematography` (camera moves, own tab) are left out of both lists
unless `tagNames` includes `cinematography`; see `references/cinematography.md`.

### Video references: `scripts/video-refs.ts`

YouTube videos saved as research live in their own table and are not returned
by `list` or `search`. Query them with the MCP tool `list_video_refs` or:

```json
{"action":"list","collection":"youtube-cars-competitors","sort":"views","limit":20}
```

Filters, sorting and fields: `references/video-refs.md`.

## Typical workflows

### Pick references by eye

1. `preview` with the brief as `query` (wide net: `limit` 24–48)
2. Read the sheet(s); shortlist by number and map numbers to `asset:<id>`s
   with `sheets[].cells`
3. Optional: `preview` the shortlist `ids` for a larger look, or `similar` on
   the best pick and `preview` again
4. `getById` / `download` / `refs` only the chosen assets

### Find and reuse an image prompt

1. `search` to find the best asset
2. `download` to save the asset locally
3. use `savedPath` and `promptText` in the current task

### Resolve a copied gallery item

1. Use `getById` with the exact copied ID from the gallery UI
2. If the ID starts with `pack:`, inspect the returned `assets` array and choose the needed member asset
3. If media bytes are needed, run `download` with the chosen `asset:<id>`

### Find a saved UI/design reference

1. `search` for the visual/content cue and filter with tags such as `design`, `ui`, `website`, `component`, or `reference`
2. `getById` to inspect the chosen asset or pack

## Response highlights

Asset actions return compact asset objects with fields like:

- `id`
- `kind`
- `agentDescription` / `agentDescriptionSource` (`agent` or `auto`) — read this first
- `description` (Michael's caption)
- `folderIds`, `isLiked`, `starred`
- `score`, `visualScore`, `textScore` (search and similar)
- `pillar`
- `modelName`
- `promptText`
- `tagNames`
- `url`
- `thumbUrl`
- `folderId`
- `assetRole`
- `assetPackId`
- `packSlotIndex`
- `score` (semantic search only)

Pack actions return:

- `pack.id`
- `pack.title`
- `pack.description`
- `pack.pillar`
- `pack.modelName`
- `pack.coverAssetId`
- `pack.itemCount`
- `assets` hydrated like asset results

Design actions return compact design objects with fields like:

- `id`
- `title`
- `summary`
- `sourceUrl`
- `sourceTitle`
- `userNote`
- `inspirationType`
- `platform`
- `workflowType`
- `captureKind`
- `saveIntent`
- `templateKey`
- `sourceFingerprint`
- `previewUrl`
- `previewThumbUrl`
- `assetId`
- `promptId`

## Notes

- Semantic asset search requires `SEMANTIC_EMBEDDINGS_ENABLED=true` on the Convex deployment.
- The embedding model in this repo is `gemini-embedding-2-preview`.
- `download` saves raw bytes; video assets are not transcoded.
- Convex storage URLs are temporary. Download promptly after retrieval.

## Semantic search

Assets use separate pixel and text embeddings. The pixel lane uses image bytes
with Gemini multimodal embeddings; the text lane uses agent descriptions,
captions, prompts, tags and source metadata with its own text model. Hybrid
search merges both lanes and applies the requested filters. A missing pixel
embedding does not prevent text search. See `references/data-model.md` for
model names and `references/maintenance.md` for paced backfill commands.


## Complete inventories and the importable client

list_assets is bounded. For an audit use list_assets_page with pageSize (1–200),
its opaque cursor and the desired filters. Continue until isDone: true. Each page
returns assets, cursor, isDone, scannedCount and order; an empty matching page
can still have a continuation. Keep the same filters while following a cursor.
Use includeDescendants when reading an organized world root. Do not infer totals
from the first page or call a capped read a complete export.

The dependency-free scripts/gallery-client.mjs exports createGalleryClient. Its
assets.pages()/assets.all() helpers follow the complete surface; gallery.mjs
all_assets writes the collected inventory with completion metadata. Read
references/web-access.md for current usage and schema discovery.

The cursor order is owner-candidate-createdAt-desc, not a global chronological
merge. Default inventory includes hidden collection members but not Skill
step media, which belongs to its Skill. includeSkillExamples:true adds those
step assets; assetRole can explicitly select them. Semantic search follows the
same rule. Only immediate child collections are included by
includeDescendants. YouTube research has its own list_video_refs_page cursor surface. Ranked
list_video_refs still caps at 2000; Skill/Story/bookmark lists cap at 200/500/500.
Complete asset pagination does not make those other bounded lists complete. list_menu_filters returns the owner-curated IDs/labels/resolved tags
and counts used by filter presets. Discover strict schemas: misspelled filters
and owner override fields are rejected rather than silently ignored.

Complete inventory helpers start at the beginning and reject a supplied starting
cursor: a suffix traversal cannot claim complete:true. Use page/pages with a
cursor to resume a suffix explicitly. Budget exhaustion or a repeated cursor
throws an incomplete error rather than returning a false complete result.
