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
| `BACKEND_CONVEX_SETUP.md` | Convex tables, run lifecycle, env vars, schema change workflow |
| `DEVELOPMENT_WORKFLOWS.md` | Dev commands, env setup, test workflow |

---

## Features

Each feature has its own folder under `features/`. Structure per folder:

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
| `features/workos-auth/` | ✅ Ready | `TICKET.md` — phases 1–3 |
| `features/image-prompt-generator/` | 📋 Backlog | `research/` — placeholder |

---

## How to use this

- **Starting a new task?** → Check `BACKLOG.md` for what's next
- **What's been built?** → Check `PROGRESS.md`
- **Hit a weird bug?** → Check `OBSERVATIONS.md`
- **Working on UI?** → Read `DESIGN.md` first
- **Schema change?** → Follow `BACKEND_CONVEX_SETUP.md` after-schema checklist
- **New feature?** → Create `features/<name>/` with a `PRD.md` and `research/` folder
