# Agent access and contract discovery

Updated 8 October 2026. One tool surface lives in mcp/laniameda-gallery/tools.ts;
hosted HTTP and local stdio call authenticated /api/agent/* routes. Tools derive
owner from the token; agents never supply ownerUserId or server signing keys.

Hosted MCP: https://gallery.laniameda.space/api/mcp, using OAuth or an owner-issued
LANIAMEDA_GALLERY_AGENT_TOKEN. Local stdio: bun run mcp:gallery with the token and
optional LANIAMEDA_GALLERY_API_URL. Do not host a shared stdio process that reads
one user's env token. Tokens are issued/revoked through /agents.

Discover current tools/schemas instead of trusting a copied tool inventory. Start
with check_connection and get_skill_instructions. /llms.txt and
/skills/laniameda-gallery/manifest.json expose the deployed public contract.
World/maintenance resources are owner-only private documents retrieved through
get_skill_instructions; public Git/plugin files are bootstrap instructions.

## No connector

Use scripts/gallery.mjs and importable gallery-client.mjs with Bun; no packages
are needed. Custom scripts can follow assets.pages()/all(), filter and aggregate
before printing. Cloud sessions need only scoped token and network access to
gallery/media/upload hosts, not Convex env. See the canonical web-access reference.

## Capabilities

Media, Skills, collections/Worlds, tags, native Stories, presets, X bookmarks and
YouTube references have separate operations. list_assets_page returns a cursor
and isDone for complete inventory; list_assets is bounded. list_menu_filters
discovers curated IDs for presets. create_skill supports text-only recipes or
real prompt/media steps; grouping ordinary media belongs in a collection.
set_video_poster edits only a video's thumbnail; media replacement is separate.

Collections support plain parent/child links and root visual storybooks. Stories
require last-read revision for changes. Inspect HTTP207/batch partial results and
repair persisted IDs, avoiding duplicate creates. Preserve public/liked flags.
Token scopes gallery:read/write/delete gate the relevant actions; discovery reads
do not authorize requested content writes. OAuth codes are single-use and bound
to redirect/PKCE; unknown scopes reject.

## Missing Delete permission

An active token without the requested scope receives HTTP 403 with the exact
missing scope. Invalid, revoked or expired tokens receive HTTP 401. A hosted MCP
tool reports the same actionable permission message when its API call is denied.

Manual tokens default to Read and Write. Deleting collections, presets or pieces
also requires `gallery:delete`; Write alone does not authorize deletion. The
signed-in owner can open Permissions on an active manual token at `/agents`,
select Delete and save. This updates the existing connection without replacing
or revealing its secret. Defaults remain Read and Write, with Delete off.

`PATCH /api/agent/tokens/:tokenId` requires a same-origin authenticated owner
session. The server derives the owner, validates the allowed nonempty scopes,
and checks token ownership and active status through the issuer-protected backend.
Agent bearer authentication never authorizes this endpoint. OAuth tokens, including
legacy MCP-labeled tokens, cannot be edited: reconnect and approve the requested
scopes in the OAuth consent screen. No token is automatically upgraded.

## Approval to delete

Delete scope grants technical access only. Before deleting, an agent must obtain
explicit user approval for the named collection/preset or clearly listed batch,
after explaining the effects. Existing approval for those targets in the current
session persists; restoring access does not require asking again. A general
organization or vague cleanup request, Write access, and enabling Delete do not
authorize unrelated or future deletions. Tool descriptions, destructive MCP
annotations and the canonical skill carry this requirement. It is an agent
approval rule; no agent-provided boolean is treated as proof of human consent.

Collection deletion removes its shell and asset/prompt/Skill membership links.
Media, prompts, Skills and native story text remain; child collections become
roots. The collection's route disappears. Stories retain their earlier links
and revision history and may report missing references; saved views pointing to
the collection may need repair. Filter-preset deletion removes only the saved
view and preserves assets, collections and tags.

## Local configuration

.mcp.json registers hosted access for Claude Code. Its headers helper reads the
private ~/.config/laniameda/gallery.env when app launches lack shell environment.
Codex uses a hosted url with a private runtime bearer header or
bearer_token_env_var in config.toml. The audited desktop currently stores its
scoped header in the private user config; do not copy its value into docs. Do not log helper output,
tokens, JWTs or signed upload slots. A configured connection is verified only after
authenticated check_connection and representative reads; schema/source alone is
not evidence a version is deployed.
