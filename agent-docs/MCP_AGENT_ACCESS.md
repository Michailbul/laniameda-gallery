# MCP Agent Access

Two servers share one tool surface (`mcp/laniameda-gallery/tools.ts`):

- **Hosted**: `https://<app-host>/api/mcp`, Streamable HTTP behind OAuth 2.1
  (dynamic client registration, PKCE, Telegram sign-in on the consent page).
  Restricted to `MCP_ALLOWED_USER_IDS`, falling back to `KB_OWNER_USER_ID`.
  The OAuth access token is an ordinary `lgat_` agent token, so it is listed and
  revocable on `/agents`. Setup: `mcp/laniameda-gallery/README.md`.
- **Hosted with a bearer token**: the same URL accepts an `lgat_` agent token
  as `Authorization: Bearer`. This is the path for cloud sessions, Codex and
  CI. `.mcp.json` registers it for Claude Code in this repo, reading
  `LANIAMEDA_GALLERY_AGENT_TOKEN`, or `~/.config/laniameda/gallery.env` through
  its `headersHelper` when the variable is missing (Claude desktop app
  sessions); `skills/laniameda-gallery/scripts/gallery.mjs`
  calls the same tools from a shell with no MCP client. Cloud environment
  setup (variable + allowed domains): `mcp/laniameda-gallery/README.md`.
- **Local stdio**: `bun run mcp:gallery` with a token in the environment, below.
  Do not deploy `server.ts` as a shared hosted process; it reads one local user
  token from environment variables.

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

Collections are the user-facing organization layer. Resolve names with
`list_collections`, then pass `folderIds` to `save_asset` or to
`update_gallery_item` for an asset. The first ID is primary; all IDs become
collection memberships. Ordinary saves should not invent or infer legacy
pillars.

The bundled stdio MCP server exposes:

- `check_connection`
- `save_asset`
- `prepare_uploads` — signed direct-to-R2 upload URLs for local files
- `save_assets` — batch save (up to 50), by `uploadId`, `url` or `filePath`
- `save_prompt`
- `update_gallery_item`
- `delete_gallery_item`
- `list_assets`
- `search_gallery`
- `find_similar`
- `preview_assets` — numbered contact-sheet image of search hits, a listing, or explicit ids (the agent's way to see pieces)
- `check_sources`
- `get_gallery_item`
- `list_tags`
- `upsert_tag`
- `upsert_tags`
- `archive_tag`
- `add_tag_aliases`
- `list_collections`
- `create_collection`
- `update_collection`
- `delete_collection`

Customization calls go through `POST /api/agent/customize`. Agents still never send
`ownerUserId`; the token decides which user's page, pillars, tags, and folders are
being customized.
