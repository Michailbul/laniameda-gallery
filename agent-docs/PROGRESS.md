# Progress

> What's been built. For all pending/future work see `agent-docs/BACKLOG.md`.

Last updated: 2026-03-17

---

## ✔ Shipped

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
