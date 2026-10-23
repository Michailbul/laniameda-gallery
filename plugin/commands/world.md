---
description: Open one of Michael's gallery worlds and give a 10-line briefing (identity, styles and locks, moodboards needing Midjourney sync, last 5 changes, open questions)
argument-hint: "<world key or name>"
---

# Open a world

World: $ARGUMENTS

Follow the gallery-worlds skill of this plugin.

1. If no world was given, call `open_world {}` and list the worlds (key, name, counts) as a short
   table. Stop there and ask which one.
2. Otherwise call `open_world {world: "$ARGUMENTS"}`. If the world is not found, show the list
   from `open_world {}` with the closest names.
3. Reply with a briefing of 10 lines at most, in this order:
   - **Identity:** one line from WORLD.md: what the world is, its key and name.
   - **Styles:** each style tag with its branch and a few words of its lock.
   - **Moodboards needing sync:** boards whose Midjourney copy is behind the gallery (name, code,
     how many items behind), or "all in sync".
   - **Profiles:** the profiles with a role here and their `--profile` flags.
   - **Storybooks:** names with story counts.
   - **Last 5 changes:** from the journal, each as date, session, one-line summary.
   - **Open questions:** the open questions from WORLD.md, plus anything in the context that
     needs Michael's decision.
4. End with one line naming the LEARNINGS.md entry count against its cap of 40.

Read only. Make no writes from this command.
