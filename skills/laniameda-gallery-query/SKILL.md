---
name: laniameda-gallery-query
description: >-
  Query the laniameda-gallery to browse, search, retrieve, and download vault
  content. Use when an agent needs to find assets, prompts, or references in
  the gallery and pull them into the current task.
---

# laniameda-gallery-query

Use this skill to read from `laniameda.gallery`.

It covers two read surfaces:

- asset-centric reads: browse assets, semantic search, fetch one asset, download media
- pack reads: fetch a saved asset pack and its member assets from a copied gallery ID

Counterpart to `laniameda-gallery-ingest` (which writes).

## Runtime env

Local Claude/Codex agents should prefer `bun run mcp:gallery` with:

- `LANIAMEDA_GALLERY_API_URL`
- `LANIAMEDA_GALLERY_AGENT_TOKEN`

When MCP tools are available, use:

- `list_assets`, `search_gallery`, `get_gallery_item`
- `list_tags`, `list_collections` for the authenticated user's taxonomy

Collections are owner-scoped groupings (the `folders` table; "collection" is the product-facing name). Filter `list_assets` / `search_gallery` to one by passing its `folderId` (`scope: "mine"` only).

The script below is legacy direct-Convex access for admin migration workflows:

- `CONVEX_URL` or `NEXT_PUBLIC_CONVEX_URL` — required
- `KB_OWNER_USER_ID` — required for owner-scoped reads (`scope: "mine"`)

Best practice:

- do not use `KB_OWNER_USER_ID` for multi-user agents
- do not hardcode Michael's Telegram ID into wrappers or prompts
- use `scope: "public"` only for public asset discovery

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
  "folderId": "folders:abc123",
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

## Typical workflows

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
