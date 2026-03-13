# Development Workflows

## Daily dev (recommended)

```bash
# 1. Start Convex (separate terminal)
bunx convex dev

# 2. Start Next.js app
bun run dev
```

App runs at `http://localhost:3317`.

## Key scripts

```bash
bun run dev          # Next.js dev server
bun run build        # Production build
bun run lint         # ESLint
bun test             # Bun test runner
bun run typecheck    # tsc --noEmit
bunx convex dev      # Convex local dev (watch mode)
bun run skills:install:local   # Install repo skill via local path for active development
bun run skills:install:github  # Install repo skill from GitHub for tracked updates
bun run skills:update          # Check/update GitHub-backed installed skills
```

## Skill sync workflow

Canonical source:
- `skills/laniameda-kb/`

Rules:
- Edit only the repo copy of `skills/laniameda-kb`.
- Never hand-edit installed copies under `~/.openclaw/skills`, `~/.codex/skills`, or `~/.agents/skills`.
- When ingest contracts change, ship the repo skill update in the same commit.

Recommended commands:

```bash
# laptop during active development
bun run skills:install:local

# VPS / another machine that should track GitHub
bun run skills:install:github

# after pulling newer commits on GitHub-backed installs
bun run skills:update
```

## Env setup

```bash
cp .env.example .env.local
```

Minimum vars needed locally:
```bash
NEXT_PUBLIC_CONVEX_URL=...
CONVEX_URL=...
KB_OWNER_USER_ID=...          # Your Telegram user ID (for agent ingestion)
TELEGRAM_LOGIN_BOT_TOKEN=...  # For Telegram auth
```

Also set in `convex/.env.local`:
```bash
TELEGRAM_NOTIFY_BOT_TOKEN=... # For Convex ingest confirmations
```

## Convex schema changes

When you change `convex/schema.ts`:
1. Run `bunx convex dev` — it will push the schema and regenerate types
2. Run `bun run typecheck` to catch any type errors from schema changes
3. Run `bun test` to verify nothing broke

## Running tests

```bash
bun test                         # All tests
bun test tests/ingest.test.ts    # Single file
```

## Git worktrees (parallel branch work)

Create worktrees under `.worktrees/`:
```bash
scripts/worktree-create.sh --copy-env feature-branch
cd .worktrees/feature-branch
```

Remove:
```bash
scripts/worktree-remove.sh .worktrees/feature-branch
```

## Verification checklist (before any commit)

```bash
bun run lint
bun test
```

If schema changed, also verify `bunx convex dev` runs clean.
