# laniameda.gallery

A personal vault for AI creators. Save prompts, generated images, reference shots,
and design inspiration via Telegram — they land in a searchable gallery, organized
by content pillar, tagged automatically, indexed for semantic search.

Built originally as Michael's own creative-work vault. Open-sourced so anyone
running their own AI generation workflows can self-host the same setup.

## What it does

You send an image, prompt, video, or URL to your Telegram bot. It gets ingested
into Convex, classified into one of three pillars (creators / designs / dump),
tagged by model and style, and made searchable in a web gallery. Agents can
write to and query the same vault via a documented ingest API.

| Pillar | What goes here |
|---|---|
| **Creators** | AI character / portrait / fashion prompts and outputs |
| **Designs** | Website, UI, component, mobile design references |
| **Dump** | Anything useful that doesn't fit the others |

Two repo-local agent skills handle the read/write paths:
- `skills/laniameda-gallery-ingest` — save prompts, files, URLs into the gallery
- `skills/laniameda-gallery-query` — browse, search, retrieve content

## Stack

- **Next.js** (App Router) + TypeScript
- **Convex** — realtime DB, file storage, ingest actions, vector search
- **Cloudflare R2** — video object storage (images stay on Convex)
- **Telegram auth** — login + ingest delivery channel
- **Bun** — package manager and runtime

## Self-hosting

You'll need:
- A Convex deployment ([convex.dev](https://convex.dev))
- A Telegram bot (`@BotFather`) for login
- (Optional) A second Telegram bot for "Saved" notifications after ingest
- (Optional) Cloudflare R2 bucket for video storage
- (Optional) Gemini API key for semantic search embeddings

### Setup

```bash
bun install
cp .env.example .env.local
```

Fill in `.env.local`. Minimum to boot:

```bash
NEXT_PUBLIC_CONVEX_URL=https://<your-deployment>.convex.cloud
CONVEX_URL=https://<your-deployment>.convex.cloud
SESSION_SECRET=<at least 32 chars>
```

For Telegram login:
```bash
TELEGRAM_LOGIN_BOT_TOKEN=...
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=<bot username without @>
```

To restrict admin actions (delete, curate-to-public) to yourself, set:
```bash
KB_OWNER_USER_ID=<your numeric Telegram ID>
CURATION_ADMIN_USER_IDS=<your numeric Telegram ID>,telegram:<your numeric Telegram ID>
NEXT_PUBLIC_CURATION_ADMIN_USER_IDS=<your numeric Telegram ID>,telegram:<your numeric Telegram ID>
CURATION_ADMIN_SECRET=<any long random string>
```

Run Convex dev (in one terminal):
```bash
bunx convex dev
```

Run the app (in another):
```bash
bun run dev
```

App listens on `http://localhost:3317` by default.

See [`agent-docs/ENV_MATRIX.md`](agent-docs/ENV_MATRIX.md) for the complete env reference
and [`agent-docs/AUTH.md`](agent-docs/AUTH.md) for the full Telegram login setup.

## Permissions model

The gallery has two user tiers:

- **Anyone who logs in** can save assets to their own scope, browse the public gallery,
  and view their own saves.
- **Configured admins** (listed in `CURATION_ADMIN_USER_IDS`) can additionally delete
  assets and mark assets as public/featured. Non-admins see no delete affordance and
  the server rejects delete requests they shouldn't be making.

This is enforced both server-side (Convex mutations require `CURATION_ADMIN_SECRET`
+ admin-allowlist match) and in the UI (delete controls only render for admins).

## Key commands

```bash
bun run dev          # Start Next.js
bun run lint         # Lint
bun test             # Run tests (157 tests across the backend)
bun run typecheck    # Type check
bunx convex dev      # Convex local dev (run separately)
bunx convex codegen  # Regenerate Convex types after schema changes
```

## Convex schema

See [`convex/schema.ts`](convex/schema.ts) for the data model. Key tables:

- `prompts` — prompt text, type, domain, tags, owner scope
- `assets` — images/videos with `modelName`, `pillar`, linked to prompts
- `designInspirations` — design references with platform/workflow type metadata
- `assetPacks` — grouped collections (e.g. character pose packs)
- `tags` — tag system with categories (model_name, style, content_type, etc.)
- `folders` — optional user-defined folder organization
- `semanticDocuments` — vector index for semantic search
- `users`, `runs`, `generationLineage`, `ingest_failures` — supporting tables

## Project structure

```
app/             Next.js App Router pages + API routes
components/      React components (v8/ is the current dashboard)
convex/          Backend: schema, queries, mutations, actions
lib/             Shared helpers (auth, identity, gallery filters, etc.)
skills/          Repo-local agent skills (ingest + query)
agent-docs/      Architecture docs, env matrix, auth setup, observations
extension/       Chrome extension entry for one-click design saves
tests/           Bun tests for backend + API routes
```

## Documentation

The `agent-docs/` directory has the full set:

- [`PROGRESS.md`](agent-docs/PROGRESS.md) — what's been built and recent changes
- [`OBSERVATIONS.md`](agent-docs/OBSERVATIONS.md) — known quirks and lessons learned
- [`BACKEND_CONVEX_SETUP.md`](agent-docs/BACKEND_CONVEX_SETUP.md) — Convex setup walkthrough
- [`AUTH.md`](agent-docs/AUTH.md) — Telegram auth setup end to end
- [`ENV_MATRIX.md`](agent-docs/ENV_MATRIX.md) — every env var, where it's read, and what for
- [`SEMANTIC_SEARCH.md`](agent-docs/SEMANTIC_SEARCH.md) — Gemini embedding + vector index setup
- [`DESIGN.md`](agent-docs/DESIGN.md) — UI design system
- [`OPENCLAW-EXPLANATION.md`](agent-docs/OPENCLAW-EXPLANATION.md) — agent ingest integration

## License

MIT. See [LICENSE](LICENSE).
