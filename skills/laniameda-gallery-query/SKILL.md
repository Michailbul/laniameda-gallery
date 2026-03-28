---
name: laniameda-gallery-query
description: >-
  Query the laniameda-gallery to browse, search, retrieve, and download assets
  with their prompts and images. Use when an agent needs to find gallery content,
  fetch an image to work with locally, or retrieve a prompt from the vault.
---

# laniameda-gallery-query

Use this skill to **read** from the laniameda.gallery vault. Browse by pillar, semantic search by natural language, retrieve a specific asset with its prompt, or download images to a local tmp folder.

Counterpart to `laniameda-gallery-ingest` (which writes).

## When to trigger

- "find me that car prompt", "get me the cinematic portrait", "show me what's in the gallery"
- "search the gallery for scroll animations"
- "download that image so I can work with it"
- "what prompts do I have for Midjourney?"
- "grab the reference image and use it for..."
- Any time the agent needs to pull content FROM the gallery

## Runtime env

- `CONVEX_URL` or `NEXT_PUBLIC_CONVEX_URL` — required
- `KB_OWNER_USER_ID` — required for `scope=mine` (default: `278674008`)

Both are set in the gallery's `.env.local` and OpenClaw's `.env`.

## Script

```
~/work/laniameda/laniameda.gallery/skills/laniameda-gallery-query/scripts/query.ts
```

Run from the gallery repo root so Convex imports resolve:

```bash
cd ~/work/laniameda/laniameda.gallery && bun run skills/laniameda-gallery-query/scripts/query.ts '<JSON>'
```

## Actions

### `list` — Browse assets by filters

```json
{
  "action": "list",
  "scope": "mine",
  "pillar": "creators",
  "kind": "image",
  "modelName": "Midjourney",
  "limit": 10
}
```

Returns newest assets matching filters. Default scope: `mine`, default limit: `20`.

### `search` — Semantic search (Gemini embeddings)

```json
{
  "action": "search",
  "query": "cinematic car at sunset with dramatic lighting",
  "scope": "mine",
  "pillar": "cars",
  "limit": 5
}
```

Uses Gemini `embedding-2-preview` to embed your query and find nearest matches in the vector index. Works across text and images (cross-modal). Requires `SEMANTIC_EMBEDDINGS_ENABLED=true` on the Convex deployment.

### `get` — Retrieve a single asset with full metadata

```json
{
  "action": "get",
  "assetId": "abc123def456"
}
```

Returns the asset with: `promptText`, `tagNames`, `url`, `thumbUrl`, `modelName`, `pillar`, dimensions, etc.

### `download` — Fetch image to local filesystem

```json
{
  "action": "download",
  "assetId": "abc123def456",
  "outDir": "/tmp/laniameda-gallery"
}
```

Downloads the full-resolution image to `outDir` (default: `/tmp/laniameda-gallery`). Returns `savedPath` + full asset metadata including `promptText`.

**Typical agent workflow:**
1. `search` to find the right asset
2. `download` to save it locally
3. Use the `savedPath` and `promptText` in the current task

## Response shape

All actions return JSON. Key fields per asset:

| Field | Type | Notes |
|---|---|---|
| `id` | string | Convex asset ID |
| `kind` | `"image"` \| `"video"` | |
| `pillar` | string | creators, cars, designs, dump |
| `modelName` | string | Midjourney, FLUX, etc. |
| `promptText` | string | The prompt (hydrated from prompts table) |
| `tagNames` | string[] | Hydrated tag names |
| `url` | string | Full-res image URL (presigned, temporary) |
| `thumbUrl` | string | Thumbnail URL |
| `sourceUrl` | string | Original source if ingested from URL |
| `fileName` | string | Original filename |
| `width` / `height` | number | Dimensions |
| `score` | number | Similarity score (search action only) |

## Examples

**Find Midjourney car prompts:**
```bash
cd ~/work/laniameda/laniameda.gallery && bun run skills/laniameda-gallery-query/scripts/query.ts \
  '{"action":"list","pillar":"cars","modelName":"Midjourney","limit":5}'
```

**Semantic search for a style:**
```bash
cd ~/work/laniameda/laniameda.gallery && bun run skills/laniameda-gallery-query/scripts/query.ts \
  '{"action":"search","query":"dark moody editorial portrait with film grain","limit":3}'
```

**Download an asset and get its prompt:**
```bash
cd ~/work/laniameda/laniameda.gallery && bun run skills/laniameda-gallery-query/scripts/query.ts \
  '{"action":"download","assetId":"k57abc123def","outDir":"/tmp/gallery"}'
```

## Limitations

- `get` and `download` scan the owner's asset list (up to 200) to find the asset by ID. For very large vaults, consider using `search` first.
- Presigned URLs from Convex storage are temporary. Download promptly after retrieval.
- Semantic search requires `SEMANTIC_EMBEDDINGS_ENABLED=true` on the Convex deployment.
- Video assets return a URL but `download` saves raw bytes — no transcoding.
