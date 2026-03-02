# Agent Ingest Skill Context (Convex Ground Truth)

This file is the implementation-facing contract for any agent skill that decides whether content is worth saving and ingests it into Convex.

## Source of truth

- Data model: `convex/schema.ts`
- Ingest action: `convex/ingest.ts` (`ingestFromApi`)
- HTTP wrapper: `app/api/ingest/route.ts`
- Failure cache/state: `convex/ingest_failures.ts` + `ingest_failures` table in schema

---

## Canonical ingestion path

### Preferred for skills (server-to-Convex)
Call Convex action directly:

- Function: `ingest:ingestFromApi`
- Requires: `CONVEX_URL` + Convex client
- Caller must provide `ownerUserId`

### Optional app route wrapper
`POST /api/ingest`

- Uses authenticated session (`requireAuth`) to derive `ownerUserId`
- Supports JSON and multipart form-data
- Internally calls `ingest:ingestFromApi`

---

## Ingest payload contract (action args)

`ingest:ingestFromApi`

```ts
{
  ownerUserId: string; // required
  promptText?: string;
  url?: string;
  file?: {
    base64: string;
    fileName?: string;
    contentType?: string;
  };
  tagNames?: string[];
  folderId?: Id<"folders">;
  ingestKey?: string;
  promptIngestKey?: string;
  modelName?: string;
  pillar?: "creators" | "cars" | "designs" | "dump";
  generationType?: "image_gen" | "video_gen" | "ui_design" | "other";
  promptType?: "image_gen" | "video_gen" | "ui_design" | "cinematic" | "ugc_ad" | "other";
  domain?: string;
}
```

Validation rules:

1. `ownerUserId` must be non-empty.
2. At least one of `promptText`, `url`, `file` must be present.
3. Tags are normalized/deduped before storage.

---

## What gets stored

## `prompts`
- Created when `promptText` is present.
- Supports idempotency via `ingestKey` (`promptIngestKey` preferred, falls back to `ingestKey`).

## `assets`
- Created when `url` or `file` is present.
- Kind auto-resolved from content type (`video/*` => `video`, else `image`).
- For image content, thumbnails are generated and stored when possible.
- Supports idempotency via `ingestKey`.

## `tags`
- Auto-created on demand via tag names.
- `usageCount` is updated from prompt/asset creation flow.

---

## Idempotency behavior

To prevent duplicates, skill callers should provide stable keys:

- `ingestKey`: stable media/item identity key
- `promptIngestKey`: stable prompt identity key (if prompt and media should dedupe independently)

If an item already exists for `(ownerUserId, ingestKey)`, create mutations return existing IDs with `created: false`.

---

## Failure cache / fallback state (implemented)

A persistent failure state now exists.

## Table: `ingest_failures`
Fields:

- `source: "api"`
- `ownerUserId?: string`
- `ingestKey?: string`
- `status: "pending" | "resolved"`
- `attemptCount: number`
- `payload?: any` (sanitized payload; no raw base64 body)
- `lastErrorMessage: string`
- `lastErrorName?: string`
- `firstErrorAt: number`
- `lastErrorAt: number`
- `resolvedAt?: number`
- `updatedAt: number`

Indexes:

- `by_status_lastErrorAt`
- `by_owner_status_lastErrorAt`
- `by_owner_ingestKey`

## Mutations/queries

- `ingest_failures:recordIngestFailure`
- `ingest_failures:resolveIngestFailure`
- `ingest_failures:listIngestFailures`

## Route behavior

`/api/ingest` now:

1. Records failed ingest attempts into `ingest_failures` (best-effort).
2. Resolves matching pending failure when a later ingest succeeds.
3. Returns `{ error, failureId }` on failure when recorded.

---

## Agent skill implementation guidance

1. Build a candidate save object from content analysis:
   - `shouldIngest` boolean
   - reason string
   - mapped payload fields (`pillar`, `promptType`, `generationType`, tags, etc.)
2. If `shouldIngest = false`, skip write.
3. If ingesting, always set deterministic idempotency keys.
4. On ingest failure, retry transient errors with backoff.
5. Surface `failureId` to logs so failures can be audited/recovered.

Recommended deterministic key basis:

- URL ingest: `sha256(normalizedUrl + ownerUserId)`
- File ingest: `sha256(fileHash + ownerUserId + promptText?)`
- Prompt ingest key (if separate): `sha256(normalizedPromptText + ownerUserId)`

---

## Quick health checks

List pending failures:

```bash
bunx convex run ingest_failures:listIngestFailures '{"status":"pending","limit":50}'
```

Dry-run check for ingest route failure capture:

1. send invalid ingest payload
2. confirm `failureId` in response
3. query pending failures
4. submit corrected payload with same `ingestKey`
5. verify status transitions to `resolved`
