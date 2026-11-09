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
- `omniRef` / `characterRef`: V8.2 has neither; the Edit model replaced both.
  They are added (`--oref/--ow`, `--cref/--cw`) only when params pin `--v 7`
  or `--v 6`; otherwise the item carries a warning he sees.
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

`update_mj_queue_item {itemId, …}` edits text, title, note, references (lists
are replaced whole; null clears omni or character), codes and params; moves an
item with `position` (0-based in its batch); `status: skipped` sets it aside,
`queued` puts it back. Agents never set `sent`: that is recorded by the
extension after Michael's click.

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
