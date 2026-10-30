# World filing rules

This is an owner-only skill resource. Its current full content is stored privately
as gallery agentInstructions data, rather than copied into the public repository
or a plugin bundle.

With an authenticated Gallery MCP, call get_skill_instructions with:

```json
{"resource":"references/worlds.md"}
```

Without a connector, use the authenticated client (Node or Bun):

```bash
node <this skill>/scripts/gallery.mjs get_skill_instructions '{"resource":"references/worlds.md"}'
```

The owner-issued token selects the gallery; gallery:read and owner access are
required. Never print or paste the token. Read references/web-access.md for setup.

The owner's copy is edited over the same connection: read it, change the text,
then `update_skill_instructions {resource: "references/worlds.md", content,
expectedSha256}` with the sha256 the read returned (a stale one is refused).
It holds the world table and gallery-wide rules only; a world's own rules are
its WORLD.md (`world_doc`). `open_world` with no arguments is the live list of
worlds and is always right when the two disagree.
If access is unavailable, request authorized access rather than using an old map,
private collection ID or deployment note from memory. Current human directions
supersede historical snapshots.
