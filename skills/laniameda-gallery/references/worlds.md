# World filing rules

This is an owner-only skill resource. Its current full content is stored privately
as gallery agentInstructions data, rather than copied into the public repository
or a plugin bundle.

With an authenticated Gallery MCP, call get_skill_instructions with:

```json
{"resource":"references/worlds.md"}
```

Without a connector, use the authenticated Bun client:

```bash
bun <this skill>/scripts/gallery.mjs get_skill_instructions '{"resource":"references/worlds.md"}'
```

The owner-issued token selects the gallery; gallery:read and owner access are
required. Never print or paste the token. Read references/web-access.md for setup.
If access is unavailable, request authorized access rather than using an old map,
private collection ID or deployment note from memory. Current human directions
supersede historical snapshots.
