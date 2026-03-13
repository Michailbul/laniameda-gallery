---
name: laniameda-kb
description: >-
  Save prompts, images, tutorials, links, and design inspiration to the
  laniameda.gallery Convex knowledge base. Use when an agent needs to ingest
  prompts, files, URLs, or design references into the gallery and must stay
  aligned with the current repo ingest contract.
---

# laniameda-kb

Use this skill to ingest content into `laniameda.gallery` through the canonical backend contract in this repo.

## Read first

Before constructing payloads or changing the ingest script, read these repo files:

- `convex/schema.ts`
- `convex/validators.ts`
- `convex/ingest.ts`
- `convex/agent_ingest.ts`
- `app/api/ingest/route.ts`

Use `references/schema-contract.md` for a quick map and `references/ingest-examples.md` for copy-ready examples.

## Source of truth

- Canonical skill source: `skills/laniameda-kb/`
- Installed copies under `~/.openclaw/skills/`, `~/.codex/skills/`, and `~/.agents/skills/` are disposable `npx skills` installs.
- When ingest contracts change, update this skill in the same commit.

## Runtime env

The script reads these env vars at runtime:

- `KB_OWNER_USER_ID` — required
- `CONVEX_URL` — required; falls back to `NEXT_PUBLIC_CONVEX_URL` if present

## Supported content

- Prompt-only saves
- File uploads from local disk or inline base64
- Remote URL ingestion
- Design inspiration records for non-prompt design references
- Batched ingestion via JSON array

## Payload rules

- Always provide content: `promptText`, `promptSections.finalPrompt`, `url`, `filePath` / `imagePath`, or `designInspiration`.
- Always set `pillar` when possible.
- Prefer `typedTags` when category and source are known.
- Use stable `ingestKey` values for retry safety.
- Use `promptIngestKey` when multiple assets should attach to one prompt.
- Keep `ownerUserId` env-driven; callers never pass it directly.

## Install/update workflow

Repo-local development:

```bash
bun run skills:install:local
```

GitHub-backed install:

```bash
bun run skills:install:github
```

Refresh installed GitHub-backed skills:

```bash
bun run skills:update
```

## Script

Example invocation:

```bash
bun run ~/.agents/skills/laniameda-kb/scripts/ingest.ts '{"promptText":"cinematic portrait","pillar":"creators"}'
```

If the installed path is different for your agent runtime, use that runtime's installed `laniameda-kb/scripts/ingest.ts` path instead.
