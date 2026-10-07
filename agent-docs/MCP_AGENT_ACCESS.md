# Agent access and contract discovery

Updated 7 October 2026. One tool surface lives in mcp/laniameda-gallery/tools.ts;
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

## Local configuration

.mcp.json registers hosted access for Claude Code. Its headers helper reads the
private ~/.config/laniameda/gallery.env when app launches lack shell environment.
Codex uses a hosted url with a private runtime bearer header or
bearer_token_env_var in config.toml. The audited desktop currently stores its
scoped header in the private user config; do not copy its value into docs. Do not log helper output,
tokens, JWTs or signed upload slots. A configured connection is verified only after
authenticated check_connection and representative reads; schema/source alone is
not evidence a version is deployed.
