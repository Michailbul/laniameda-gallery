---
description: Show recent gallery world changes grouped by session, with how to undo each session or change
argument-hint: "[world key or name] [session label]"
---

# World journal

Arguments: $ARGUMENTS

Follow the gallery-worlds skill of this plugin. The first argument, if any, is a world (key, name
or id); the second, if any, is a session label. A single argument that matches no world is a
session label.

1. Call `world_journal` with the world and session given (neither = all worlds), `limit: 50`.
2. Group the entries by session label, newest session first. Entries without a session go under
   "no session".
3. For each session show: label, world, time range, number of changes, actor, and one line per
   change (time, operation, target, summary, changeId).
4. Under each session, show how to undo it:
   `world_undo {session: "<label>", world: "<key>", dryRun: true}`, then the same call without
   `dryRun`. For a single change: `world_undo {changeId: "<id>", dryRun: true}`.
5. To see one change in full, `world_journal {changeId}` returns its before and after.

Read only. Never run `world_undo` from this command; Michael asks for an undo in plain words.
