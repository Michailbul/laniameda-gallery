# Backlog — laniameda.gallery

> Single source of truth for all work items.
> Statuses: `🔥 active` | `✅ ready` | `📋 backlog` | `🧊 icebox` | `✔ done`

Last updated: 2026-03-17

---

## Legend

| Field | Values |
|---|---|
| **Priority** | P0 critical · P1 high · P2 medium · P3 low |
| **Effort** | XS < 2h · S 2-4h · M 4-8h · L 1-2d · XL 2-5d |
| **Detail** | link to ticket/PRD file |

---

## 🔥 Active Sprint — Dashboard Polish

> Goal: Transform prototype into studio-grade creative tool.
> Sprint detail: `features/dashboard-polish/SPRINT.md`

| ID | Title | P | Effort | Status |
|----|-------|---|--------|--------|
| SP-01 | Replace inline hover handlers with CSS | P0 | M | todo |
| SP-02 | Add shadow/elevation token system | P0 | S | todo |
| SP-03 | Wire swipe gestures to mobile detail sheet | P0 | M | todo |
| SP-04 | Tab content transition animation | P1 | S | todo |
| SP-05 | Polish FilterTab and TagButton components | P1 | M | todo |
| SP-06 | Image card hover refinement (CSS-only) | P1 | M | todo |
| SP-07 | Sidebar visual polish | P1 | M | todo |
| SP-08 | Detail panel copy feedback (toast) | P1 | S | todo |
| SP-09 | Empty state & loading polish | P2 | S | todo |
| SP-10 | Mobile detail sheet full polish | P2 | M | todo |
| SP-11 | Keyboard navigation audit | P2 | S | todo |
| SP-12 | Responsive breakpoint audit | P2 | S | todo |
| SP-13 | Performance: reduce re-renders | P3 | M | todo |

---

## ✅ Ready — Defined, next in queue

No queued ready items. Promote from backlog after the production hardening pass lands.

---

## 📋 Backlog — Defined but not yet scheduled

### AI Features

| ID | Title | P | Effort | Notes |
|----|-------|---|--------|-------|
| AI-01 | Image → Prompt Generator (reverse-engineer prompt from image) | P1 | L | Vision model (Claude/Gemini). Button on images with no prompt. NB cinematic structure output. |
| AI-02 | Image Focus Mode Phase 2 — transitions + keyboard nav | P2 | M | PRD: `features/image-focus-mode/PRD.md` §10 Phase 2 |
| AI-03 | Image Focus Mode Phase 3 — preloading + related prompts | P3 | M | PRD: `features/image-focus-mode/PRD.md` §10 Phase 3 |

### Ingest / Content

| ID | Title | P | Effort | Notes |
|----|-------|---|--------|-------|
| ING-01 | Agent auto-classification into pillars on ingest | P1 | M | laniameda-kb skill calls classifier action on save |
| ING-02 | Bulk re-classify existing assets into pillars | P2 | S | One-time migration action |
| ING-03 | Telegram ingest: photo + caption in one message | P1 | M | Currently only processes text or URL |

### Gallery / UI

| ID | Title | P | Effort | Notes |
|----|-------|---|--------|-------|
| UI-01 | Pillar-aware theming — accent colors shift with active pillar | P1 | M | CSS vars for `--pillar-r/g/b` |
| UI-02 | Prompt detail tab: show provenance / source history | P3 | S | Phase 2 question from IFM PRD |
| UI-03 | Tab state persists globally (not reset on image switch) | P3 | XS | IFM PRD open question |
| UI-04 | Contextual related tags/prompts in side panel | P3 | L | IFM Phase 3 |
| UI-05 | Gallery Entry V2: hover actions + side-panel carousel + prompt/image arrays | P0 | XL | Ticket: `features/gallery-entry-v2/TICKET.md` (includes Convex schema/backend/frontend/docs tasks) |

### Infrastructure

| ID | Title | P | Effort | Notes |
|----|-------|---|--------|-------|
| INF-01 | Deployment pipeline (Vercel/Railway + Convex prod) | P1 | M | Need to set up proper CI deploy |
| INF-02 | Low-friction telemetry hooks (copy/action funnel) | P2 | S | IFM PRD §3 success metrics hooks |

---

## 🧊 Icebox — Interesting but not prioritised

| ID | Title | Notes |
|----|-------|-------|
| ICE-01 | Video media support | Separate UX from image-specific behaviors |
| ICE-02 | Public gallery share links | Per-pillar or per-tag public URL |
| ICE-03 | Collections / manual curation folders | Beyond auto-pillars |
| ICE-04 | Browser extension for one-click save | Companion to Telegram ingest |

---

## ✔ Done

| ID | Title | Shipped |
|----|-------|---------|
| IFM-01–06 | Image Focus Mode Phase 1 (all tickets) | 2026-02-27 · `features/image-focus-mode/TICKETS-PHASE1.md` |
| — | 4-pillar system (creators/cars/designs/dump) — schema + UI | 2026-02 |
| — | Model name filter chips in TopFilterBar | 2026-02 |
| — | Gallery dashboard with masonry grid + Convex data | 2026-02 |
| — | Detail modal with progressive thumbnail → full-res | 2026-02 |
| — | Upload panel (drag-drop, URL, tags, folder, model) | 2026-02 |
| — | Image thumbnails auto-generated on ingest (Jimp) | 2026-02 |
| — | Telegram auth routes + TelegramAuthProvider | 2026-02 |
| — | Convex schema: assets, prompts, tags, folders, runs | 2026-02 |
| — | Ingestion action with idempotency key | 2026-02 |
| — | Backend: hidden ingest tool + Telegram streaming pipeline | 2026-02 |
| — | Dev Telegram simulator + structured observability | 2026-02 |
