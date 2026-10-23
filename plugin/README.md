# laniameda-gallery

A Claude Code plugin that connects an agent to [laniameda.gallery](https://gallery.laniameda.space)
and teaches it to work inside Michael's story worlds the way it works in a code repo. Each world
has a `WORLD.md` (its CLAUDE.md), a `LEARNINGS.md` filled from Michael's picks and comments,
shelves, storybooks, moodboards and Midjourney profiles. Every agent write goes into a journal
that can be read and undone by session.

What it ships:

| Part | Name | Does |
|---|---|---|
| MCP server | `gallery` | The hosted gallery MCP at `https://gallery.laniameda.space/api/mcp`, authenticated with your token. |
| Skill | `gallery-worlds` | The world loop: open, read, look, act with a session label, check the journal, learn, undo. |
| Command | `/laniameda-gallery:world <world>` | A 10-line briefing on one world. |
| Command | `/laniameda-gallery:journal [world] [session]` | Recent changes grouped by session, with undo calls. |
| Hook | SessionStart | Prints the plugin version, whether the token is set, and the world list. |

## Install

1. Get a token: sign in at https://gallery.laniameda.space/agents and create an agent token.
2. Add the marketplace and install:

   ```bash
   claude plugin marketplace add Michailbul/laniameda-gallery
   claude plugin install laniameda-gallery@laniameda --config gallery_token=<your token>
   ```

   Or inside a session: `/plugin marketplace add Michailbul/laniameda-gallery`, then
   `/plugin install laniameda-gallery@laniameda`, which asks for the token. The token goes to the
   OS keychain.

## First things to try

```text
/laniameda-gallery:world dear-annete
/laniameda-gallery:journal dear-annete
Find the tram-stop plates in DEAR ANNETE and show me a contact sheet.
```

## Update

```bash
claude plugin marketplace update laniameda
claude plugin update laniameda-gallery@laniameda
```

To update automatically, turn on auto-update for the `laniameda` marketplace in
`/plugin` → Marketplaces. The detailed gallery references (storybooks, moodboards, intake) are
served live by the gallery through `get_skill_instructions`, so they stay current between plugin
releases.

## Troubleshooting

- **401 / "Invalid or expired agent token"**: the token is wrong, expired or revoked. Create a new
  one at `/agents` and set it with `/plugin` → laniameda-gallery → configure, or reinstall with
  `--config gallery_token=...`.
- **`marketplace add` fails with a git or SSH error**: you have no GitHub SSH key set up. Run it
  with HTTPS: `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1 claude plugin marketplace add Michailbul/laniameda-gallery`.
- **No world list at session start**: the hook prints "unreachable" or "open_world is not
  deployed" when the gallery did not answer in 4 seconds or runs an older server. The MCP tools can
  still work; try `/laniameda-gallery:world`.

## Tools

| Tool | Job |
|---|---|
| `open_world` | World list, or one world's docs, styles, shelves, storybooks, moodboards, profiles and recent journal. |
| `world_doc` | List, read, write, delete or see history of `WORLD.md`, `LEARNINGS.md`, `docs/*.md`. |
| `world_file` | File up to 100 assets between a world's shelves and change tags; refuses filing into a second world. |
| `world_shelf` | Create, rename or regroup shelves and storybooks inside a world. |
| `mj_profiles` | Midjourney personalization profiles and their role in each world. |
| `world_journal` | What changed, by world, session or time. |
| `world_undo` | Revert one change or a whole session, dry run first. |
| `search_gallery`, `find_similar`, `list_assets_page`, `preview_assets` | Find and look at assets; all take `world`. |
| `list_moodboards`, `save_moodboard`, `add_moodboard_items`, `set_moodboard_midjourney` … | Moodboards, journaled per world. |
| `list_stories`, `save_story`, `update_story` | Stories and story beats, journaled per world. |
| `get_skill_instructions` | The full live gallery skill and its references. |

## Privacy

The plugin sends requests only to `https://gallery.laniameda.space/api/mcp`, with your agent
token as a Bearer header. It reads and writes the gallery data of the account that owns the token
and nothing else. The token is stored in the OS keychain by Claude Code and is never printed by the
plugin or its hook. The plugin collects no analytics and sends nothing to third parties. Gallery
data stays private to its owner unless the owner publishes it in the gallery.

MIT licensed.
