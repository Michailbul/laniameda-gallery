# Progress

> What's been built. For all pending/future work see `agent-docs/BACKLOG.md`.

Last updated: 2026-03-03

---

## ✔ Shipped

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
- `laniameda-kb` OpenClaw skill (Telegram → Convex ingest)
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
