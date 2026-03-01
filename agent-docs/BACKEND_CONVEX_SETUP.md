# Backend & Convex Setup

Last updated: 2026-03-01

---

## Convex tables (schema.ts)

| Table | Purpose |
|-------|---------|
| `assets` | Images/videos with owner, pillar, tags, storage refs |
| `prompts` | Text prompts with owner, tags, folder |
| `tags` | Normalized tag names + usage counts |
| `folders` | Named groupings |
| `assetTags` | asset ↔ tag join |
| `promptTags` | prompt ↔ tag join |
| `runs` | Durable AI run records (status, model, intent, usage) |
| `run_events` | Per-run event stream (stream_text, tool_call, error, etc.) |
| `run_artifacts` | Outputs attached to a run (prompt package, image, text) |

---

## Run lifecycle functions (convex/runs.ts)

`createRun` → `claimRun` → `setRunRunning` → `appendRunEvent` → `completeRun` / `failRun` / `cancelRun`

Runs track: `runtime`, `provider`, `model`, `mode`, `intent`, `source`, `usage`.

---

## Key ingestion functions

- `convex/ingest.ts` — `ingestFromApi` action (URL / file / prompt, idempotency via `ingestKey`)
- `convex/agent_ingest.ts` — hidden ingest tool for agent-triggered saves
- `/api/ingest` — Next.js route that calls the Convex action

---

## Environment variables

```bash
# Required for all environments
NEXT_PUBLIC_CONVEX_URL=...
CONVEX_URL=...
KB_OWNER_USER_ID=...          # Michael's Telegram user ID

# Auth
TELEGRAM_BOT_TOKEN=...

# WorkOS (for Google login + account linking — see features/workos-auth/TICKET.md)
WORKOS_API_KEY=...
WORKOS_CLIENT_ID=...
WORKOS_REDIRECT_URI=...
WORKOS_COOKIE_PASSWORD=...    # 32+ char secret for session encryption

# AI runtime
AI_GATEWAY_API_KEY=...
AI_TEXT_MODEL=...
AI_IMAGE_MODEL_NANO_BANANA=...
AI_IMAGE_MODEL_NANO_BANANA_FAST=...

# Optional
ENABLE_AGENT_WORKER=false
AGENT_WORKER_URL=...
AGENT_WORKER_SHARED_SECRET=...
```

---

## After schema changes

```bash
bunx convex dev      # pushes schema, regenerates types
bun run typecheck    # verify no type errors
bun test             # verify no test breakage
```

---

## Recommended future Convex components

- `@convex-dev/workflow` — durable retries for long-running orchestration
- `@convex-dev/rate-limiter` — per-user run throttling
- `@convex-dev/persistent-text-streaming` — streaming persistence
