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

Michael keeps what he makes and what he likes here, structured so agents can
save into it and query it back: the `skills/laniameda-gallery` skill is the
agent contract for saving, finding, and extracting liked items (X bookmarks,
Instagram, sites) into the vault.

### How the vault is organized (since 22 Sep 2026)
- **Collections**, one level deep: a root collection holds folders. A showcased
  root collection is a public world at `/w/<slug>`.
- **Piece type is a tag**: `character`, `location`, `scene`, `inspiration`
  (`lib/collection-sections.ts`). Never a folder.
- **Medium**: the tag `animation`; everything else is Live action (`lib/medium.ts`).
- **Typed tags** (`tags` / `userTags`) carry platform, content, style, model.
  The island bar shows owner-curated `menuFilters`, never the raw tag cloud.
- **Pillars are legacy.** The `pillar` column (`creators` / `designs` / `dump`
  / `cinema-inspiration`) is dormant; only cinema frames and workflow ingest
  still set it.

### How ingestion works
1. An agent (Claude Code, Codex, OpenClaw) or the browser extension sends
   media + prompt + tags through the ingest contract (`convex/ingest.ts`,
   `app/api/agent/*`, or the skill's direct Convex script).
2. Convex stores the prompt and asset with owner scoping, links collections
   and tags, and queues semantic indexing.
3. The gallery shows it in its collections and under its tags and filters.

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

## Convex source of truth
- The gallery's canonical Convex **dev deployment** is `dev:perfect-buffalo-375`.
- The gallery's canonical Convex **cloud URL** is `https://perfect-buffalo-375.convex.cloud`.
- If `CONVEX_DEPLOYMENT`, `CONVEX_URL`, or `NEXT_PUBLIC_CONVEX_URL` point anywhere else, treat that as drift and fix the env before running migrations or backend checks.
- `bun run convex:dev` should target `dev:perfect-buffalo-375`. The helper in `scripts/lib/convex-dev-env.ts` intentionally strips inherited Convex env vars to avoid stale shell/session overrides.
- If Convex CLI output looks inconsistent with the repo env files, check for shell-level exported vars first; this desktop environment has previously carried stale Convex vars across sessions.

---

## 🚨 Critical Convex rules
- Always define **return validators** for all Convex functions (queries, mutations, actions)
- **Never run `npx convex deploy`** unless explicitly told to
- Use `ConvexError` for user-facing errors — never throw raw errors
- Make mutations **idempotent** to handle retries
- Use **indexes** for all queries that filter or sort
- Queries and mutations **must not call external APIs** — use actions for that
- Use actions to call external services, then store results via mutation
- When backend schema or ingest contracts change (`convex/schema.ts`, `convex/validators.ts`, `convex/ingest.ts`, `convex/agent_ingest.ts`, `app/api/ingest/route.ts`), update `skills/laniameda-gallery/**` (at least `references/data-model.md`) in the same change.

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
| `OPENCLAW-EXPLANATION.md` | How OpenClaw and the (now merged) laniameda-gallery skill work |

## Feature PRD workflow
- When starting a new feature on a new branch, do **not** add that feature's full PRD documents to `main`.
- `main` should stay clean and should not accumulate competing in-progress PRDs for different feature branches.
- For planned or proposed work on `main`, add only a concise backlog note in `agent-docs/BACKLOG.md` or another shared project-doc summary if needed.
- The full feature PRD, ticket, and implementation handoff docs should live on the **feature branch** inside `agent-docs/features/<feature-name>/`.
- On a feature branch, agents must treat the branch-local PRD in `agent-docs/features/<feature-name>/` as the source of truth for that feature.
- Before implementing a feature on a branch, agents should check whether a branch-local PRD or ticket already exists and use it instead of inventing a parallel spec.
- Keep feature PRD docs organized, branch-specific, and close to the implementation work so the branch remains self-contained and easy to hand off.
