# Tasks: the queue between Michael's review and the agents' work

The gallery keeps a task queue, shown as **Tasks** in the sidebar (with the
count waiting) and at `https://gallery.laniameda.space/tasks`. Every world
also has a Tasks tab next to Instructions and Journal. A task is one piece of
work: a title, a markdown brief, a priority, typed links to the objects it
concerns, and a timeline of claims, comments and status changes.

The loop:

1. Michael reviews. He comments on an asset in the detail panel, answers an
   Inbox stack, or files a task by hand. **A task appears by itself**:
   titled with the first line of his comment (source `comment`, the asset in
   its links and brief) or `Apply your picks: <stack title>` (source `inbox`,
   one per stack).
2. An agent (a session, or a cron run) calls `list_tasks` and sees the queue.
   `open_world` also carries the world's counts and its five newest open tasks.
3. The agent `claim_task`s one, works, leaves `comment_task` progress notes,
   and `complete_task`s it with a result that names the `asset:` / `story:` /
   `stack:` ids it produced. A question for Michael is `complete_task` with
   `blocked: true` and an `ask` (below): the task moves under **Needs you**.
   Never stop silently.
4. Michael reads the result in /tasks. He closes it, or comments: his comment
   on a done task reopens it flagged **rework**; on a blocked task it is the
   answer and the task is open again. On an ask he clicks an option (or presses
   its letter): his comment reads `Picked B: Subject first` and the task is open
   again.

## Two layers: what Michael reads, what agents read

/tasks opens on **Decide**: the calls Michael owes, one at a time (blocked
questions first, then done work to accept or send back). Each answer moves to
the next; the end is an All done screen that sends him back to the gallery.
Your `title`, `summary`, ask and linked pictures are all he sees there, so a
task he cannot answer from them alone stalls. **Everything** is the full wall
(open and claimed tasks too), with a **Human view** and an **Agent view**
(every task as markdown). Write each task twice:

| Field | For | Rule |
|---|---|---|
| `title` | Michael | Plain words, under 80 characters: "Run the bigger prompt test", "Make Mila's character sheet". |
| `summary` | Michael | One plain line under the title: why it matters, or (when done) what he will see now. Required from agents on create and on done. |
| links (assets) | Michael | The frames the task is about or produced. The wall shows them big. |
| `ask` | Michael | Blocked only: the question and its picture options (below). |
| `brief`, `result` | Agents | Markdown with ids, paths, tools, settings, plans, tables. Agent view only. |

The gallery refuses an agent's title or summary with a file path, an id
(`asset:…`, long ids), a tool or field name (`set_moodboard_midjourney`), a
command flag (`--profile`), backticks or markdown. Experiment codes and
jargon ("EXP-002 main cells", "S1 vs S2", "stylize 600") are not caught by the
check but break the same rule: write what it is in his words. Fix an existing
title or summary with `edit_task`.

Bad: `Refresh codes of the six boards edited 29 Oct: one job each with --profile m<id>, record with set_moodboard_midjourney`
Good: title `Update the six Midjourney moodboards you edited`, summary
`Midjourney still uses the old versions; one job each brings them in line.`

## A question for Michael is pictures and a one-click pick

Michael answers by looking, at art-direction level. He has no time to read a
report to find out what is being asked. Set 1 Nov 2026 after a pilot came back
as a scoring table and three paragraphs of experiment jargon ("S1 vs S2, seed
4201, stylize 600, 64 grids") with no pictures: he could not tell what to do.

`complete_task {blocked: true}` needs an `ask`; the gallery refuses it otherwise.

- `question`: one line, under 140 characters, plain words, a call he can make
  by looking. "Which street look is better?" Never experiment names, settings,
  seeds, counts or scores.
- `options`: 2–4, each a few words (`label`, 60 characters at most) and the
  frames that show it (`assetIds`, up to 6). Put the frames in the same order
  in every option (street, close-up, object) so the rows compare across the
  columns. An option may have no frames when it is an action ("Run the bigger
  test"), but the ask must show at least one frame somewhere.
- `recommended: true` on your pick, one at most. It is marked "Agent pick".
- `assetIds` on the ask itself: context frames shown above the options, when
  the options are actions.
- `result`: the reasoning, tables and numbers, if any. He sees it only when he
  opens Details. Write it for the next agent, not for him.
- Every option must lead somewhere you can act on without a second question.
  Fold a follow-up into the options ("Keep our way, stop testing" / "Run the
  bigger test") instead of asking two things.
- Frames must be saved in the gallery first (`save_asset`): an ask shows his
  own assets, nothing else.

```text
complete_task {
  taskId: "task:t9", blocked: true,
  ask: {
    question: "Two ways of writing the prompt. Which set looks better?",
    options: [
      { label: "A · place first (our way)", assetIds: ["a1", "a2", "a3"] },
      { label: "B · subject first (the guide)", assetIds: ["b1", "b2", "b3"] },
      { label: "Same to me: keep A, stop testing", recommended: true },
      { label: "Can't tell: run the bigger test" }
    ]
  },
  result: "Pilot scores and the plan for the bigger run …"
}
```

## Rules for agents

- **Start every gallery session and every cron run with `list_tasks`**
  (status `active`, or `open` to see only what nobody holds). Inside a world,
  `open_world` already shows what waits there.
- **Claim before working.** A claim is a lease (default 120 minutes). Another
  agent's live claim is refused with who holds it and until when; a lapsed
  lease can be taken over. Claiming again or commenting renews yours.
- **Complete with a result, always.** Done: `summary` (one plain line, what
  he will see now), the frames as `links`, and a `result` for agents with
  what changed and the ids produced. Blocked: an `ask` (one line, picture options);
  the reasoning goes in `result`.
  `release_task` with a note when you cannot do it this session.
- A comment task: act on the comment, reply on the asset with
  `add_asset_comment`, then complete the task. An inbox task: read
  `list_inbox_decisions`, apply what is his to apply, learn, `close_stack`,
  then complete the task.
- File work you find but cannot do now with `create_task` (a stable
  `ingestKey` makes it safe to re-run). Say who should take it in `assignee`
  when it matters.
- Pass the journal `session` on `complete_task` so the world journal shows the
  work next to the task.

## Fields

`task:<id>` is the handle. `title` and `summary` are Michael's (plain words),
`brief` and `result` the agent's. `world` is the world's key, name or collection id;
a task without one is studio-wide. `status`: `open` (waiting), `claimed` (held
under a lease, `claimedBy`, `leaseUntil`), `blocked` (needs Michael; `result`
is the reasoning, `ask` the question with its picture options), `done` (`result` says what changed), `archived`. `priority`:
1 now, 2 next (default), 3 later. `createdBy` is `owner` or `agent:<label>`
(the agent token's label). `source`: `manual`, `comment` (sourceRef = the
comment id), `inbox` (sourceRef = the stack id), `newspaper`. `links`: typed
handles `{kind: asset | story | stack | moodboard | character | collection |
doc | url, id, label?}`; `get_task` resolves them to titles and thumbnails
and marks the ones that are gone. `needsRework` is set when Michael reopened a
done task with a comment.

## Tools

```text
list_tasks { world?, status? (active | open | claimed | blocked | done | archived | all), assignee?, source?, limit? }
get_task { taskId }
create_task { world?, title, summary, brief?, priority?, assignee?, links?, dueAt?, ingestKey?, session? }
edit_task { taskId, title?, summary?, brief? }
claim_task { taskId, assignee?, leaseMinutes? }
release_task { taskId, note?, assignee? }
complete_task { taskId, result?, summary?, blocked?, ask?: { question, assetIds?, options: [{ label, assetIds?, recommended? }] }, links?, session?, assignee? }
comment_task { taskId, body, assignee? }
```

Rows come back in queue order: blocked, then claimed, then open by priority,
newest first inside a group. Each carries `url` (the task open in /tasks).

A claim is held by a label (`claimedBy`), by default this token's own agent
label. If you claimed under another label (`claim_task {assignee}`), pass the
same `assignee` on `comment_task`, `release_task` and `complete_task`: the
check is label against label, and a lease held by one label cannot be
completed by another until it lapses.

## Example: a cron run

```text
list_tasks {status: "open"}                      → task:t1 "Comment on asset:a1: Fix the hands" (DEAR ANNETE)
open_world {world: "dear-annete"}                → rules, style lock, the same task under tasks.next
claim_task {taskId: "task:t1"}
get_task {taskId: "task:t1"}                     → brief = his comment, link asset:a1
… repair, save_asset → asset:a2 …
add_asset_comment {assetId: "asset:a1", body: "Repaired hands: asset:a2"}
complete_task {taskId: "task:t1", summary: "The hands are fixed: five fingers, ring kept.", result: "Repaired the hands with Krea 3: asset:a2. $0.06.", links: [{kind: "asset", id: "a2"}], session: "hands-2026-10-29"}
```
