# laniameda.gallery

A personal AI creatorship vault for production media and external references,
organized so people and agents can find, reuse and preserve source provenance.

## Objects and agent access

- Media assets: images/videos with sources, descriptions, tags and linked prompts.
- Skills: reusable techniques/recipes with text and optional prompt/media steps.
- Worlds: story universes represented by root collections; collections group media
  and Skills and support one child level. Exact rendering styles are tags.
- Stories/Scripts: private text ideas, scripts and style locks with revision history.
- X bookmarks: original post text and linked saved media.
- YouTube references: separate video/channel research with copied stills and themes.
  Motion/Cinematography are tagged asset/Skill views.

Start agents at /llms.txt, the canonical skills/laniameda-gallery/SKILL.md and
authenticated Gallery MCP. Without a connector use the dependency-free Bun client.
The deployed manifest reports version/fingerprints. Owner-only world/maintenance
policy is private agentInstructions data; public copies are fetch bootstraps.
Do not publish private IDs or credentials. Legacy pillar/workflow/folder/pack
names are compatibility details, not additional user-facing organization.

## Stack

- **Next.js** (App Router) + TypeScript
- **Convex** — realtime DB, file storage, ingest actions, vector search
- **Cloudflare R2** — image/video object storage for new uploads
- **Telegram auth** — login + ingest delivery channel
- **Bun** — package manager and runtime

## Self-hosting

You'll need:
- A Convex deployment ([convex.dev](https://convex.dev))
- A Telegram bot (`@BotFather`) for login
- (Optional) A second Telegram bot for "Saved" notifications after ingest
- A Cloudflare R2 bucket for media uploads (required for the extension drop desk)
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
bun run convex:dev
```

Run the app (in another):
```bash
bun run dev
```

App listens on `http://localhost:3317` by default.

### Browser extension

Set `EXTENSION_API_TOKEN` and `EXTENSION_OWNER_USER_ID` in the app environment,
then load `extension/` with **Load unpacked** from `chrome://extensions` (Chrome
114 or newer). Click the toolbar icon to open the persistent upload desk, enter
the gallery origin and the same extension token under **Workspace**, and save
the settings. You can then choose a collection and drop images, videos, or an
entire folder into the panel; supported media inside folders is queued
recursively before upload.

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
bun test             # Run the complete backend, UI-helper, and extension suite
bun run typecheck    # Type check
bun run convex:dev   # Canonical cloud backend; serves real gallery data
bunx convex codegen  # Regenerate Convex types after schema changes
```

## Convex schema

See [`convex/schema.ts`](convex/schema.ts) for the data model. Key tables:

- `prompts` — prompt text, type, domain, tags, owner scope
- `assets`, `assetFolders`, `assetTags` — media with source/prompt and multiple memberships
- `designInspirations` — design references with platform/workflow type metadata
- `workflows`, `workflowFolders` — internal storage for reusable Skills
- `assetPacks` — internal media grouping, distinct from collections/Skills
- `stories`, `storyRevisions`, `galleryPresets` — private text and curated views
- `bookmarks`, `videoRefs` — X post text and separate YouTube research
- `agentInstructions` — private owner skill resources with version/hash guards
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
- [`MCP_AGENT_ACCESS.md`](agent-docs/MCP_AGENT_ACCESS.md) — agent access and schema discovery

## License

MIT. See [LICENSE](LICENSE).
