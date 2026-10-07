# Fetch and use the deployed gallery skill

Start at https://gallery.laniameda.space/llms.txt, then fetch
https://gallery.laniameda.space/skills/laniameda-gallery/SKILL.md and manifest.json.
The manifest reports the deployed public version/fingerprints and resource URLs.
Public resources are repository-backed. Detailed worlds/maintenance content is
owner-scoped agentInstructions data served through authenticated resource paths;
public Git/plugin files at those paths are bootstrap instructions only.

## Start a session

Use hosted Gallery MCP at https://gallery.laniameda.space/api/mcp with OAuth or an
owner-issued bearer token. Call get_skill_instructions for the needed reference,
check_connection, then discover tools/input schemas. get_skill reads a saved
reusable Skill; get_skill_instructions reads this instruction package.

Without a connector, download both public client modules into the same directory:

```bash
curl --fail --silent --show-error https://gallery.laniameda.space/skills/laniameda-gallery/scripts/gallery.mjs --output gallery.mjs
curl --fail --silent --show-error https://gallery.laniameda.space/skills/laniameda-gallery/scripts/gallery-client.mjs --output gallery-client.mjs
bun gallery.mjs check
bun gallery.mjs tools
bun gallery.mjs schema save_assets
bun gallery.mjs all_assets '{"pageSize":200}' --out ./inventory
bun gallery.mjs all_video_refs '{"pageSize":200}' --out ./youtube-inventory
```

LANIAMEDA_GALLERY_AGENT_TOKEN comes from the owner's /agents token management.
LANIAMEDA_GALLERY_API_URL can select a local preview or otherwise defaults to the
canonical host. Never print tokens, paste them into URLs or include them in files
destined for public Git. Public instructions grant no private data/write permission.

## Custom scripts

Import createGalleryClient from scripts/gallery-client.mjs in Bun. Configure
token/apiUrl/fetch/timeoutMs/maxCalls as needed (or authenticated callTool/listTools
bridges); discover/schema/call expose live
tools. Resource namespaces include assets, collections, menuFilters, Skills, Stories,
bookmarks, YouTube references and presets. Use
assets.pages()/assets.all() and videoRefs.pages()/videoRefs.all() for complete reads and filter/aggregate locally
before printing concise results. assets.inventory() also returns completion, page
count and scan metadata. The CLI --out takes a directory; all_assets writes
<directory>/assets.json. Avoid printing private full inventory data unless
that export is requested. Read the actual module and tool schema for option names.

```javascript
import { createGalleryClient } from "./gallery-client.mjs";
const gallery = createGalleryClient({ maxCalls: 250 });
await gallery.schema("list_assets_page");
const inventory = await gallery.assets.inventory({
  folderId: "<resolved collection ID>", includeDescendants: true, pageSize: 200
});
const byKind = inventory.assets.reduce((counts, asset) => {
  counts[asset.kind] = (counts[asset.kind] ?? 0) + 1;
  return counts;
}, {});
console.log({ complete: inventory.complete, count: inventory.assets.length, byKind });
```

Run this with Bun and the token in the environment. The code aggregates private
reads locally; no arbitrary server code or raw database access is required.
A partial write throws GalleryError with the result/persisted IDs attached;
inspect that state before repeating a write.

## Owner-only policies

get_skill_instructions with resource: references/worlds.md returns the current
private world map/locks/IDs; references/maintenance.md returns setup and deployment
policy. They require gallery:read, the configured owner and allowed MCP access.
HTTP resource reads use Authorization: Bearer and private no-store responses.
Do not guess rules from old installed copies if access is unavailable.

## Object operations and completion

- Media: save_asset/save_assets; list_assets_page for cursors/isDone, search_gallery
  for meaning, preview_assets for actual visual selection, get_gallery_item for IDs.
- Skills: create_skill supports markdown-only recipes or prompt/media steps;
  list/search/get/update/file/delete use the named Skill tools. Legacy workflow
  is an internal table/wire name only.
- Collections: list/create/update; parentFolderId supports plain children and
  kind: storybook supports root visual books. Worlds are root collections.
- Native Stories: save/list/get/update; changes require the last-read revision.
- Bookmarks and YouTube references have separate tools; ordinary media search
  does not search all objects. Motion/Cinematography use tagged assets/Skills.
- Presets: list_menu_filters supplies curated IDs, then save_filter_preset.
- Video posters: supply posterUploadId on creation; set_video_poster edits only
  the thumbnail while preserving the owned video and its links.

list_assets remains bounded; follow list_assets_page until isDone true for an
audit. Include descendants when reading a world root. Empty matching pages can
have a continuation. Plain keyword matching and semantic search differ; inspect
the schema rather than assuming every field is in every read/search surface.

Check partial persisted results before retries. HTTP207/per-item partial records
carry existing IDs to repair; do not create a new duplicate. A stored reference is
not a verified final deliverable, nor a YouTube still exact-timestamp evidence.
There is no mandatory channel-qualification/evidence policy; preserve facts and
source provenance, and use editorial filters only when requested.

Discover live schemas each session. Local contract 1.5.0 becomes cloud behavior
only after backend/app publication and verification.
