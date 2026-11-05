# Tasks: the agent task queue

Branch `feat/tasks-queue`, 29 Oct 2026. Michael's brief: "I want the gallery
to have a queue of tasks, so that we can put tasks to it that an agent can
fetch and fulfill, by a cron job or by inspecting. The gallery already has an
Inbox for me to review. The goal is to make the gallery a place where I can
review, inspect, comment on any asset, and an agent would catch up with that
later, so we have a continuous loop."

## What it is

A `tasks` table with a timeline (`taskEvents`), seven MCP tools, one agent
route, a `/tasks` page, a Tasks tab in every world, a Tasks link with a badge
in the sidebar, and two hooks that create tasks without anyone asking: an
owner comment on an asset, and the first answer on an Inbox stack.

The loop: Michael comments or decides → a task appears → an agent lists,
claims (a lease), works, completes with links → Michael sees the result in
/tasks and closes it, or comments, which reopens it for rework.

## Data (`convex/tasks.ts`, validators in `convex/taskValidators.ts`)

- `tasks`: `ownerUserId`, optional `worldFolderId` (a root collection; absent
  = studio-wide), `title` (160), `brief` (markdown, 6,000), `status` open |
  claimed | done | blocked | archived, `priority` 1–3, `createdBy` (`owner` or
  `agent:<label>`), `assignee`, `claimedBy`, `claimedAt`, `leaseUntil`,
  `result` (markdown, 6,000), `links` (typed handles), `source` manual |
  comment | inbox | newspaper, `sourceRef`, `ingestKey`, `needsRework`,
  `dueAt`, `createdAt`, `updatedAt`. Indexes: owner/status/createdAt,
  world/status/createdAt, owner/ingestKey, owner/updatedAt.
- `taskEvents`: `taskId`, `kind` create | claim | release | status | comment |
  edit, `author`, `body`, `from`, `to`, `createdAt`. Index task/createdAt.
- Functions: `listTasks` (world or all; status active by default), `getTask`
  (row + resolved links + events), `createTask` (idempotent on `ingestKey`),
  `claimTask` (lease; refuses a live claim by someone else; renews for the
  same claimant; takes over a lapsed one), `releaseTask`, `completeTask`
  (done | blocked, merges links), `commentTask` (owner comment on done →
  open + needsRework; on blocked → open; claimant comment renews the lease),
  `updateTask` (Michael's Done / Reopen / Archive and edits),
  `countOpenTasks` (badges). `worldTaskSummary` feeds `getWorldContext`
  (`tasks: {open, claimed, blocked, next[5]}`) and the AGENT view.
- World tasks are journaled (`task.create`, `task.update` with the full row
  before/after). Undo is not implemented for them yet.
- Hooks: `assetComments.addAssetComment` (owner, not `source: "inbox"`) files
  `Comment on asset:<id>: <first line>` with ingestKey `comment:<commentId>`
  in the asset's world. `inbox.decideInboxCard` and `setInboxCardComment`
  file `Apply decisions: <stack title>` with ingestKey `inbox:<stackId>` and
  keep its brief's decided count current while the task is still open.
- Asset delete cascade (`assets.ts`) strips the asset's link from tasks and
  keeps the task.

## Agent surface

`/api/agent/tasks` actions list, get, create, claim, release, complete,
comment (reads `gallery:read`, writes `gallery:write`); registered in
`lib/server/mcp-agent-routes.ts`. Zod in `lib/tasks-contract.ts`, limits in
`lib/tasks.ts`. MCP tools `list_tasks`, `get_task`, `create_task`,
`claim_task`, `release_task`, `complete_task`, `comment_task`. The token
label becomes `agent:<label>` as `createdBy` / default claimant. Reference:
`skills/laniameda-gallery/references/tasks.md`.

## UI

- `/tasks` (`app/tasks`, `components/tasks/task-queue.tsx`): header with the
  counts, world chips, groups Needs you (coral) / In flight / Open, a
  collapsed Done tray, a New task composer. Rows: priority dot, title, world
  chip, source, assignee, age. A row opens the panel: copy-ID chip, status,
  result (boxed, coral when blocked), brief, links with thumbnails, timeline,
  comment box, buttons Done / Reopen / Archive. Desktop: sticky side panel;
  phone (390 px): a full-screen sheet. `?task=<id>` opens a task (the `url`
  the tools return).
- World page: `CollectionTab` gains `"tasks"` (count badge, coral when
  something is blocked); `WorldTasksTab` renders the same queue filtered to
  the world. Sidebar: a Tasks link with the active count.

## Verification

`bun run lint`, `bun run typecheck`, `bun test` (tests/tasks.test.ts,
tests/tasks-mcp.test.ts, world-agent-doc updated). Convex functions are
pushed with `bun scripts/convex-dev.ts --once --env-file <pinned env>` before
the merge; the schema change is additive.

## Not built here

Undo for `task.*` journal entries; the morning newspaper (`source:
"newspaper"` is reserved); a "note to self" toggle to comment without
filing a task; task links in the asset detail panel; voice comments on tasks.
