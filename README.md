# laniameda.gallery

Personal AI creatorship vault. Find something you like → send it via Telegram → it lands in the gallery, organized automatically.

## What it does

Stores and organizes AI generation prompts, reference images, and design inspiration across 4 content pillars:

| Pillar | What goes here |
|---|---|
| **Creators** | AI influencer / fashion / portrait prompts |
| **Cars** | Cinematic automotive references and prompts |
| **Designs** | Website, UI, mobile, component designs |
| **Dump** | Anything useful that doesn't fit the others |

Ingestion is handled by the `laniameda-kb` OpenClaw skill — send an image or prompt to OpenClaw via Telegram, and it shows up in the gallery.

## Stack

- **Next.js** (App Router) + TypeScript
- **Convex** — realtime database, file storage, ingest API
- **Telegram auth** — login to see your saves + community saves
- **Bun** — package manager and runtime

## Local setup

```bash
bun install
cp .env.example .env.local
```

Fill in `.env.local` with at minimum:
```bash
NEXT_PUBLIC_CONVEX_URL=...
CONVEX_URL=...
```

Start Convex dev:
```bash
bunx convex dev
```

Start the app:
```bash
bun run dev
```

App runs at `http://localhost:3317` by default.

## Key commands

```bash
bun run dev          # Start Next.js
bun run lint         # Lint
bun test             # Tests
bun run typecheck    # Type check
bunx convex dev      # Convex local dev (run separately)
bun run skills:install:github # Install canonical laniameda-kb skill globally
bun run skills:update         # Refresh GitHub-backed installed skills
```

## Convex schema

See `convex/schema.ts` — source of truth for the data model.

Key tables:
- `prompts` — prompt text, type, domain, tags
- `assets` — images/videos with `modelName`, `pillar`, linked to prompts
- `tags` — tag system with categories (model_name, style, content_type, etc.)
- `folders` — optional folder organization

## Environment variables

See `.env.example` for the full list. Key vars:

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_CONVEX_URL` | Convex deployment URL (public) |
| `CONVEX_URL` | Convex deployment URL (server) |
| `KB_OWNER_USER_ID` | Telegram user ID for agent-scoped ingestion |
| `TELEGRAM_LOGIN_BOT_TOKEN` | Telegram login widget verification token |
| `TELEGRAM_NOTIFY_BOT_TOKEN` | Convex ingest confirmation bot token |

## Documentation

See `agent-docs/` for detailed docs:
- `PROGRESS.md` — what's been built
- `OBSERVATIONS.md` — lessons and known quirks
- `BACKEND_CONVEX_SETUP.md` — Convex setup guide
- `AUTH.md` — Telegram auth setup
- `DESIGN.md` — UI design system
- `OPENCLAW-EXPLANATION.md` — how OpenClaw integration works

The canonical `laniameda-kb` skill now lives in [`skills/laniameda-kb`](/Users/michael/work/laniameda/laniameda.gallery/skills/laniameda-kb). Install it from this repo with `bunx skills` so laptops and VPS machines can track updates from GitHub.
