# Website skill discovery and current agent contract

Requested 7 October 2026 alongside the full gallery audit. Contract version
1.5.0; MCP server version 0.3.0. These source changes become deployed behavior
only after publication and live verification.

- /llms.txt points to the canonical Skill, manifest, task references and Bun clients.
- /skills/laniameda-gallery/SKILL.md serves the exact deployed public source.
  manifest.json reports the deployed version, hashes and access levels.
- Generic references, scripts/gallery.mjs and scripts/gallery-client.mjs are
  allowlisted public resources. Unlisted paths and admin scripts reject.
- references/worlds.md and references/maintenance.md require gallery:read plus
  the configured owner. Content is stored in private owner-scoped
  agentInstructions, read through strict signed Convex auth, and served no-store.
  Public repository/plugin copies only explain how to fetch that policy.
- Read-only get_skill_instructions retrieves this instruction package.
  get_skill reads a saved reusable Skill. MCP initialization links discovery;
  this change adds no gallery UI.
- Private policy replacement requires the last-read SHA; exact retries are
  idempotent. No world names, collection IDs or creative rules are hardcoded
  in server code, and future public repository deployments retain private policy.
- Complete asset inventories use list_assets_page cursors/isDone; menu filters
  are discoverable; collections support children/root storybooks; create_skill
  supports markdown-only knowledge and optional prompt/media steps.
- set_video_poster edits only thumbnails. Partial writes preserve IDs to repair;
  Story changes require last-read revisions; OAuth codes are single use.

The preexisting character-sheet direction and full world policy were preserved
in ignored recovery copies for private publication. No private world IDs,
credentials or private inventory belong in the public commit. Persistent memories
were inspected during the audit and were not edited.

Acceptance: resource existence/hashes match exact bytes; public reads work;
owner-only reads reject anonymously/other owners and return no-store; path
traversal rejects; live schema discovery includes new capabilities; signed
owner reads/writes work while unsigned owner arguments reject; upload/poster,
partial retry and revision guards behave as documented. Publishing and live
verification are coordinated separately from this documentation change.
