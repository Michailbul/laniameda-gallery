# Local MCP Agent Access

This project supports local stdio MCP for Claude Code, Claude Desktop, Codex CLI,
and Codex desktop-style local agents. Do not deploy the current MCP server as a
shared hosted process; it reads one local user token from environment variables.

## Flow

1. User logs in to the gallery with Telegram.
2. User creates an agent token through `POST /api/agent/tokens`.
3. The user's local MCP client launches the stdio server with:

```bash
LANIAMEDA_GALLERY_API_URL=https://<app-host>
LANIAMEDA_GALLERY_AGENT_TOKEN=lgat_...
bun run mcp:gallery
```

4. The MCP server calls `/api/agent/*` with `Authorization: Bearer <token>`.
5. The app validates the token and derives `ownerUserId` before calling Convex.

Agents must not receive `CONVEX_URL`, `NEXT_PUBLIC_CONVEX_URL`, or `KB_OWNER_USER_ID` for production multi-user access.

## Local Codex Setup

From the gallery repo:

```bash
codex mcp add laniameda-gallery \
  --env LANIAMEDA_GALLERY_API_URL=https://<app-host> \
  --env LANIAMEDA_GALLERY_AGENT_TOKEN=lgat_... \
  -- bun run mcp:gallery
```

Verify:

```bash
codex mcp list
```

If the MCP is configured outside this repo, use an absolute server path:

```bash
codex mcp add laniameda-gallery \
  --env LANIAMEDA_GALLERY_API_URL=https://<app-host> \
  --env LANIAMEDA_GALLERY_AGENT_TOKEN=lgat_... \
  -- bun /absolute/path/to/laniameda.gallery/mcp/laniameda-gallery/server.ts
```

## Local Claude Code Setup

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

Verify in Claude Code with `/mcp`, then call `check_connection`.

## Claude Desktop Config

Add this to `claude_desktop_config.json`:

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

For local app development, use `http://localhost:3317` as
`LANIAMEDA_GALLERY_API_URL`.

## Token Scopes

- `gallery:read` — list/search/read gallery data
- `gallery:write` — create/update gallery records
- `gallery:delete` — delete gallery records

Token rows store only a SHA-256 hash of the token secret. The raw token is shown once by `POST /api/agent/tokens`.

## Server Env

Set `AGENT_TOKEN_ISSUER_SECRET` in both the Next.js app env and Convex env. It protects token issue/list/revoke Convex functions from direct public Convex calls.

## MCP Tools

The local MCP has one visual reference path: use `save_asset` for images,
videos, URLs, UI references, and design references. Classify the item with tags
such as `design`, `ui`, `website`, `component`, or `reference`; do not use a
separate design-specific tool.

The bundled stdio MCP server exposes:

- `check_connection`
- `save_asset`
- `save_prompt`
- `update_gallery_item`
- `delete_gallery_item`
- `list_assets`
- `search_gallery`
- `get_gallery_item`
- `list_pillars`
- `upsert_pillar`
- `archive_pillar`
- `list_tags`
- `upsert_tag`
- `upsert_tags`
- `archive_tag`
- `list_folders`
- `create_folder`
- `update_folder`
- `delete_folder`

Customization calls go through `POST /api/agent/customize`. Agents still never send
`ownerUserId`; the token decides which user's page, pillars, tags, and folders are
being customized.
