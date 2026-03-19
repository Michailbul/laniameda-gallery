# Backend & Convex Setup

Last updated: 2026-03-17

---

## Convex tables (schema.ts)

| Table | Purpose |
|---|---|
| `assets` | Images/videos tied to owners, pillars, tags, storage refs |
| `prompts` | Text prompts with owner metadata, tags, folders |
| `tags` | Normalized names with usage counts & optional categories |
| `folders` | Named buckets scoped to an owner |
| `assetTags`, `promptTags` | Join tables for assets/prompts ↔ tags |
| `runs`, `run_events`, `run_artifacts` | Durable AI run + logging data |

---

## Run lifecycle functions (convex/runs.ts)

`createRun` → `claimRun` → `setRunRunning` → `appendRunEvent` → `complete`/`fail`/`cancel`

---

## Key ingestion functions

- `convex/ingest.ts` — `ingestFromApi` action with jimp-powered thumbnails + idempotency guards
- `/api/ingest` — Next.js route that verifies auth and calls the action
- `convex/agent_ingest.ts` — agent-facing ingest helpers (protected by `HTTPS_INGEST_KEY`)

---

## Environment variables

```bash
# Required for all environments
NEXT_PUBLIC_CONVEX_URL=...
CONVEX_URL=...
KB_OWNER_USER_ID=...          # Michael’s Telegram ID for agent ingestion scoping

# Auth
TELEGRAM_LOGIN_BOT_TOKEN=...
TELEGRAM_NOTIFY_BOT_TOKEN=...
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=...
SESSION_SECRET=...            # ≥32 characters for Telegram session JWT

# AI runtime
AI_GATEWAY_API_KEY=...
AI_TEXT_MODEL=...
AI_IMAGE_MODEL_NANO_BANANA=...
AI_IMAGE_MODEL_NANO_BANANA_FAST=...

# Optional dev helpers
NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED=true
DEV_AUTH_BYPASS_ENABLED=true
DEV_AUTH_TELEGRAM_ID=278674008
DEV_AUTH_FIRST_NAME=Dev
DEV_AUTH_USERNAME=dev

# Optional
ENABLE_AGENT_WORKER=false
AGENT_WORKER_URL=...
AGENT_WORKER_SHARED_SECRET=...
```

---

## Recommended follow-ups

- After schema changes: `bunx convex dev`, `bun run lint`, `bun test`
- Keep `convex/.env.local` synced with any production secrets needed for local dev
