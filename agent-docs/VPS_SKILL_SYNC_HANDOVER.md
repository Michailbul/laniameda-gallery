# VPS and remote skill synchronization

Updated 7 October 2026. This replaces the retired separate ingest/query installer
recipe. The canonical package is skills/laniameda-gallery. Read
DEVELOPMENT_WORKFLOWS.md and authenticated references/maintenance.md first.

A cloud/remote agent uses the hosted Gallery MCP or the dependency-free Bun
gallery.mjs/gallery-client.mjs with LANIAMEDA_GALLERY_AGENT_TOKEN. It does not need
Michael's owner ID, Convex database URL or signing private key. Start with
check_connection and live schema discovery. /llms.txt and manifest.json provide
the deployed instruction version; worlds/maintenance are authenticated resources.

For a disposable standalone install, use bun run skills:install:github after
confirming its URL and source revision. Local-path fallback uses
bun run skills:install:local; report that it is local-path based. Preserve dirty
changes; do not automatically checkout/reset/pull a conflicting branch. Updating
the general skills catalog can affect unrelated packages, so scope a release
update to the requested package when supported.

For packaged plugins, update the plugin source/version/marketplace and reinstall
through the plugin manager. A versioned cache is a snapshot, not editable source.
Do not copy private full world policy into a public plugin; ship the authenticated
fetch bootstrap. Report separately: GitHub commit/main status, website manifest
version, runtime link/copy location and packaged plugin version.

Never print credential env variables. Verify presence and authenticated access
without exposing the value. Exact source/publication evidence belongs beside the
implementation audit; project memories change only on explicit user request.
