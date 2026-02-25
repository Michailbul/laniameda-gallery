# AGENTS.md — laniameda.gallery

## Always use bun
Use `bun` instead of `node` everywhere. Use linters to catch unused code/functions.

## Before starting any task
Read these files first:
- `agent-docs/PROGRESS.md` — what's been built
- `agent-docs/OBSERVATIONS.md` — lessons learned, known quirks
- `convex/schema.ts` — source of truth for the data model

---

## What this project is

**laniameda.gallery** — a personal AI creatorship vault.

Michael finds things he likes (screenshots, prompts, reference images, designs) and sends them via Telegram to OpenClaw. The `laniameda-kb` OpenClaw skill extracts and ingests them into Convex. The gallery organizes everything into 4 content pillars.

### 4 content pillars
| Pillar | Description |
|---|---|
| **creators** | AI influencer / fashion / portrait style prompts |
| **cars** | Cinematic automotive references and prompts |
| **designs** | Website, UI, component, mobile design references |
| **dump** | Catch-all — anything useful that doesn't fit above |

### How ingestion works
1. Michael sends an image or prompt to OpenClaw via Telegram
2. OpenClaw uses the `laniameda-kb` skill to call the Convex ingest API
3. Convex stores the prompt + asset with owner scoping
4. Gallery displays it in the right pillar

### Auth
- **Telegram login** — user authenticates with Telegram
- `TELEGRAM_USER_ID` stored in env vars (agent never needs to guess it)
- Gallery shows your saves + community saves when logged in

### Agent worker
- `agent-worker/` folder is preserved but **not active** in the current setup
- Will be extracted as a standalone service later for better pricing/isolation
- Do not rely on `ENABLE_AGENT_WORKER` being true in local dev

---

## Stack
- **Next.js** (App Router) + TypeScript
- **Convex** — database, queries, mutations, actions, file storage (source of truth)
- **Telegram auth** — login via Telegram
- **Bun** — package manager and runtime

---

## 🚨 Critical Convex rules
- Always define **return validators** for all Convex functions (queries, mutations, actions)
- **Never run `npx convex deploy`** unless explicitly told to
- Use `ConvexError` for user-facing errors — never throw raw errors
- Make mutations **idempotent** to handle retries
- Use **indexes** for all queries that filter or sort
- Queries and mutations **must not call external APIs** — use actions for that
- Use actions to call external services, then store results via mutation

## TypeScript & schema conventions
- Use `v.*` validators for all Convex function args
- Use `Doc<"table">`, `Id<"table">` from `./_generated/dataModel`
- Use `QueryCtx`, `MutationCtx`, `ActionCtx` from `./_generated/server`
- Use `Infer<typeof validator>` to share types across schema/args/helpers

---

## Common commands
```bash
bun run dev          # Start Next.js (port 3317 by default)
bun run lint         # Lint
bun test             # Tests
bun run typecheck    # TypeScript check
bunx convex dev      # Start local Convex dev environment
```

## Verification (required after every change)
```bash
bun run lint
bun test
```
If Convex schema changed, also run `bunx convex dev` once.

---

## Repo structure
```
convex/          Convex backend (schema, queries, mutations, actions)
components/      React UI components
app/             Next.js App Router pages and API routes
lib/             Shared utilities
agent-docs/      Project documentation (see below)
agent-worker/    Standalone worker (not active — future separate service)
scripts/         Dev utility scripts
```

## agent-docs/ index
| File | Purpose |
|---|---|
| `PROGRESS.md` | What's been built |
| `OBSERVATIONS.md` | Lessons, known quirks, things to watch |
| `BACKEND_CONVEX_SETUP.md` | Convex setup and schema walkthrough |
| `AUTH.md` | Telegram auth setup |
| `DESIGN.md` | UI design system and visual direction |
| `DEVELOPMENT_WORKFLOWS.md` | Dev commands and workflow |
| `OPENCLAW-EXPLANATION.md` | How OpenClaw and the laniameda-kb skill work |
