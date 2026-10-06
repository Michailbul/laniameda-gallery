# laniameda-gallery MCP

Same tools (`tools.ts`), three ways in:

- **Hosted, OAuth**: `https://gallery.laniameda.space/api/mcp`. Add it as a
  connector and sign in; no token to copy. Owner only for now.
- **Hosted, bearer token**: the same URL with `Authorization: Bearer lgat_...`.
  For anything that cannot open a browser: cloud sessions, CI, Codex.
- **Local stdio** (`server.ts`): runs on your machine with an agent token from
  `/agents`. The only path that can upload a local `filePath`.

| Client | Setup |
|---|---|
| claude.ai, Claude Desktop | Custom connector, OAuth (below) |
| Claude Code in this repo, local or cloud | `.mcp.json` (checked in) + `LANIAMEDA_GALLERY_AGENT_TOKEN`, or `~/.config/laniameda/gallery.env` on the Mac |
| Claude Code in other projects on your machine | `claude mcp add --scope user`, bearer (below) |
| Codex app / CLI / IDE | `codex-config.example.toml` |
| A shell with no MCP (Codex cloud, CI) | `skills/laniameda-gallery/scripts/gallery.mjs` or `curl` (below) |

## Hosted

The endpoint speaks Streamable HTTP (stateless, JSON responses) and is protected
by OAuth 2.1 with dynamic client registration and PKCE. The client discovers
everything from the `401` it gets on first contact.

Claude Code:

```bash
claude mcp add --transport http laniameda-gallery https://gallery.laniameda.space/api/mcp
```

Then run `/mcp` in Claude Code and pick Authenticate. claude.ai / Claude Desktop:
Settings → Connectors → Add custom connector, URL
`https://gallery.laniameda.space/api/mcp`.

The browser opens `/oauth/authorize`. Sign in with Telegram if asked, then
approve. Approval mints an agent token labelled `MCP · <client name>` (365
days, scopes read/write/delete) which the client keeps; revoke it on `/agents`
to cut the client off.

Who may approve: `MCP_ALLOWED_USER_IDS` (comma-separated owner ids), falling
back to `KB_OWNER_USER_ID`. Empty means nobody. The MCP endpoint applies the same
list to every bearer token, so another user's manually created agent token is
refused too.

### Bearer token (headless clients and cloud sessions)

The endpoint takes any gallery agent token (`/agents`) whose owner is on the
allowed list. Give each client its own token so one can be revoked alone.

This repo's `.mcp.json` registers the hosted server for Claude Code and reads
the token from `LANIAMEDA_GALLERY_AGENT_TOKEN`. The Claude desktop app starts
Claude Code without the shell profile, so the variable is missing there; the
entry's `headersHelper` (`skills/laniameda-gallery/scripts/mcp-headers.sh`)
then reads the token from `~/.config/laniameda/gallery.env`. How the two fit
together: `skills/laniameda-gallery/references/maintenance.md`. In other
projects:

```bash
claude mcp add --transport http --scope user laniameda-gallery \
  https://gallery.laniameda.space/api/mcp \
  --header "Authorization: Bearer ${LANIAMEDA_GALLERY_AGENT_TOKEN}"
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.laniameda-gallery]
url = "https://gallery.laniameda.space/api/mcp"
bearer_token_env_var = "LANIAMEDA_GALLERY_AGENT_TOKEN"
```

**Cloud sessions** start with none of your machine's config. Set these on the
cloud environment:

- Environment variable `LANIAMEDA_GALLERY_AGENT_TOKEN=lgat_...`. In Codex cloud
  it must be a variable; secrets are removed before the agent runs.
- Allowed network domains: `gallery.laniameda.space` (API),
  `laniameda-gallery-videos.549ed200949b388f171b696e6ea7d033.r2.cloudflarestorage.com`
  (uploads), `pub-ad6ed85f12d147539181afa324bead00.r2.dev` (media).

A Claude cloud session on this repo then gets the MCP server from `.mcp.json`
and the skill from `.claude/skills/`. A session on another repo gets the skill
from claude.ai (re-upload it there after changing `skills/laniameda-gallery`)
and reaches the gallery through the skill's script.

**No MCP client at all** (Codex cloud, CI): the same tools from a shell.

```bash
node skills/laniameda-gallery/scripts/gallery.mjs check
node skills/laniameda-gallery/scripts/gallery.mjs tools
node skills/laniameda-gallery/scripts/gallery.mjs search_gallery '{"query":"rainy street at night"}'
```

Or with nothing but `curl`:

```bash
curl -sS https://gallery.laniameda.space/api/mcp \
  -H "authorization: Bearer $LANIAMEDA_GALLERY_AGENT_TOKEN" \
  -H "content-type: application/json" -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"check_connection","arguments":{}}}'
```

### Uploading local files (both servers)

An agent with a shell (Claude Code, Codex, Claude Desktop with a terminal) adds
files from disk in two tool calls, whatever the batch size:

1. `prepare_uploads` with the file paths → one signed upload URL and a ready
   `curl -T` command per file (URLs live 15 minutes).
2. Run the curl commands; the bytes go straight to R2, never through the chat.
3. `save_assets` with one item per file: its `uploadId` plus tags, `folderIds`,
   `agentDescription`, `sourceUrl`. Up to 50 per call; each item reports its own
   result. A single file can use `save_asset` with `uploadId`.

On save the server reads the file back once: dimensions, card thumbnail and a
content hash, so a file already in the gallery comes back as
`duplicateMedia: true` instead of a second copy. For a video, upload a poster
frame too and pass it as `posterUploadId` (that gives the card its thumbnail and
aspect ratio).

The local stdio server also takes `filePath` on `save_asset` / `save_assets`;
it does the same upload itself. Public media needs no upload: pass `url`.
`fileBase64` stays as a fallback for an agent with no shell (small files only).

Routes: `/api/agent/uploads` (upload slots), `/api/agent/ingest/batch`,
`/.well-known/oauth-protected-resource[/api/mcp]`,
`/.well-known/oauth-authorization-server`, `/api/oauth/register`,
`/oauth/authorize` (consent page), `/api/oauth/authorize` (consent POST),
`/api/oauth/token`, `/api/mcp`. Logic lives in `lib/server/mcp-oauth.ts`.

## Local stdio

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

## Seeing The Gallery

Search and list tools return JSON (ids, tags, descriptions, URLs). To judge
pieces by eye, call `preview_assets`: it returns one numbered contact-sheet
image (up to 48 thumbnails) as an MCP image block, plus a legend mapping each
number to its `asset:<id>`, tags and description.

- `query` previews semantic-search hits in rank order (with scores).
- Filters only (`pieceType`, `tagNames`, `folderId`, …) previews a listing.
- `ids` previews specific assets; 1–4 ids render large for a close look.

A typical reference hunt: `preview_assets` with the brief, pick by number,
`preview_assets` again with the shortlist ids, then `get_gallery_item` for
prompts and full records.

## Asset Model

Use `save_asset` for images, videos, URLs, UI references, design references, and
other visual material. The MCP does not expose a separate design-reference save
tool; use tags, an optional `assetRole`, and collections (`folderIds`) to classify
and organize assets.

Resolve collection names with `list_collections` before saving. Pass
`folderIds` to `save_asset` for multi-collection membership; the first ID is
retained as the primary/backward-compatible collection. Pass `folderIds` to
`update_gallery_item` with `target: "asset"` to replace memberships.
# Textual stories and presets

Both hosted and local servers register `save_story`, `list_stories`, `get_story`,
`update_story`, `get_story_revisions`, `delete_story`, `list_filter_presets`,
`save_filter_preset`, and `delete_filter_preset`. These use `/api/agent/stories`
and `/api/agent/presets` with the authenticated token's owner and action scope.
Ideas, scripts and versioned world style locks need text, not placeholder media.
See `skills/laniameda-gallery/references/stories.md` for the contract.
