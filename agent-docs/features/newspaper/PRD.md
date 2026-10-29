# The morning newspaper

Branch `feat/newspaper`, 30 Oct 2026. Michael's words: "I was thinking that I
want to have the morning newspaper kind of, where I would receive the review
of what's done, with any questions and decision makings. Maybe with a mobile
app." He reads on his phone.

## What it is

One edition a day, compiled at 07:30 Prague from the gallery's own tables,
shown at `/newspaper` (latest) and `/newspaper/<YYYY-MM-DD>`, announced on
Telegram when a bot token is configured. The compile is pure facts with ids
and links; an agent adds the narrative through MCP. The paper never stars,
publishes, features or deletes anything.

## Data (`convex/newspaper.ts`, validators in `convex/newspaperValidators.ts`)

- `newspapers`: `ownerUserId`, `date` (Europe/Prague key), `compiledAt`,
  `since`, `until`, `facts` (JSON, `lib/newspaper-contract.ts`
  `newspaperFactsSchema`), `done`, `needsYou`, `saved`, `prose?`,
  `writtenAt?`, `writtenBy?`, `status` compiled | written, `compiledBy`,
  `createdAt`, `updatedAt`. Index owner/date.
- `compileFacts(ctx, owner, since, until)`: for the window, per world (the
  marked root collections): `worldChanges` grouped by op with the newest 12
  summaries; new assets (count, up to 12 thumbnails newest first, assigned to
  a world by the collections they sit in, otherwise studio); new or changed
  storybooks (`folders` kind storybook), moodboards (with
  `drift = itemCount - mjSyncedItemCount` when the board has a code) and
  characters; task counts. Studio-wide: tasks done, created, blocked (with
  the question), open and claimed counts; open Inbox stacks with card and
  decided counts; `needsYou` = open stacks + blocked tasks + draft boards with
  images. Every read is index-backed and takes at most 600 rows per table.
- `compileEdition` is idempotent on (owner, date): a recompile replaces the
  facts and keeps the prose. For today the window ends now; for an earlier
  date it ends at 07:30 Prague that day.
- Functions: `compileNewspaper` (internal, one owner), `compileAll` (internal,
  the cron's entry; owners from `KB_OWNER_USER_ID` or
  `NEWSPAPER_OWNER_USER_IDS`), `notify` (internal action, Telegram),
  `compile` (owner, on demand), `getNewspaper` (latest or by date),
  `listNewspapers` (the date picker), `writeNewspaper` (the prose).
- `convex/crons.ts`: `crons.daily("compile the morning newspaper",
  { hourUTC: 5, minuteUTC: 30 }, internal.newspaper.compileAll)`. 05:30 UTC is
  07:30 Prague in winter and 06:30 in summer; the cron is fixed to UTC.

## Notification

`compileAll` schedules `newspaper.notify` after each edition. It sends
"Morning newspaper <date>: N done, M need you — https://gallery.laniameda.space/newspaper/<date>"
to the owner's Telegram chat (their Telegram id) through the bot in
`TELEGRAM_NOTIFY_BOT_TOKEN` (legacy fallback `TELEGRAM_BOT_TOKEN`), the same
variable `convex/notifications.ts` uses for the "Saved" messages. Without the
token it logs one line and skips. No new secret. The shared helpers moved to
`convex/telegram.ts` because `notifications.ts` runs in the Node runtime and
the newspaper's action does not.

## Agent surface

`/api/agent/newspaper` actions `get` (`gallery:read`), `write`, `compile`
(`gallery:write`), registered in `lib/server/mcp-agent-routes.ts`. MCP tools
`get_newspaper {date?}`, `write_newspaper {date, prose}`,
`compile_newspaper {date?}`. `presentNewspaper` (`lib/newspaper-contract.ts`)
parses the facts and adds an absolute `url` beside every relative `path`.
Reference `skills/laniameda-gallery/references/newspapers.md`; SKILL.md
version 1.16.0; one sentence in `GALLERY_MCP_INSTRUCTIONS`.

## UI (`components/newspaper/newspaper.tsx`)

Phone-first, one column (max 42 rem on desktop), the gallery's own language
(`app/tokens.css`, the Inbox primitives): masthead with the date, a date
picker over the existing editions, status badge and Recompile; four headline
counts; **Needs you** first (each row a tap to its Inbox stack or task, with a
copy-ID chip); **Done since yesterday** per world: thumbnail strip, tasks done
with result excerpts, storybook / board / character badges (drift in coral),
journal ops and summaries; **Questions and decisions**: blocked tasks with the
question in full, open stacks; **From the agent**: the prose. Empty edition:
"Compile now". Links use `lib/gallery-routes.ts` (`/w/<world>`,
`/moodboards/<id>`, `/storybooks/<id>`, `?asset=`). Sidebar: a Newspaper
link under Tasks; phone: a Newspaper section in the browse sheet.

## Verification

`bun run lint`, `bun run typecheck`, `bun test` (tests/newspaper.test.ts:
helpers, contract, schema and cron, compileFacts over a fixture vault,
editions; tests/newspaper-mcp.test.ts: the tools and the route they reach;
the pre-existing failures on main stay as they were), `bun run build`. Convex
functions pushed with `bunx convex dev --once` pinned to
`dev:perfect-buffalo-375` before the merge; the schema change is additive.

## Not built here

An agent cron that writes the prose every morning (the tools are there; the
schedule lives in Michael's Claude setup). Email delivery. A read/unread dot
on the Newspaper link. Per-world editions.
