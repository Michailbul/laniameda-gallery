# Progress

Last updated: 2026-02

## Done

### Foundation
- Convex schema: `assets`, `prompts`, `tags`, `folders`, join tables (`promptTags`, `assetTags`)
- Core Convex mutations/queries for assets, prompts, tags, folders
- Ingestion action (URL / file / prompt) with idempotency (`ingestKey`)
- `/api/ingest` route + ingest helpers
- Ingest helper tests

### Gallery UI
- Gallery dashboard with masonry grid
- Convex-backed assets/tags/search (no mock data)
- Detail modal with progressive thumbnail → full-res load
- Image thumbnails auto-generated on ingest (Jimp, no native deps)
- `next/image` with responsive sizing and skeleton loading states
- Upload panel: drag-and-drop, prompt/URL inputs, tags/folder metadata
- Model name (`modelName`) field on assets — tagged on ingest, displayed on cards
- Model name filter chips in `TopFilterBar` — filter gallery by model

### Auth
- Telegram auth routes (`/api/auth/telegram`, `/api/auth/me`, `/api/auth/logout`)
- `TelegramAuthProvider` component
- Guest-visible gallery; auth required only for protected actions

### Infrastructure
- `.env.example` with required vars documented
- `scripts/worktree-create.sh` / `worktree-remove.sh` for parallel branch work
- ESLint + Bun test baseline green

### Current quality gates
- `bun run lint` ✅
- `bun test` ✅ (60 tests passing)

---

## In Progress
- UI/theme refinements across dashboard, upload panel, shared components

---

## Next Up
- Add `pillar` field to Convex schema (`creators` | `cars` | `designs` | `dump`)
- Top pillar slider UI — horizontal tabs, filters gallery, optional per-pillar theme
- Agent auto-classification into pillars on ingest (via `laniameda-kb` skill)
- Flatten repo structure: move `app/` contents up to root `laniameda.gallery/`
