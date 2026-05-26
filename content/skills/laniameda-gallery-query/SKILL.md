---
name: laniameda-gallery-query
description: >-
  Query a laniameda.gallery vault to browse, search, retrieve, and download
  content. Use when an agent needs to find assets, prompts, or design
  references in the user's gallery and pull them into the current task.
---

# laniameda-gallery-query

Use this skill to read from a laniameda.gallery deployment via its HTTP query API.

It covers three read surfaces:

- asset reads: browse assets, semantic search, fetch one asset, download media
- pack reads: fetch a saved asset pack and its member assets
- designs reads: browse structured design inspirations and inspect one design with its linked preview asset

Counterpart to `laniameda-gallery-ingest` (which writes).

> **Skill status:** preview. The gallery exposes per-resource HTTP endpoints (`/api/gallery/assets`, `/api/gallery/prompts`, `/api/gallery/designs`) for authenticated browser sessions today; a unified `/api/query` action surface is on the roadmap. Programmatic API tokens for headless agents are also on the roadmap. Until then, query from an agent running in a context that already holds the gallery session cookie.

## Runtime env

- `LANIAMEDA_GALLERY_URL` — base URL of the target gallery (no trailing slash).
- `LANIAMEDA_AUTH_COOKIE` — gallery session cookie for the calling user; sent as the `Cookie` header.

Ownership is derived server-side from the session — the skill never hardcodes user IDs.

## Endpoint

```
POST {LANIAMEDA_GALLERY_URL}/api/query
Content-Type: application/json
Cookie: {LANIAMEDA_AUTH_COOKIE}
```

Body is a single action payload (one of the shapes below).

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

Semantic asset search.

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

Raw Convex asset IDs are also accepted, but copied gallery IDs use the typed `asset:<id>` form.

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

- Semantic asset search requires the gallery's embedding pipeline to be enabled server-side.
- Media URLs returned by `get`/`getPack`/`getDesign` may be short-lived signed URLs. Download promptly after retrieval.
- `download` saves raw bytes; video assets are not transcoded.
