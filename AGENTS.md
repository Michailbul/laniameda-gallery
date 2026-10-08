# AGENTS.md — laniameda.gallery

## Always use bun
Use `bun` instead of `node` everywhere. Use linters to catch unused code/functions.

## Before starting any task
Read these files first:
- `agent-docs/PROGRESS.md` — what's been built
- `agent-docs/OBSERVATIONS.md` — lessons learned, known quirks
- `convex/schema.ts` — source of truth for the data model

---

## Using the gallery itself from an agent session
To read from or save into Michael's gallery (not to change this codebase), follow
`skills/laniameda-gallery/SKILL.md`. Access, in order: the gallery MCP tools if
the session has them (`.mcp.json` registers the hosted server for Claude Code);
otherwise `bun skills/laniameda-gallery/scripts/gallery.mjs <tool> '<json>'`,
which needs only `LANIAMEDA_GALLERY_AGENT_TOKEN` and network access to
`gallery.laniameda.space`. That is the path in a cloud sandbox. Start with
`gallery.mjs check`. If the token is missing, ask Michael; never print it.

---

## What this project is

**laniameda.gallery** — a personal AI creatorship vault.

Michael keeps what he makes and what he likes here, structured so agents can
save into it and query it back: the `skills/laniameda-gallery` skill is the
agent contract for saving, finding, and extracting liked items (X bookmarks,
Instagram, sites) into the vault.

### Agent-facing object model (8 Oct 2026)
- **Skills** are reusable techniques/recipes with text and optional prompt/media steps.
- **Worlds** are story universes represented by root **collections**. Collections
  support one level of children; visual storybooks are collections of selected frames.
- **Tags** classify piece type, medium, source, content and exact style. Characters,
  Locations, Scenes and Inspirations are tags, not section folders.
- **Stories / Scripts** is private native text with world/asset links and revision history.
- **YouTube references** are separate research records with thematic label strings;
  Motion/Cinematography are tagged asset/Skill views, not another storage model.
- **Bookmarks** preserve X post text and can link actual saved attachments.
- Native Skills use skills/skillFolders and preserve ordered prompt/media steps.
  Deprecated Workflow containers are retired. Copied old links may resolve through
  owner-scoped aliases; ordinary media batches remain ordinary packs.

### Current rules and private world policy
Read skills/laniameda-gallery/SKILL.md and fetch the authenticated full
references/worlds.md before world filing, reference selection or story production.
Tracked public worlds.md is a fetch bootstrap; full policy is owner-scoped
agentInstructions data. Current human directions override historical maps/memories.
Do not copy private collection/anchor IDs into public GitHub or plugin bundles.
Preserve existing media, publication flags and public world routes when filing.
CASSANDRA and ART remain protected from reorganization unless Michael asks.
Pinterest and other outside work remain inspiration with their original sources.
File references in ART/DESIGN and any genuine project/world they support, including
references in a different visual style. File extension never determines ownership.
Do not recreate INSPIRATION VAULT, REUSABLE ASSETS or exploration/development
shelves. Every media asset needs one character/location/scene/inspiration tag and
at most five useful tags. Preserve project identity and searchable character names.
Delete collections only with explicit user approval for the named collection or
clearly described batch, after rehoming its remaining records. Technical delete
scope alone never supplies approval. Existing session approval persists for the
approved targets. No mandatory YouTube qualification-evidence gate; factual
metrics/source provenance still matter.

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
- The dev-labelled cloud deployment serves real gallery data. Use the sanitized
  `bun scripts/convex-dev.ts --once --env-file <protected-env-file>` command
  after verifying its target and obtaining deployment authorization. The package
  convex:dev command adds --local; it does not publish the real-gallery cloud. Never infer dev means an isolated database.
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
bun run convex:dev   # Local Convex backend; does not publish the real gallery
```

## Verification
Use lint, type checking, builds and native operational readbacks suited to the
change. Follow the user's validation directions; the approved 8 October audit
explicitly requires no tests. Do not add implementation-mirroring tests for filing
or documentation changes.
```bash
bun run lint
bun run typecheck
```
If Convex schema changed, validate with the canonical sanitized Convex command
only when a backend push is authorized. Compile/codegen are not a deployment.

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
| `MCP_AGENT_ACCESS.md` | Hosted/token client access and discovery |

## Feature PRD workflow
- When starting a new feature on a new branch, do **not** add that feature's full PRD documents to `main`.
- `main` should stay clean and should not accumulate competing in-progress PRDs for different feature branches.
- For planned or proposed work on `main`, add only a concise backlog note in `agent-docs/BACKLOG.md` or another shared project-doc summary if needed.
- The full feature PRD, ticket, and implementation handoff docs should live on the **feature branch** inside `agent-docs/features/<feature-name>/`.
- On a feature branch, agents must treat the branch-local PRD in `agent-docs/features/<feature-name>/` as the source of truth for that feature.
- Before implementing a feature on a branch, agents should check whether a branch-local PRD or ticket already exists and use it instead of inventing a parallel spec.
- Keep feature PRD docs organized, branch-specific, and close to the implementation work so the branch remains self-contained and easy to hand off.
