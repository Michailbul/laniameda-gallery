---
name: laniameda-kb
description: >-
  Save prompts, images, tutorials, links, and design inspiration to the
  laniameda-gallery Convex knowledge base. Use when an agent needs to ingest
  prompts, files, URLs, or design references into the gallery and must stay
  aligned with the current repo ingest contract.
---

# laniameda-kb

Use this skill to ingest content into `laniameda.gallery` through the canonical backend contract in this repo.

The skill now supports explicit `create`, `update`, and `delete` operations through the same script entrypoint.

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
- Installed copies under `~/.openclaw/skills/`, `~/.codex/skills/`, and `~/.agents/skills/` are disposable `bunx skills` installs.
- When ingest contracts change, update this skill in the same commit.

## Runtime env

The script reads these env vars at runtime:

- `KB_OWNER_USER_ID` — required. **Value: `278674008`** (Michael's Telegram user ID). Stored in `/root/.openclaw/.env`.
- `CONVEX_URL` — required; falls back to `NEXT_PUBLIC_CONVEX_URL` if present.

**Active deployment (always use dev):**
```
CONVEX_URL=https://perfect-buffalo-375.convex.cloud
KB_OWNER_USER_ID=278674008
```

Both are already set in `/root/.openclaw/.env`. Do not use the prod deployment (`robust-gnu-269`) — it returns server errors on ingest.

## Supported content

- Prompt-only saves with explicit `allowPromptOnly: true`
- File uploads from local disk or inline base64
- Remote URL ingestion
- Design inspiration records for non-prompt design references
- Batched ingestion via JSON array
- Metadata updates for prompts, assets, and design inspirations
- Idempotent deletes for prompts, assets, and design inspirations

## CRITICAL: Screenshots and prompt images

When Michael sends a **screenshot of a prompt** or **image containing text/JSON**:
- **DO NOT** use that image as the `imagePath` or asset
- **DO** read the image, extract the text/prompt from it, and put it in `finalPrompt`
- The image is the delivery mechanism, not the content
- The content is the prompt text inside it

Only use an image as `imagePath`/asset when it is a **generated output** (the result of a prompt), not when it contains text or code to be saved.

## Payload rules

- Always provide content: `promptText`, `promptSections.finalPrompt`, `url`, `filePath` / `imagePath`, or `designInspiration`.
- Set `allowPromptOnly: true` when intentionally saving text without any file, URL, or design inspiration.
- Always set `pillar` when possible.
- Prefer `typedTags` when category and source are known.
- Use stable `ingestKey` values for retry safety.
- Use `promptIngestKey` when multiple assets should attach to one prompt.
- Keep `ownerUserId` env-driven; callers never pass it directly.
- `ingestKey` is only an idempotency key for `create`; it does not patch existing records.
- For `update` and `delete`, pass `target` plus either `id` or `ingestKey`.
- `update` is metadata-only for assets; replacing the underlying media file still requires `delete` + `create`.

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

## Validator quick reference

These are the valid enum values the Convex schema enforces — use these or ingest will fail:

**`modelProvider`:** `openai`, `anthropic`, `google`, `xai`, `meta`, `flux`, `midjourney`, `runway`, `other`
→ Use `other` for Kora Reality / Enhancor and any non-listed providers.

**`workflowType`:** `component_prompt`, `page_prompt`, `system_prompt`, `asset_recipe`, `other`

**`typedTags[].category`:** `model_name`, `style`, `content_type`, `platform`, `color`, `camera_angle`, `lighting`, `composition`, `car_make`, `car_model`, `car_angle`, `environment`, `design_style`, `design_type`, `workflow_type`, `component_type`, `custom`
→ No `subject` — use `content_type` instead.

**`promptSections` fields:** `finalPrompt` (required), `generationNotes` (optional), `negativePrompt` (optional)
→ No other keys — extra fields cause validation errors.

## Update workflow (important)

**Always edit the canonical source first:**

```
~/work/laniameda/laniameda.gallery/skills/laniameda-kb/SKILL.md
```

Then push to GitHub:

```bash
cd ~/work/laniameda/laniameda.gallery
git add skills/laniameda-kb/
git commit -m "update laniameda-kb skill"
git push
```

Then refresh installed copies across all agents:

```bash
bun run skills:update
# or manually:
bunx skills add https://github.com/Michailbul/laniameda-gallery/tree/main/skills/laniameda-kb -g -a openclaw -a codex -a cline -y
```

**When Michael says he pushed updates to the gallery repo:**
Run this immediately:
```bash
cd ~/work/laniameda/laniameda.gallery && git pull && bun run skills:update
```
No need to ask — just pull and update.

Installed copies at `~/.openclaw/skills/`, `~/.codex/skills/`, `~/.agents/skills/` are **disposable** — source of truth is always the repo.

## Script

Example invocation:

```bash
CONVEX_URL=https://perfect-buffalo-375.convex.cloud KB_OWNER_USER_ID=278674008 \
  bun run ~/.agents/skills/laniameda-kb/scripts/ingest.ts '{"promptText":"cinematic portrait","pillar":"creators","allowPromptOnly":true}'
```

If env vars are already set in `.env`, you can omit the inline prefix.

If the installed path is different for your agent runtime, use that runtime's installed `laniameda-kb/scripts/ingest.ts` path instead.
