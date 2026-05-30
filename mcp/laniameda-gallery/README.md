# laniameda-gallery Local MCP

Local stdio MCP server for Claude Code, Claude Desktop, Codex CLI, and local
Codex-style agents.

This is intentionally not a hosted remote MCP server. Each user runs this process
locally with their own gallery agent token.

## Required Env

```bash
LANIAMEDA_GALLERY_API_URL=https://<app-host>
LANIAMEDA_GALLERY_AGENT_TOKEN=lgat_...
```

For local app development, use:

```bash
LANIAMEDA_GALLERY_API_URL=http://localhost:3317
```

Create the token from `/agents` after logging into the gallery.

## Codex

From this repo:

```bash
codex mcp add laniameda-gallery \
  --env LANIAMEDA_GALLERY_API_URL=https://<app-host> \
  --env LANIAMEDA_GALLERY_AGENT_TOKEN=lgat_... \
  -- bun run mcp:gallery
```

From any project, use the absolute server path:

```bash
codex mcp add laniameda-gallery \
  --env LANIAMEDA_GALLERY_API_URL=https://<app-host> \
  --env LANIAMEDA_GALLERY_AGENT_TOKEN=lgat_... \
  -- bun /absolute/path/to/laniameda.gallery/mcp/laniameda-gallery/server.ts
```

## Claude Code

Project-local:

```bash
claude mcp add laniameda-gallery \
  -e LANIAMEDA_GALLERY_API_URL=https://<app-host> \
  -e LANIAMEDA_GALLERY_AGENT_TOKEN=lgat_... \
  -- bun run mcp:gallery
```

User-wide:

```bash
claude mcp add laniameda-gallery --scope user \
  -e LANIAMEDA_GALLERY_API_URL=https://<app-host> \
  -e LANIAMEDA_GALLERY_AGENT_TOKEN=lgat_... \
  -- bun /absolute/path/to/laniameda.gallery/mcp/laniameda-gallery/server.ts
```

## Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "laniameda-gallery": {
      "command": "bun",
      "args": [
        "/absolute/path/to/laniameda.gallery/mcp/laniameda-gallery/server.ts"
      ],
      "env": {
        "LANIAMEDA_GALLERY_API_URL": "https://<app-host>",
        "LANIAMEDA_GALLERY_AGENT_TOKEN": "lgat_..."
      }
    }
  }
}
```

## Smoke Test

Ask the agent to call `check_connection`. It should return:

```json
{
  "ok": true,
  "authenticated": true
}
```

## Ownership Rule

Never pass `ownerUserId` to MCP tools. The local token determines the owner.
The app API ignores caller-supplied ownership fields and injects the token owner.

## Asset Model

Use `save_asset` for images, videos, URLs, UI references, design references, and
other visual material. The MCP does not expose a separate design-reference save
tool; use tags and optional `assetRole`/`pillar` metadata to classify assets.
