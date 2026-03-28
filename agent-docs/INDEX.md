# agent-docs — Directory

Quick reference for all docs in this folder.

---

## Project state

| File | Purpose |
|------|---------|
| `BACKLOG.md` | **Master task tracker** — all work items by status (active / ready / backlog / icebox / done) |
| `PROGRESS.md` | Changelog — what shipped and when |
| `OBSERVATIONS.md` | Technical lessons, known quirks, things to watch |

---

## System docs

| File | Purpose |
|------|---------|
| `DESIGN.md` | Design system — current warm paper theme, tokens, component rules |
| `AUTH.md` | Auth architecture — Telegram login, session, env vars |
| `ENV_MATRIX.md` | Local vs Vercel vs Convex vs OpenClaw env variables + production smoke tests |
| `BACKEND_CONVEX_SETUP.md` | Convex tables, run lifecycle, env vars, schema change workflow |
| `SEMANTIC_SEARCH.md` | Semantic search — Gemini embeddings, vector search, indexing flow, UI integration |
| `DEVELOPMENT_WORKFLOWS.md` | Dev commands, env setup, test workflow |

---

## Features

Each feature has its own folder under `features/`. Keep only current or landed feature docs on `main`; branch-local planning docs should stay on the feature branch, not accumulate here.

Structure per folder:

```
features/<feature-name>/
  PRD.md              ← product requirements (goals, scope, non-goals)
  TICKETS.md          ← implementation tickets with acceptance criteria
  TICKETS-PHASE1.md   ← phase-scoped tickets if multiple phases
  TICKET.md           ← single-ticket features
  research/           ← research notes, competitive analysis, design exploration
```

| Folder | Status | Contents |
|--------|--------|----------|
| `features/dashboard-polish/` | 🔥 Active sprint | `SPRINT.md` — SP-01 to SP-13 tickets |
| `features/image-focus-mode/` | ✔ Done (Phase 1) | `PRD.md`, `TICKETS-PHASE1.md` |
| `features/gallery-entry-v2/` | 📋 Backlog | `TICKET.md` — entry model (multi-image/prompt mapping) + hover actions + side-panel carousel |
| `features/designs-pillar/` | 📋 Backlog | `PRD.md` — designs pillar as skills/workflows library with fullscreen modal, structured cards, agent prompt copy |

---

## How to use this

- **Starting a new task?** → Check `BACKLOG.md` for what's next
- **What's been built?** → Check `PROGRESS.md`
- **Hit a weird bug?** → Check `OBSERVATIONS.md`
- **Working on UI?** → Read `DESIGN.md` first
- **Schema change?** → Follow `BACKEND_CONVEX_SETUP.md` after-schema checklist
- **New feature?** → Create `features/<name>/` with a `PRD.md` and `research/` folder
