# Tasks: the queue between Michael's review and the agents' work

The gallery keeps a task queue, shown as **Tasks** in the sidebar (with the
count waiting) and at `https://gallery.laniameda.space/tasks`. Every world
also has a Tasks tab next to Instructions and Journal. A task is one piece of
work: a title, a markdown brief, a priority, typed links to the objects it
concerns, and a timeline of claims, comments and status changes.

The loop:

1. Michael reviews. He comments on an asset in the detail panel, answers an
   Inbox stack, or files a task by hand. **A task appears by itself**:
   `Comment on asset:<id>: <first line>` (source `comment`) or
   `Apply decisions: <stack title>` (source `inbox`, one per stack).
2. An agent (a session, or a cron run) calls `list_tasks` and sees the queue.
   `open_world` also carries the world's counts and its five newest open tasks.
3. The agent `claim_task`s one, works, leaves `comment_task` progress notes,
   and `complete_task`s it with a result that names the `asset:` / `story:` /
   `stack:` ids it produced. A question for Michael is `complete_task` with
   `blocked: true`: the task moves under **Needs you**. Never stop silently.
4. Michael reads the result in /tasks. He closes it, or comments: his comment
   on a done task reopens it flagged **rework**; on a blocked task it is the
   answer and the task is open again.

## Rules for agents

- **Start every gallery session and every cron run with `list_tasks`**
  (status `active`, or `open` to see only what nobody holds). Inside a world,
  `open_world` already shows what waits there.
- **Claim before working.** A claim is a lease (default 120 minutes). Another
  agent's live claim is refused with who holds it and until when; a lapsed
  lease can be taken over. Claiming again or commenting renews yours.
- **Complete with a result, always.** Done: what changed and the ids
  produced, also as `links`. Blocked: the one question Michael has to answer.
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

`task:<id>` is the handle. `world` is the world's key, name or collection id;
a task without one is studio-wide. `status`: `open` (waiting), `claimed` (held
under a lease, `claimedBy`, `leaseUntil`), `blocked` (needs Michael; `result`
is the question), `done` (`result` says what changed), `archived`. `priority`:
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
create_task { world?, title, brief?, priority?, assignee?, links?, dueAt?, ingestKey?, session? }
claim_task { taskId, assignee?, leaseMinutes? }
release_task { taskId, note? }
complete_task { taskId, result, blocked?, links?, session? }
comment_task { taskId, body }
```

Rows come back in queue order: blocked, then claimed, then open by priority,
newest first inside a group. Each carries `url` (the task open in /tasks).

## Example: a cron run

```text
list_tasks {status: "open"}                      → task:t1 "Comment on asset:a1: Fix the hands" (DEAR ANNETE)
open_world {world: "dear-annete"}                → rules, style lock, the same task under tasks.next
claim_task {taskId: "task:t1"}
get_task {taskId: "task:t1"}                     → brief = his comment, link asset:a1
… repair, save_asset → asset:a2 …
add_asset_comment {assetId: "asset:a1", body: "Repaired hands: asset:a2"}
complete_task {taskId: "task:t1", result: "Repaired the hands with Krea 3: asset:a2. $0.06.", links: [{kind: "asset", id: "a2"}], session: "hands-2026-10-29"}
```
