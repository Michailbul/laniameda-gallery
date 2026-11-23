# Midjourney prompt queue

Agents prepare Midjourney prompts; Michael sends them. The queue holds each
prompt with everything already set (image prompts, style references, profile
codes, params) so he only reviews and clicks Send in the extension's side
panel (MJ Queue tab) beside midjourney.com. Every job is his own click (or his own Enter in the
Imagine bar), one job per click. Never automate submitting, never build a
loop, timer or background sender on top of this: Midjourney blocks accounts
for scripted use (see the Midjourney pacing rules in CLAUDE.md).

## Threads

A batch is a **thread**: one line of work (a direction, a round), e.g.
"Dear Annete · the monster's hand · round 2". Name it `<World> · <direction> ·
round N` and keep one thread per agent session's direction, so the panel
stays organized. The extension shows threads in its side panel (tab MJ Queue, next to Add to
gallery and Bookmark), grouped by world, with what is left to send. Every thread has a stable id, `thr-` + eight hex digits
(a hash of the label, the same in the gallery and the extension). Michael
copies it from the panel and pastes it to an agent; pass it as `batch` to
`queue_mj_prompts` (items join that thread) or to `list_mj_queue` (read only
that thread). `list_mj_queue` returns `threadId` on every batch and item.
The agents' Midjourney Chrome on the iMac runs the same extension with the
same settings (LaunchAgent `com.laniameda.mj-chrome`), so a prompt queued here
shows in Michael's panel on every machine and a send on one shows on all.

## Queue a batch

`queue_mj_prompts {batch, world?, items[]}`, up to 50 items per call. A batch
is a label Michael reads ("Dear Annete · name lettering studies"); items with
the same label join that batch after its last item. Each item:

- `title`: a few plain words for him ("The letter-writer's hand").
- `prompt`: the prose only. No URLs and no flags in it.
- `imagePrompts[]`: `{url | assetId, weight?}`; placed first in the command.
  One `--iw` per prompt: the first weight given counts.
- `styleRefs[]`: `{url | assetId | code, weight?}` → `--sref a::2 b c`.
- `profileCodes[]`: moodboard or profile codes → `--profile vtrctg9 …`
  (`m<id>` for a Midjourney moodboard id).
- `params`: every other flag as typed: `--ar 3:1 --draft --relax --stylize 250`.
  `--draft` and `--relax` are valid prompt params in V8.2 (draft makes a
  24-image grid there). `--turbo` and `--q` are not V8.
- The version is always **V8.2** (Michael, 15 Nov 2026: "never use mj v8.1,
  do not let it happen"; V7 and older were banned on 11 Nov). Leave `--v` out
  or write `--v 8.2`. Params with `--v 8.1` / `--version 8.1`, `--v 7` or
  older are stored as `--v 8.2` (`lib/mj-version.ts`), the item keeps
  `replacedVersion` and warns "v8.1 is not used: switched to v8.2", so a v8.1
  job can never be sent. The extension's composer and the writer bridge
  apply the same rule. `--niji` is a separate model and stays as written.
- `omniRef` / `characterRef`: V8.2 has neither; the Edit model replaced both.
  `--oref` is never added; `--cref` only with `--niji 6`. Otherwise the item
  carries a warning he sees: attach the picture as an `editRefs` image instead.
- `editRefs`: images attached for the Edit model (`--edit url`, V8.2, up to
  four), written after the params. A restyle of a locked frame uses it.
- `note`: plain words for him: what to look for in this one.
- `ingestKey`: stable key; repeating it returns the existing item unchanged.

References must be public image URLs Midjourney can fetch. Pass gallery images
as `asset:<id>`: the gallery resolves the public R2 URL and a thumbnail.
Upload local reference files first (prepare_uploads, then save_assets into
the world, tagged reference/inspiration, never public), then queue their ids.

The answer returns each item's `ref` (mjq:<id>), the composed `command` and
`warnings`. Read the command back before telling Michael the batch is ready.

Restyles of locked location prompts (references/locked-prompts.md) are
queued by `restyle_locked_prompts`, not by hand: their items carry
`lockedPromptId`, `placeLabel`, `styleLabel` and `restyleMode`, and the panel
shows place · style · mode.

## Read and edit

`list_mj_queue {batch?, world?, status?, includeDone?}` returns batches with
counts and items in order: references with thumbnails, command, warnings,
status (`queued`, `injected` = in his Imagine bar, `sent`, `skipped`),
`sentAt`, `sentCommand` (the exact command he sent, including any change he
made in the bar) and `jobId` when the extension saw the job appear.

Archived threads (20 Nov 2026): Michael's Delete in the extension archives a
thread; nothing is erased. Archived threads leave every list; read them with
`list_mj_queue {archived: true}` (with `batch` for one thread's prompts, sent
commands and job ids). `archive_mj_thread {batch, restore?}` archives a thread
(label or `thr-…`) or, with `restore: true`, puts it back. Queuing new prompts
into an archived thread's label brings the whole thread back. Recover from the
archive when he asks for an old round; never archive a thread he did not ask
to clear.

`update_mj_queue_item {itemId, …}` edits text, title, note, references (lists
are replaced whole; null clears omni or character), codes and params; moves an
item with `position` (0-based in its batch); `status: skipped` sets it aside,
`queued` puts it back. Agents never set `sent`: that is recorded by the
extension after Michael's click.

## Chat and runs (23 Nov 2026)

Every thread has its own **chat** with Michael and a series of **runs**
(run 1, run 2 …). Both show under the thread's title in the extension's MJ
Queue tab and on the gallery's Queue page, live.

**Runs.** Every prompt belongs to a run (`run` on the item, 1 when unset;
`runs` on the batch is the newest). A rerun copies prompts into the next run
with a new recipe; the earlier runs stay exactly as they were, with their sent
commands, job ids and filed frames. Each copy carries its own profile codes,
srefs and params, and `requeuedFrom` points at the original, so a frame is
always traceable to the exact combination (board + profile + keyword) that
made it. File results per run as before (file_run_results,
file_restyle_results read each item's own settings).

- `read_mj_thread {batch}`: the thread's runs (each with `settings`, what its
  prompts carry, e.g. `e6pj8eo ejo6q4d · stylize 300 · chaos 25 · 16:9 · hd`,
  its `opening` (the keyword opening its prompts share), and for reruns
  `label` (what changed), `recipe`, `note`, `fromRun`), the chat (`messages`,
  `waiting` = Michael's unanswered ones) and the prompts numbered #1, #2 …
  with run, status, command and job id, and `look`: every code the thread uses
  by its moodboard or profile name (`used: true`) plus the world's other
  moodboards and active profiles, to pick by name.
- `rerun_mj_thread {batch, fromRun?, items?, recipe?, prompts?, note?}`:
  every prompt of the latest run (or of `fromRun`, skipped ones left out; or
  only `items`, from any run) is copied, queued, as the next run. `recipe`
  holds only what changes:
  `profileCodes` (replace; [] removes all), `addProfileCodes`,
  `removeProfileCodes`, `srefs` (codes, `code::weight` or image URLs; [] removes
  all), `params` (a whole new params line), `stylize`, `chaos`, `weird`, `ar`
  (null removes the flag), `raw`, `hd` (true/false), `opening` (swaps the
  thread's shared first sentence, e.g. "Painted storybook animation frame.",
  or puts it in front; "" removes it). `prompts: [{itemId, prompt}]` gives
  some copies new words. `note` says why, in plain words.
- `edit_mj_thread {batch, recipe, items?}`: the same recipe on the prompts
  still to send, in place (no new run). Sent and skipped ones keep theirs
  (`leftAlone`): rerun them instead.
- Nothing is sent: a rerun only queues. Michael sends every job.

**Chat.** Michael writes to the agent in the thread ("make the next ten
darker", "add a reverse shot of the patio", "swap the profile to CAS Main 1",
"rerun all at stylize 750"). His message is stored first (`status: waiting`);
then the writer (the extension's pick: This Mac, Cloud · fal or Cloud · Pika,
the same routes as Grow; on the website fal or Pika) answers with a reply and
operations on the thread (edit, add, skip, restore, move, recipe on prompts to
send, rerun), which the gallery checks and applies; the answer lists what
changed, one line each ("Edited #3", "Run 2 queued: 39 prompts · stylize 750",
"Not done: #4 is sent: rerun it to change it"). If the writer fails, the
message stays waiting with why, and the card offers the other place.

Agents on MCP answer the same chat:
1. `read_mj_thread` and look at `waiting` and the newest `messages`.
2. Make the change with the queue tools (update_mj_queue_item,
   queue_mj_prompts into the same thread, edit_mj_thread, rerun_mj_thread).
3. `reply_mj_thread {batch, text, replyTo?, changes?, run?}`: a sentence or
   two in plain words and what you changed, one line each. `replyTo` (the
   message id, `msg:<id>` or bare) closes that message; left out, the reply
   closes every waiting one.

Prompts in the chat follow the house rules: describe what the camera sees,
never names of characters, places or coined terms; keep the camera distance.

## In Midjourney (the extension, 0.22+)

The queue is the MJ Queue tab of the extension's side panel (next to Add to
gallery and Bookmark). It lists threads (grouped by world, what is left to
send, copyable id); a thread opens with its prompts. A strip on top says
whether the active tab is Midjourney Create. Per item: Put in bar writes the
composed command into the Imagine bar and shows what the bar holds (AS QUEUED,
or EDITED when he changed it); Send presses Enter once for him; Edit changes
the item in the gallery; Skip; ↑ moves it up. Next → (⌥⇧N, also on the page)
puts the following queued item in the bar. After a send the item is marked
sent and the job id is taken from the new row in his feed (the page only;
nothing is asked of Midjourney's API).

## On the gallery website

The same queue is a page in the gallery, for running prompts by hand from any
device (phone included). It reads the same rows as the extension: a change in
one shows in the other (the page live, the panel on its next refresh).

- One world: the world's **Queue** tab, `https://gallery.laniameda.space/w/<world>/queue`
  (also reachable from every collection inside the world).
- Every world: `https://gallery.laniameda.space/queue`, threads grouped by world.
- One thread: add `?thread=thr-xxxxxxxx`. `queue_mj_prompts` and
  `list_mj_queue` return this link as `url` on the batch and on every item:
  link Michael there when a batch is ready ("ready to send: <url>").

Threads sit in a rail (To send / All); a thread shows each prompt with its
reference thumbnails, title, note, warnings and the full command (tap to read
it whole), COPY, and COPY ALL for what is left to send. **Mark sent** records a
prompt he ran by hand (`status: sent`, `sentCommand` = the copied command), so
the extension and the agents skip it; Undo sent puts it back to queued. Every
thread and prompt has a copyable id (thr-…, mjq:…) to paste to an agent. The
page never submits anything to Midjourney.

## Cinematic shots shelf (shot layouts)

CINEMATIC › CINEMATIC SHOTS holds film frames Michael keeps as shot layouts.
Each frame is the image reference; its description is a shot card:
`CINEMATIC SHOT · <title>`, the cinematography label, a breakdown (size and
lens, camera, composition, staging, light) and a style-neutral
`Base prompt`. Tags: `cinematic-shot` plus shot types (extreme-wide,
over-the-shoulder, low-angle, planimetric …). To use one in a world, put the
world style's opening sentence in front of the base prompt, add that style's
codes, and attach the frame in Midjourney V8.2 Edit so the layout holds.
The extension's writer (quick edit, Grow) reads the shelf by itself when a
request asks for cinematic shots, framing or a camera angle
(convex/cinematicShots.ts, lib/cinematic-shots.ts). Save a new shot with the
same card layout so the writer can parse it.

The Shots switch (Grow card row "Shots", quick edit chip; one setting,
`writerShots` in the extension's local storage) decides how: Off; Auto (the
default: the closest shots when the request asks for shots, framing or an
angle); Random (every Grow run draws random layouts, one per prompt; a quick
edit draws one when it asks for a shot or an angle). The Grow card's "from"
picks the collection: CINEMATIC SHOTS (default), CINEMATIC, or any
collection under them, each with the collections under it. Frames without a
shot card are used by their agentDescription or description. The card's
status line says what was read, e.g. `cinematic shots (4 random · NERVY …)`.
