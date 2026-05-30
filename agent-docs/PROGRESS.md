# Progress

> What's been built. For all pending/future work see `agent-docs/BACKLOG.md`.

Last updated: 2026-05-02

---

## ✔ Shipped

### 2026-05-26
- Added multi-user agent token foundation: logged-in users can issue/revoke scoped gallery agent tokens, and agent calls derive `ownerUserId` server-side
- Added `/api/agent/*` routes for token-authenticated ingest, update/delete, and gallery reads without exposing Convex URL or owner env vars to agents
- Added `laniameda-gallery` stdio MCP server that talks to the app API with `LANIAMEDA_GALLERY_AGENT_TOKEN`
- Added token-authenticated `/api/agent/customize` and MCP tools for user pillars, user tag catalogs, and folders
- Documented local-only Claude/Codex MCP setup and added `check_connection` for local agent smoke tests
- Consolidated local MCP visual reference writes/reads around assets; UI/design references are now classified by tags instead of separate design-specific MCP tools

### 2026-05-08
- Custom user pillars/boards added via `userPillars`: default pillars still resolve virtually, and users can add boards such as `inspirations` without changing the existing asset APIs
- Dashboard filters and manual upload now read the user's dynamic pillar list instead of hard-coded tabs
- Browser extension image saves now open a pillar picker before saving, and the popup can fetch/create custom pillars while preserving the existing page bookmark flow

### 2026-05-08
- Image delivery moved to the existing R2 media path: new ingested images and generated thumbnails store `r2Key`/`thumbR2Key`, gallery hydration resolves R2 URLs first, and Convex storage remains a fallback for legacy rows
- Added image-aware R2 migration/cleanup support so older Convex image blobs can be copied to R2 before removing the Convex originals

### 2026-05-02
- Video/workflow saving finished end-to-end: video uploads/URLs store as `kind: "video"`, render in gallery cards/detail view, and can carry prompt/workflow metadata
- Generation lineage shipped for multi-stage workflows via `generationLineage` and ingest `upstreamInputs`, including owner checks, idempotent upserts, and cleanup on prompt/asset delete
- Upload and extension paths refreshed for workflow metadata, Midjourney prompt capture, and canonical gallery extension settings

### 2026-04-02
- Gallery packs promoted to a first-class dashboard card concept: pack members now collapse into one card with hover preview cycling and detail-panel carousel support
- Prompt-linked multi-asset records now auto-sync into `assetPacks` at the mutation layer, so create/update/delete flows keep pack membership and cover state consistent
- Added a backend consolidation path for legacy prompt groups via `assetPacks:consolidateOwnerPromptPacks`

### 2026-03-17
- Private gallery data access moved behind Next.js API routes so the browser no longer needs direct private Convex calls
- Auth path cleaned up to Telegram-only runtime flow; dead WorkOS and AN route surface removed from the app
- Env/docs/scripts refreshed to match the actual deployment contract, including `bun run typecheck`, stricter prod env checks, and server-side Convex access
- Prompt-only workflows shipped: the dashboard now has a text-only prompt view, and prompt-only ingest requires explicit `allowPromptOnly` opt-in across maintained ingest paths

### 2026-03-13
- Canonical repo-backed `laniameda-gallery-ingest` skill added under `skills/laniameda-gallery-ingest/` with GitHub/local `bunx skills` install workflows
- Skill contract docs now live with the project and are intended to ship in lockstep with ingest schema changes
- Explicit ingest management contract added: `update` + `delete` actions/routes for prompts, assets, and design inspirations, plus skill support for all three operations

### 2026-03-07
- Telegram integration split: dedicated login token (`TELEGRAM_LOGIN_BOT_TOKEN`) and dedicated Convex notification token (`TELEGRAM_NOTIFY_BOT_TOKEN`) with legacy fallback support
- Removed obsolete Next.js Telegram webhook route and webhook setup script; ingest remains OpenClaw -> Convex
- Env/docs refresh for two-bot architecture and production setup

### 2026-03-04
- Iteration hardening phase 1: authz canonicalization, design token enforcement, shared UI primitives, and gallery query N+1 reduction
- Product management docs for iteration hardening: scorecard + now/next/later roadmap
- Gallery interaction reliability pass: scope-safe folder filtering (`mine` only), stale folder filter normalization, and selected-detail reset on scope switch

### 2026-03-03
- Folders backend v1 — owner-scoped folder model (create/list/update/delete), cross-user folder guardrails, and asset folder assignment mutation
- Folder lifecycle cleanup — deleting a folder now clears linked `folderId` on owner prompts/assets
- Backend test harness for Convex handlers + folder lifecycle permission tests
- Feature docs added: `agent-docs/features/folders/PRD.md` and `agent-docs/features/folders/TICKET.md`

### 2026-03-01
- Image focus mode (IFM Phase 1) — tabbed detail panel (Prompt/Details/Actions), mobile bottom sheet, keyboard nav, swipe gesture hook, state contract
- Gallery redesign — warm editorial theme, pillar-aware accent colors, CSS animation system
- Backend: hidden ingest tool + Telegram streaming pipeline
- Dev Telegram simulator + structured observability (`runs`, `run_events`, `run_artifacts` tables)
- AI workspace panel + run contract system

### 2026-02
- 4-pillar system (`creators` | `cars` | `designs` | `dump`) — schema field, query filter, upload selector, TopFilterBar tabs
- Model name (`modelName`) field on assets — tagged on ingest, filter chips in TopFilterBar
- Gallery dashboard — masonry grid, Convex-backed assets/tags/search (no mock data)
- Detail modal — progressive thumbnail → full-res load
- Upload panel — drag-drop, URL, prompt, tags, folder, model metadata
- Image thumbnails auto-generated on ingest (Jimp, no native deps)
- Telegram auth routes (`/api/auth/telegram`, `/api/auth/me`, `/api/auth/logout`) + `TelegramAuthProvider`
- Guest-visible gallery; auth required only for protected actions

### Foundation
- Convex schema: `assets`, `prompts`, `tags`, `folders`, `runs`, `run_events`, `run_artifacts`, join tables
- Core Convex queries/mutations/actions for assets, prompts, tags, folders
- Ingestion action with idempotency key (`ingestKey`)
- `/api/ingest` route + ingest helpers
- `laniameda-gallery-ingest` OpenClaw skill (Telegram → Convex ingest)
- ESLint + Bun test baseline green (60 tests)

---

## 🔥 Active Sprint

Dashboard Polish — SP-01 through SP-13.
See `agent-docs/features/dashboard-polish/SPRINT.md` for ticket details.

---

## Quality Gates

```bash
bun run lint   # must be clean
bun test       # all tests passing
```
