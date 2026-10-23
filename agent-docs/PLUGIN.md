# laniameda-gallery plugin: maintainers' note

The Claude Code plugin lives in `plugin/`. The marketplace that lists it is
`.claude-plugin/marketplace.json` at the repo root (marketplace `laniameda`, plugin source
`./plugin`). Design: `agent-docs/features/world-harness-1.0/PLAN.md`.

## Layout

```
.claude-plugin/marketplace.json        marketplace "laniameda" → ./plugin
plugin/
  .claude-plugin/plugin.json           name, version, userConfig.gallery_token (sensitive)
  .mcp.json                            hosted MCP "gallery", Bearer ${user_config.gallery_token}
  skills/gallery-worlds/SKILL.md       the world loop
  commands/world.md                    /laniameda-gallery:world
  commands/journal.md                  /laniameda-gallery:journal
  hooks/hooks.json                     SessionStart → scripts/session-start.sh
  scripts/session-start.sh             version, token set?, world list via open_world (4 s, exit 0)
  README.md
```

Do not add a CLAUDE.md inside `plugin/`; plugins do not load one.

## How it stays current

The plugin is thin. It carries the world loop and the tool names; everything that changes with
the backend contract (storybooks, moodboards, intake, ingest, data model) is served live by the
gallery through `get_skill_instructions`, from `skills/laniameda-gallery/` as deployed. A contract
change ships with the gallery deploy and reaches every user without a plugin release.

Bump the plugin version only when files under `plugin/` change. Users stay pinned to the
version in `plugin.json` until it changes. Keep the version in `plugin.json` only, never in
`marketplace.json`.

The plugin is public. No collection, asset, story or profile IDs, no tokens and no world rule
text go into any file here. World names (DEAR ANNETE, ANDROMEDA) and keys are fine.

## Release

1. Change the plugin files. Update the skill when an MCP tool name or argument it teaches changes.
2. Bump `version` in `plugin/.claude-plugin/plugin.json` (semver: patch for wording, minor for a
   new command or skill section, major for a changed loop).
3. Validate:
   ```bash
   claude plugin validate ./plugin --strict
   claude plugin validate .
   sh -n plugin/scripts/session-start.sh
   ```
4. Try it locally: `claude --plugin-dir ./plugin -p "/laniameda-gallery:world"`.
5. Merge to `main`. Users run
   `claude plugin marketplace update laniameda && claude plugin update laniameda-gallery@laniameda`,
   or get it through marketplace auto-update.
