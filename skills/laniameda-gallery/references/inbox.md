# The world Inbox: decisions Michael makes, cards agents prepare

Every world (a root collection) has an Inbox, shown in the gallery as
**Decisions**: a badge with the open count on the world in the sidebar, and
the pages `https://gallery.laniameda.space/inbox` (all worlds) and
`/inbox/<worldId>` (one world). Cards arrive in **stacks** ("Duplicates · 12",
"Daylight V2 · 31 candidates"). Michael opens a stack and answers one card at
a time, on his phone or with the keyboard. Agents prepare; he decides; agents
apply and learn.

## Rules for agents

- **State facts, never taste.** Evidence says "same Midjourney job, four
  takes" or boxes the six-fingered hand. It never says which image is better,
  ranks options or hints at an answer. No suggestion chips.
- One decision per card. Put only what the decision needs on it.
- Confident work never reaches him: file the unambiguous cases yourself and
  post only the ones that need his eye.
- Read every answer with `list_inbox_decisions`, including his card comments
  and notes on images. Voice notes come as `audioUrl` (with `audioDurationMs`
  and `audioContentType`): download and transcribe them yourself.
- When a pattern repeats in his decisions, propose it as a **rule** card.
- Close the stack with `close_stack` once you have applied and learned from
  it. Delete a stack only when he names it for deletion.
- His first answer on a stack files a task `Apply decisions: <stack>` in the
  queue (`list_tasks {source: "inbox"}`); claim it, apply, close the stack,
  then `complete_task`. See `tasks.md`.

## Card types

| type | images | evidence | his answers |
|---|---|---|---|
| `sort` | 1 | optional | drag onto one of 2–9 `targets` (keys 1–9), or later |
| `duplicates` | 2–8 | `matches`: same job, same prompt, hash distance, similarity | per image keep or delete; then **stack** (one stack under the cover he picks), **keep all**, or delete the marked and keep the rest |
| `artifact` | 1 | `defect.box` (0–1 coordinates), `defect.note`, `priceUsd`, `priceNote` | fix · keep as is · out |
| `ab` | 2 | optional; `labels` such as "Board v1" / "Board v2" | the winner · neither |
| `choose` | 2–12 | optional | pick one |
| `rule` | 0–12 evidence images | `ruleText` (required), `evidence.text` | yes · no · not yet |

Every card also takes **later** (skip, decide later), undo, a 100 % zoom on
any image, a **comment** on the card (text plus voice), and a **note** on any
single image. Image notes are asset comments: they stay with the image
everywhere and `get_gallery_item`, `list_asset_comments` and
`list_inbox_decisions` return them.

Sort targets:

| kind | A drop on it… |
|---|---|
| `moodboard` | appends the image to that gallery moodboard (once) |
| `collection` | adds the asset to that collection (a style branch, a shelf); other memberships stay |
| `option` | records the choice only |
| `out` | files the asset into the world's hidden `Out` collection (it leaves the gallery grid; nothing is deleted) |

## What a decision changes

The gallery applies these itself, and undo reverses exactly what the decision
changed:

- sort onto a moodboard or collection: the image is added (undo removes it
  only if the decision added it);
- out (sort target or artifact answer): membership in the world's hidden Out collection;
- duplicates **stack**: the kept images become one stack (an asset pack of kind
  `stack`) with his cover first; the grid shows one card with a count. Every
  image, prompt and membership stays. Prompt-pack syncing never pulls a stack
  apart.
- duplicates **delete**: real deletion, confirmed once per group in the card,
  through the gallery's admin-checked delete route. Undo cannot bring deleted
  images back; `list_inbox_decisions` reports them under `deleted`.

Everything else (fix, keep, winner, pick, yes, no, not yet, option targets) is
recorded for you to act on: repair the image, update the board, write the rule.

## Tools

```text
post_inbox_cards { worldFolderId, stackTitle | stackId, ingestKey?, note?, agent?, cards (1–100) }
  card: { type, key?, question?, assetIds, labels?, targets?, evidence?, ruleText? }
  target: { kind: moodboard | collection | option | out, label?, moodboardId?, folderId? }
list_inbox_stacks { worldFolderId?, status? (open | closed), limit? }
list_inbox_decisions { stackId }
close_stack { stackId, reopen? }
delete_inbox_stack { stackId }        needs gallery:delete and Michael's word
find_similar_groups { folderId, includeChildren?, maxDistance? (0–24, default 6), minSize?, limit? }
```

A stack holds at most 300 cards and 600 images. Posting with the same
`ingestKey` appends to the same stack; a card `key` already in the stack is
skipped, so a routine can re-post safely. Stack ids are `stack:<id>`, cards
`card:<id>`; the result carries the stack's `url` to send him.

## Finding duplicates

Every image gets a perceptual hash (a 64-bit dHash of its card thumbnail) a
minute after it is saved; older images are filled in by a backfill.
`find_similar_groups` clusters one world or collection by hash distance and
returns the groups largest first, each with `assetIds` ready for a duplicates
card and `samePrompt`. One call scans at most 1,300 pieces, newest first; a
bigger world comes back with `truncated: true`, so scan its shelves one by one. Distances: about 4 bits for the takes of one job, 10
for the same shot reworked, 20 for the same subject. Add what else you know
as evidence (same Midjourney job, same prompt). The gallery's own grid has
the same clustering as the view option **Similar**, where Michael can stack a
cluster, send it to the Inbox as a duplicates card or select it.

## Example: a nightly duplicates pass

```json
{
  "worldFolderId": "<DEAR ANNETE root id>",
  "stackTitle": "Duplicates · 3",
  "agent": "Hygiene routine",
  "ingestKey": "hygiene-duplicates-2026-10-20",
  "cards": [{
    "type": "duplicates",
    "key": "dup-j57a…-j57b…",
    "assetIds": ["asset:j57a…", "asset:j57b…", "asset:j57c…"],
    "evidence": { "matches": [
      { "kind": "same-job", "label": "same Midjourney job 3f2a19" },
      { "kind": "same-hash", "label": "pHash distance", "score": 3 }
    ] }
  }]
}
```
