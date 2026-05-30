# Backend & Convex Setup

Last updated: 2026-03-17

## Source of truth

- Data model: `convex/schema.ts`
- Validators: `convex/validators.ts`
- Private app access boundary: Next API routes under `app/api/**`
- Convex is the persistent store and action runtime

## Runtime boundary

- The browser does not need direct private access to Convex.
- Private gallery reads and writes go through Next API routes.
- Those routes resolve the current Telegram session, derive `ownerUserId`, and then call Convex server-side.
- Public gallery access also flows through Next routes so the deployment contract stays consistent between localhost and Vercel.

## Core tables

| Table | Purpose |
|---|---|
| `users` | Telegram-linked app users and canonical `ownerUserId` |
| `agentTokens` | Scoped per-user bearer tokens for MCP/agent access |
| `assets` | Images and videos stored in Convex storage or linked by URL |
| `prompts` | Prompt text plus model, workflow, folder, and tag metadata |
| `folders` | Owner-scoped organization for prompts and assets |
| `tags` | Global tag taxonomy used across assets and prompts |
| `userTags` | Owner-scoped tag catalog/preferences for user pages and agent workflows |
| `designInspirations` | Design-specific references under the `designs` pillar |
| `canvasPositions` | Owner-scoped saved positions for canvas mode |
| `semanticDocuments` | Embeddings and search corpus for semantic search |
| `ingest_failures` | Retry/debug record for failed ingest attempts |
| `runs`, `run_events`, `run_artifacts` | AI workspace execution history |

## Important routes

| Route | Responsibility |
|---|---|
| `/api/auth/me` | Resolve current session to app user |
| `/api/gallery/assets` | Gallery data for `mine` and `public` scopes |
| `/api/folders` | Owner-scoped folder list/create |
| `/api/assets/[assetId]` | Owner-scoped delete |
| `/api/assets/[assetId]/folder` | Owner-scoped folder assignment |
| `/api/canvas/positions` | Owner-scoped canvas sync |
| `/api/semantic/search` | Semantic search wrapper |
| `/api/semantic/similar` | Similar-assets wrapper |
| `/api/ingest` | Server-side ingest entrypoint |
| `/api/agent/tokens` | Session-backed agent token issue/list |
| `/api/agent/ingest` | Token-backed agent ingest; derives owner server-side |
| `/api/agent/gallery` | Token-backed agent read/search API |
| `/api/agent/customize` | Token-backed user pillar/tag/folder customization API |

## Environment variables

```bash
# Required app/runtime
NEXT_PUBLIC_CONVEX_URL=...
CONVEX_URL=...
SESSION_SECRET=...
TELEGRAM_LOGIN_BOT_TOKEN=...
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=...

# Convex/server features
TELEGRAM_NOTIFY_BOT_TOKEN=...
CURATION_ADMIN_SECRET=...
CURATION_ADMIN_USER_IDS=...
NEXT_PUBLIC_CURATION_ADMIN_USER_IDS=...
AGENT_TOKEN_ISSUER_SECRET=...

# Legacy local/admin ingest ownership
KB_OWNER_USER_ID=...
LOCAL_INGEST_OWNER_USER_ID=...

# Semantic / AI
GEMINI_API_KEY=...
AI_GATEWAY_API_KEY=...
AI_TEXT_MODEL=...
AI_IMAGE_MODEL_NANO_BANANA=...
AI_IMAGE_MODEL_NANO_BANANA_FAST=...
```

## Convex auth config

- `convex/auth.config.ts` is intentionally minimal.
- The live app currently authenticates in Next.js with Telegram sessions.
- Do not add a Convex JWT provider unless the app is explicitly migrating to first-class Convex auth.

## Schema or contract changes

Run this whenever backend contracts change:

```bash
bunx convex dev
bun run typecheck
bun run lint
bun test
```

If you change ingest contracts in any of these files, update `skills/laniameda-gallery-ingest/**` in the same change:

- `convex/schema.ts`
- `convex/validators.ts`
- `convex/ingest.ts`
- `convex/agent_ingest.ts`
- `app/api/ingest/route.ts`
