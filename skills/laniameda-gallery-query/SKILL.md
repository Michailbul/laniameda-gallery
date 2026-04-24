---
name: laniameda-gallery-query
description: >-
  Query the laniameda-gallery to browse, search, retrieve, and download vault
  content. Use when an agent needs to find assets, prompts, or structured
  designs-pillar references in the gallery and pull them into the current task.
---

# laniameda-gallery-query

Use this skill to read from `laniameda.gallery`.

It covers two read surfaces:

- asset-centric reads: browse assets, semantic search, fetch one asset, download media
- pack reads: fetch a saved asset pack and its member assets from a copied gallery ID
- designs-pillar reads: browse structured design inspirations and inspect one design entry with its linked preview asset

Counterpart to `laniameda-gallery-ingest` (which writes).

## Runtime env

- `CONVEX_URL` or `NEXT_PUBLIC_CONVEX_URL` — required
- `KB_OWNER_USER_ID` — required for owner-scoped reads (`scope: "mine"`) and all designs-pillar actions

Best practice:

- keep `KB_OWNER_USER_ID` env-driven
- do not hardcode Michael's Telegram ID into wrappers or prompts
- use `scope: "public"` only for public asset discovery; design inspiration reads are owner-scoped

## Script

```bash
cd ~/work/laniameda/laniameda.gallery
bun run skills/laniameda-gallery-query/scripts/query.ts '<JSON>'
```

## Actions

### `list`

Browse assets with structured filters.

Supported filters:

- `scope`: `mine` or `public` (`mine` default)
- `pillar`
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
  "scope": "mine",
  "pillar": "cars",
  "assetRole": "reference",
  "folderId": "folders:abc123",
  "limit": 10
}
```

### `search`

Semantic asset search via `semanticSearch:searchAssets`.

Supported filters:

- `scope`
- `query`
- `pillar`
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
  "scope": "mine",
  "pillar": "creators",
  "assetRole": "generated_output",
  "limit": 5
}
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
- `design:<id>`

These tokens are produced by the gallery UI when the user clicks:

- The corner copy button on any asset card (hover on desktop)
- The persistent `asset:<id>` chip in the detail panel metadata strip
- "Copy asset / design / pack ID" items inside the detail panel Copy dropdown

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

### `listDesigns`

Browse structured entries from the `designInspirations` pillar.

Supported filters:

- `inspirationType`
- `platform`
- `workflowType`
- `captureKind`
- `saveIntent`
- `folderId`
- `sourceDomain`
- `search`
- `dateFrom`
- `dateTo`
- `requireAsset`
- `limit`

Example:

```json
{
  "action": "listDesigns",
  "platform": "web",
  "captureKind": "website",
  "saveIntent": "inspiration",
  "search": "pricing",
  "requireAsset": true,
  "limit": 10
}
```

### `getDesign`

Fetch one owner-scoped design inspiration and, when present, hydrate its linked preview asset.

```json
{
  "action": "getDesign",
  "designInspirationId": "design:abc123"
}
```

## Typical workflows

### Find and reuse an image prompt

1. `search` to find the best asset
2. `download` to save the asset locally
3. use `savedPath` and `promptText` in the current task

### Resolve a copied gallery item

1. Use `getById` with the exact copied ID from the gallery UI
2. If the ID starts with `pack:`, inspect the returned `assets` array and choose the needed member asset
3. If media bytes are needed, run `download` with the chosen `asset:<id>`

### Find a saved design reference

1. `listDesigns` with `search`, `platform`, or `captureKind`
2. `getDesign` to inspect the full record and linked preview asset

## Response highlights

Asset actions return compact asset objects with fields like:

- `id`
- `kind`
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
