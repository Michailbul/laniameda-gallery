# laniameda-gallery agent skills

Two skills that let any coding agent (Claude Code, Codex, Cursor, etc.) read from and write to your laniameda.gallery vault.

## What's in here

- **`laniameda-gallery-ingest/SKILL.md`** — save prompts, images, videos, designs, and multi-step workflows
- **`laniameda-gallery-query/SKILL.md`** — browse, semantic-search, and download anything saved in your vault

Both are plain markdown skill files (the format Claude Code, Codex, and other agents understand). Drop them into your agent's skills directory and that agent will know how to talk to your gallery.

## Install

### Claude Code

```bash
unzip laniameda-gallery-skill.zip -d ~/.claude/skills/
```

### Codex / other agents

Place each `SKILL.md` under your agent's skills directory. Most agents discover skills inside `~/.<agent>/skills/<skill-name>/`.

## Runtime env

Set these in the environment your agent runs in:

```bash
export LANIAMEDA_GALLERY_URL="https://your-gallery.vercel.app"
export LANIAMEDA_AUTH_COOKIE="<your gallery session cookie value>"
```

The auth cookie is currently a preview mechanism — first-class API tokens are on the roadmap. The skill instructions explain the contract; treat it as both documentation and a contract your agent can act on.

## Use

Once installed, your agent will pick up the skills automatically when you ask something like:

- "Save this prompt and image to my gallery"
- "Find a cinematic portrait prompt I saved last month"
- "Download asset:abc123 and use it as a reference"

You don't need to invoke them manually — the agent reads the skill descriptions and routes the request.

## Updates

These skills evolve as the gallery does. Re-download the latest zip from your gallery's onboarding screen (or any settings page that exposes the link) whenever the ingest/query contract changes.
