# Backend & Convex Setup

Last updated: 2026-10-07

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
| `agentTokens` | Scoped bearer tokens; private single-use OAuth exchange hashes |
| `agentInstructions` | Private owner-scoped Skill policy documents with SHA revision guards |
| `stories` | Native text ideas/scripts/locks with revision history |
| `workflows`, `workflowFolders` | Internal reusable Skill storage and filing joins |
| `assets` | Images and videos stored in Convex storage or linked by URL |
| `prompts` | Prompt text plus model, workflow, folder, and tag metadata |
| `folders` | Owner-scoped organization for prompts and assets |
| `tags` | Global tag taxonomy used across assets and prompts |
| `userTags` | Owner-scoped tag catalog/preferences for user pages and agent workflows |
| `designInspirations` | Design-specific reference metadata (legacy storage) |
| `canvasPositions` | Owner-scoped saved positions for canvas mode |
| `semanticDocuments` | Embeddings and search corpus for semantic search |
| `ingest_failures` | Retry/debug record for failed ingest attempts |
| `runs`, `run_events`, `run_artifacts` | AI workspace execution history |

## Important routes

| Route | Responsibility |
|---|---|
| `/api/auth/me` | Resolve current session to app user |
| `/api/folders` | Owner-scoped folder list/create |
| `/api/assets/[assetId]` | Owner-scoped delete |
| `/api/canvas/positions` | Owner-scoped canvas sync |
| `/api/ingest` | Server-side ingest entrypoint |
| `/api/agent/tokens` | Session-backed agent token issue/list |
| `/api/agent/ingest` | Token-backed agent ingest; derives owner server-side |
| `/api/agent/gallery` | Token-backed agent read/search API |
| `/api/agent/customize` | Token-backed collection/tag/menu-filter customization API |

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

- Next authenticates Telegram sessions/agent tokens and signs short-lived RS256
  actor tokens using CONVEX_AUTH_PRIVATE_KEY. Convex customJwt verifies them with
  CONVEX_AUTH_JWKS; issuer/audience/key IDs must match the signing helpers.
- Private functions derive signed owner identity. LEGACY_OWNER_ARG_AUTH is false;
  never re-enable unsigned owner-argument auth as a convenience workaround.
- Stories, presets and private agentInstructions use strict signed owner builders.

## Schema or contract changes

Run this whenever backend contracts change:

```bash
bun run convex:dev # Authorized cloud push; this deployment serves real gallery data
bun run typecheck
bun run lint
bun test
```

If you change ingest contracts in any of these files, update `skills/laniameda-gallery/**` in the same change:

- `convex/schema.ts`
- `convex/validators.ts`
- `convex/ingest.ts`
- `convex/agent_ingest.ts`
- `app/api/ingest/route.ts`

## Current objects and private instructions

Media/multi-collection joins, reusable Skills (workflows internally), collections/
Worlds, typed tags, native stories/revisions, presets, X bookmarks and videoRefs
are separate objects. agentInstructions holds owner-scoped resourcePath/content/
version/sha256 data for private skill policies, indexed by owner/path. No world
names or private anchor IDs are hardcoded in backend logic. Public skill files
bootstrap owner-authenticated retrieval. Resource edits require the last-read hash.
OAuth code consumption is atomic with token minting; the internal oauthCodeHash
index is never exposed in public token metadata.

Next and local admin scripts need the private signing key; Convex needs matching
public JWKS. Cloud/token agents receive only scoped gallery agent tokens.
