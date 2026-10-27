# Gallery harness 1.0 — plan

Branch `release/gallery-plugin-1.0`. Audited live on 23 Oct 2026 (CLI, token auth).
Private IDs and world text stay in the gallery; this public file names worlds only.

## What the audit found

| # | Finding | Effect on an agent |
|---|---|---|
| A1 | No explicit "world". 42 root collections; worlds (DEAR ANNETE …) and shelves (ART, LOVE, DESIGN …) look the same. | Isolation cannot be enforced; "the world" is a guess. |
| A2 | All world rules sit in one private `references/worlds.md` (42 k chars, 11 worlds, 182 lines). No write tool. | Every task loads every world; nothing can learn. |
| A3 | 17 storybooks are **root** collections named `WORLD · Title`; storybooks are forbidden from nesting. | Storybooks are not children of their world. |
| A4 | 31 assets sit in two worlds: 12 Dear ↔ Daddy generated outputs (transferred cast whose Dear links were never removed), 19 outside inspirations cross-filed into Retro Cyberpunk. | Leaks. |
| A5 | Midjourney profiles exist only in a local JSON (`moodboard-map.json`, 9 profiles with codes and roles). Moodboards are native (20) but 6 show gallery/Midjourney item-count drift. | Agents cannot read which profile a world uses. |
| A6 | No journal, no undo for agent writes. Stories keep revisions; nothing else does. | Mistakes are permanent. |
| A7 | `list_characters` returns 0; cast lives in shelves and Story directories. | Out of scope for 1.0 (creative work); open_world indexes cast shelves. |
| A8 | VAMPIRE DIARIES is a root of kind `storybook` used as a world. | Cannot hold shelves or storybooks. |
| A9 | Session MCP failed with 401 while the CLI worked with the same token: the client sent the static header before the helper. | Plugin uses `userConfig` (sensitive) for the header. |

## Design

### World = a marked root collection
`folders.worldKey` (slug, unique per owner) marks a root collection as a world. Everything
under it (its children) belongs to it. Shelves like ART and LOVE are not worlds.

### Isolation (enforced in Convex, not in prose)
- An asset may belong to at most one world. Filing that would add a second world is refused
  (legacy violations are not made worse; `open_world` lists them).
- Moodboard items, story asset links and storybook members must not belong to another world.
- A story's collection and its storybook must be in the same world.
- Storybooks are children of exactly one world (group `Storybooks`), never root.
- Profiles are owner-level records with per-world uses; a world only sees its own uses.

### World docs: the world's "repo files"
Table `worldDocs` (path, body, revision). Fixed shape, small:

| Path | Cap | What goes in |
|---|---|---|
| `WORLD.md` | 8,000 chars | The world's CLAUDE.md: identity, canon pointers, styles, rules (dated, sourced), open questions. |
| `LEARNINGS.md` | 40 entries / 6,000 chars | One-line dated learnings from iterations, each with a source. |
| `docs/<name>.md` | 8 docs, 12,000 chars each | Optional depth (tags vocabulary, Midjourney stacks …). |

Caps are enforced by the server. A write over a cap is refused with "promote or prune first".

### Learning loop (small, explicit)
1. After an iteration with Michael's picks, comments or Inbox answers, the agent adds at most
   3 learnings to `LEARNINGS.md`: `- L-014 · 2026-10-23 · <learning> · src: comment asset:… `.
2. A learning Michael stated or confirmed twice is **promoted** into a `WORLD.md` rule and
   removed from `LEARNINGS.md`. A contradicted learning is deleted.
3. At the cap, the agent must promote or prune before adding.
4. Every write is a journal entry with the full before/after; any one can be undone.
Taste stays Michael's: learnings record what he chose, never what the agent prefers.

### Journal + undo
Table `worldChanges`: world, actor, session label, op, target, summary, `before`, `after`.
Written in the same transaction as the change by every world write: docs, filing, shelves,
storybooks, moodboards (fields + items), profiles, stories in the world. `world_undo` restores
one change or a whole session from `before`, refusing when the target changed since.

### MCP surface (7 new tools + a `world` filter)
| Tool | Job |
|---|---|
| `open_world` | No args: the world list. With a world: WORLD.md, LEARNINGS.md, doc index, styles with locks, moodboards with codes and sync state, profiles with roles, storybooks with their stories, shelves with counts, recent journal. One call. |
| `world_doc` | list / read / write / delete / history of a world doc. |
| `world_file` | Move, add, remove up to 100 assets between a world's shelves, plus tags; isolation-guarded; `move` lifts an asset out of its other world. |
| `world_shelf` | Create / rename / regroup a shelf or a storybook inside a world. |
| `mj_profiles` | list / save / retire Midjourney profiles and their per-world roles. |
| `world_journal` | What changed: by world, session, time. |
| `world_undo` | Revert one change or a session (dry run first). |

`search_gallery`, `preview_assets`, `find_similar`, `list_assets_page` take `world` (key, name or
id): it scopes to the world root and all its shelves. Moodboard tools write the journal.

### Plugin `laniameda-gallery` 1.0 (folder `plugin/`, marketplace at repo root)
- `.claude-plugin/plugin.json` with `userConfig.gallery_token` (sensitive) → MCP header.
- `.mcp.json`: hosted HTTP MCP.
- `skills/gallery-worlds/SKILL.md`: the world loop. Detailed references stay live on the
  gallery (`get_skill_instructions`), so contract changes ship with the gallery, not the plugin.
- `hooks/hooks.json` SessionStart: checks the token and the deployed skill version.
- Commands: `/laniameda-gallery:world`, `/laniameda-gallery:journal`.

### Gallery UI
World page gets a **Docs** tab (WORLD.md, LEARNINGS.md, docs) and a **Journal** tab (feed of
changes with Undo per entry and per session). Storybooks show in the world's Storybooks group.
Public world pages never list storybook children.

## Restructure (journaled; undo plan = the journal)
1. Mark the 12 worlds with `worldKey`.
2. Re-parent the 17 root storybooks under their worlds, group `Storybooks`, drop the
   `WORLD ·` name prefix.
3. VAMPIRE DIARIES: storybook kind → plain world.
4. The 31 assets already in two worlds stay as they are and are listed for Michael: 12 named
   Daddy cast pieces that the 19 Oct Dear Annete reorganization filed into Dear's cast and
   wardrobe shelves (the 9 Oct policy puts them in Daddy only), and 19 outside inspirations
   cross-filed into Retro Cyberpunk. The guard stops any new ones.
5. Seed `WORLD.md` for every world from its worlds.md section, style locks and project files;
   worlds.md shrinks to gallery-wide filing rules plus the world index.
6. Import the 9 Dear Annete profiles with their roles.
No asset is deleted. Nothing is published or unpublished.

## Build tracks
A backend + MCP (lead) · B plugin package + skill · C gallery UI (Docs, Journal) ·
D world-doc drafting (private, from worlds.md) · E critic after ship.

## Questions for Michael (asked once, at the end)
1. Twelve pieces (eleven named Daddy cast studies and one Baroque interior) sit in both
   DEAR ANNETE and DADDY ISSUES. Which world owns them? Default: unchanged.
2. Nineteen outside inspirations cross-filed between Retro Cyberpunk and Daddy / Andromeda:
   which world keeps them? Default: unchanged.
3. DEAR ANNETE — ART DECO is its own world sharing Dear Annete's cast and bible. Keep it a
   separate world (current), or fold it back as a style of DEAR ANNETE?
