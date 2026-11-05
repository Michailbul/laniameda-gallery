# The morning newspaper: Michael's daily review of what agents did

Every morning at 07:30 Prague (05:30 UTC, a Convex cron) the gallery compiles
one edition of the newspaper from its own tables and shows it at
`https://gallery.laniameda.space/newspaper` (the latest) and
`/newspaper/<YYYY-MM-DD>` (one date, Europe/Prague). Michael reads it on his
phone: what needs him first, then what was done per world with thumbnails,
then the questions and decisions, then the agent's paragraph. When a Telegram
bot token is configured, the compile also sends him "Morning newspaper
<date>: N done, M need you — <link>".

The compile is pure facts: counts, ids, titles and links. The narrative is an
agent's job, written once a day with `write_newspaper`. The paper never
stars, publishes, features or deletes anything, and neither does the agent
writing it.

## What an edition holds (`get_newspaper`)

`newspaper:<id>`, `date`, `url`, `status` (`compiled` = facts only, `written` =
prose added), `compiledAt`, `compiledBy` (`cron`, `owner` or an agent label),
`window {since, until}` (the 24 hours before the compile; for an earlier
date, the 24 hours before 07:30 Prague that day), `counts {done, needsYou,
saved}`, `prose`, `writtenAt`, `writtenBy`, and `facts`:

- `worlds[]`: per world (`worldFolderId`, `key`, `name`), `changes` from the
  journal (`total`, `byOp` counts, up to 12 `summaries` with `changeId`, `op`,
  `summary`, `actor`, `session`), new `assets` (`count`, up to 12 items with
  `asset:<id>` as `assetId`, `thumbUrl`, `url`, `path`), new or changed
  `storybooks`, `moodboards` (with `drift`: items added or removed since the
  last recorded Midjourney sync, from `itemCount - mjSyncedItemCount`) and
  `characters`, `tasks {done, created, blocked, open}` and `openStacks`.
  Worlds come busiest first; a quiet world has zeros.
- `studio`: assets and tasks that belong to no world.
- `tasks.done / created / blocked[]`: `taskId`, `title`, `worldName`,
  `result` (excerpt; on a blocked task it is the question for Michael),
  `claimedBy`, `path`, `url`.
- `stacks[]`: open Inbox stacks with `cards`, `decided`, `agent`, `url`.
- `needsYou[]`: everything waiting on him, in order: open Inbox stacks with
  cards still undecided (`kind: stack`; a stack he has fully answered waits on
  the agent and stays in `stacks[]` only), blocked tasks (`kind: task`), draft moodboards that already
  hold images but are not in Midjourney (`kind: moodboard`). Each has `title`,
  `worldName`, a one-line `detail` and, for stacks and tasks, the `url`.
- `totals`: `done`, `created`, `blocked`, `open`, `changes`, `assets`,
  `openStacks`, `needsYou`.

Every `path` is relative (`/tasks?task=<id>`, `/inbox/<world>/<stack>`,
`/?asset=<id>`); the route returns `url` beside it, absolute.

## Writing the paper

1. `get_newspaper {}` (or `{date}`). `newspaper: null` means nothing was
   compiled for that date: `compile_newspaper {date?}` compiles it now.
2. Read the facts. Open what you need with `get_task`, `list_inbox_decisions`,
   `open_world`; do not re-count what the facts already say.
3. `write_newspaper {date, prose}`: markdown, plain prose. What mattered since
   yesterday (name the worlds and the `asset:` / `task:` / `stack:` ids), what
   you propose for today, and at most three questions for Michael. Short.
   Replaces earlier prose; the facts stay. The paper is a review, not a brief:
   no instructions to him, no praise.
4. Nothing else: the paper does not file tasks, close stacks or move assets.
   Work you notice goes through `create_task`.

An agent that writes the paper from a cron: `list_tasks {status: "open"}`
first, then `get_newspaper`, then `write_newspaper`, in one run.

## Tools

```text
get_newspaper     { date? }          the latest edition, or one date (YYYY-MM-DD, Europe/Prague); null when none
write_newspaper   { date, prose }    the narrative (markdown, ≤ 12,000 characters); the edition must exist
compile_newspaper { date? }          compile now from the tables; recompiling keeps the prose
```

Reads need `gallery:read`, writes `gallery:write`. The compile is also a
Convex internal function (`newspaper:compileNewspaper {ownerUserId, date?}`)
and the cron calls `newspaper:compileAll`, which reads the owner from the
deployment's `KB_OWNER_USER_ID` (or `NEWSPAPER_OWNER_USER_IDS`).

## In the gallery

Sidebar: Newspaper, under Tasks. Phone: the Search tab's browse sheet lists
Newspaper with the other sections. The page has a date picker (older / newer
editions), a Recompile button, and copy-ID chips on every stack, task,
moodboard, asset thumbnail and the edition itself (`newspaper:<id>`).
