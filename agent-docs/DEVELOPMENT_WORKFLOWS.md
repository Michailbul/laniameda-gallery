# Development and skill synchronization

Updated 7 October 2026. Use Bun. Read PROGRESS/OBSERVATIONS/schema and branch-local
feature documents before implementation. Historical PRDs do not initiate new work.

## Daily work

```bash
bun run dev
bun run lint
bun test
bun run typecheck
```

Next runs on localhost:3317. Canonical cloud Convex is dev:perfect-buffalo-375,
serving real gallery data. The sanitized bun run convex:dev command is cloud work;
only run a schema/function push when authorized. Explicit isolated local-backend
work must select its own mode. Check inherited CONVEX_* env before any backend run.

## One instruction package

Canonical public source: skills/laniameda-gallery. The old separate ingest/query
skills were merged. .agents/.codex/.claude/.openclaw local views point to this source
through symlinks; changing the repo source updates those views immediately.
Packaged plugin/remote clients receive versioned release snapshots and need a
source release/update. Do not overwrite a plugin cache and call it published.

Detailed world/maintenance policy belongs in private agentInstructions resources,
served through authenticated get_skill_instructions. Public files contain fetch
bootstraps. Replacing a private policy requires its last-read hash; preserve the
7 October character-direction additions when updating it. Never commit private
snapshots, tokens, signed slots or full env files to public GitHub/plugin bundles.

```bash
bun run skills:install:local
bun run skills:install:github
bun run skills:update
```

These installers target disposable standalone runtime copies. Do not reinstall
over a healthy local symlink just to refresh it. Confirm the configured GitHub
URL/revision rather than an old organization URL in a handover. The website
/llms.txt + manifest gives the deployed contract; source commits and deployment
are distinct states. Use the exported gallery-client.mjs in custom Bun scripts
to iterate/fetch/filter complete pages instead of writing a new auth/HTTP bridge.

## Verification and publication

Contract changes update skill refs and data-model.md in the same change. Run
lint/tests and relevant type/runtime checks; generated types must match backend
functions/schema. Keep implementation docs on the feature branch. Do not publish
until the concrete changes are tested and the current user authorization covers
the push/deployment. Verify cloud tools after publication; passing local tests
does not update an installed plugin or a remote website.

See MCP_AGENT_ACCESS.md, AUTH.md and ENV_MATRIX.md for current boundaries.
