# Save to Gallery (Chrome extension)

Saves web captures, X posts, Midjourney frames and local files into the
laniameda gallery, and works inside Midjourney: the moodboard dock, prompt
packs and the prompt queue. Manifest V3, loaded unpacked.

## Install

1. Get the folder: the `extension/` folder of a gallery checkout on `main`
   (Michael's Chrome loads it from the main checkout), or unzip
   `save-to-gallery-<version>.zip` into a folder that stays put.
2. Chrome → `chrome://extensions` → Developer mode on → Load unpacked → pick
   that folder.
3. Open the extension's side panel → settings: gallery URL
   `https://gallery.laniameda.space` and the extension token.

## Update

`git pull` the checkout (or unzip the new version over the same folder). The
extension reloads itself when the manifest version on disk changes (checked on
tab switch and shortcut, about once a minute); `chrome://extensions` → ↻ does
it at once. Reload open Midjourney tabs afterwards.

## Midjourney prompt queue (0.36)

Agents queue prompts in the gallery (MCP `queue_mj_prompts`), each with its
image prompts, style references, profile codes and params already set. On
midjourney.com a QUEUE pill sits bottom-right with the number left to send.

- **Next** (⌥⇧N) puts the next queued prompt in the Imagine bar: image URLs
  first, then the words, then `--sref`, `--profile` and the params. The card
  shows what the bar holds: AS QUEUED, or EDITED once you change it there.
- **Your own Enter, or your own click on Midjourney's send button, sends it.**
  The item is marked sent with the exact command, and the job id is picked up
  from the new row in your feed. If the bar empties some other way, it counts
  only when the job shows up in the feed, so a bar cleared by hand is never
  marked.
- After a send the next prompt of the thread goes in the bar by itself, unsent
  ("Sent 3/12 · next in bar · Enter to send"). The switch "Next in bar after
  send" in the panel turns that off. **Skip** (⌥⇧S) skips the prompt in the bar
  and puts the next one in; **Restore** brings a skipped one back.
- **Test** (⌥⇧T on the bar prompt, or on a card or thread header): the same
  prompt once per profile of its world plus once with no profile, as a new
  "Test · …" thread. **Random ×N** (1–2 profiles, up to 1 moodboard) and
  **Extreme ×N** (up to 3 profiles, 2 moodboards) make N mixes of one prompt.
- Thread settings: stylize slider, Raw/Standard, aspect, chaos, weird and exp
  for every prompt still to send ("mixed" when they differ). **Delete thread**
  removes every prompt of the thread from the gallery after a confirm.
- **Edit** changes the words, references, codes, params or note; **↑** moves
  an item up. Threads are grouped by world; pin a world or a thread to keep it
  on top. The counter shows the account's jobs in the last hour.

The extension never presses, clicks or submits anything on Midjourney (a
scripted Enter got the account flagged on 14 Nov 2026). No timers, no loops,
no background submits. Every job is `--v 8.2`; `--niji`, `--v 8.1` and older
are composed as `--v 8.2`, and the AndromedaCartoon profile is stripped.

## Midjourney bar: presets and Random (0.36)

- A preset goes into the prompt in the bar only when you click it or press its
  key (⌃⌥1–9). On an empty bar it shows NEXT and goes into the next prompt you
  type, once. Only typed prompts get the remembered moodboard and profiles;
  pasted, queued and Grow prompts stay as they came.
- **⌥R** gives the bar prompt a new random mix of this world's profiles and
  moodboard (1–2 profiles, up to 1 moodboard); **⌥⇧R** a bigger one (up to 3
  and 2). Words and params stay. The ⟳ Random button does the same.
- Esc, a click elsewhere, a page change or leaving the window closes every
  menu and tooltip of the bar.

## Fast edit (⌥F, 0.36)

Point at a Midjourney picture and press **⌥F** (or hold ⌥ and click EDIT).
Type the change or click a chip (Night, Wider shot, Close-up of the face,
Remove text and logos, Same place, other angle, Upscale 2K). Models: Seedream
5.5 (default), Krea 3, GPT Flare, Nano 2.1 (keys 1–4), 1–4 takes (⇧1–⇧4); the
price shows on Run. It runs on fal through the gallery with the owner's fal
key (`/api/extension/quick-run`, `convex/mjQuickRuns.ts`). Review keys: **1**
keep (saves to the gallery in the dock's world, with the Midjourney job as its
source), **2** drop, **E** edit that take again, **R** again, **B** put it in
the bar as an image prompt, **F** to Fantasy Studio as a held Seedance 2.5
draft (the local app on 127.0.0.1:5273; nothing runs, nothing is charged).
Hold Space to see the original. Recent keeps the last 20 runs.

## Describe: the shot, then the prompt (0.36)

- Side panel → **Describe**: drop a file or an image from any page, paste,
  pick a recent Midjourney describe, or right-click an image anywhere →
  *Describe to a prompt*. A describe Midjourney just answered on
  midjourney.com opens there by itself.
- The writer looks at the picture like a cinematographer and answers in short
  labelled lines: subject and action, shot size and angle, lens and depth of
  field, composition, light (source, direction, quality, time of day),
  palette, materials, setting and its architecture style, mood, medium. Each
  line has **Copy**; **Copy all** takes the lot.
- Then one Midjourney V8.2 prompt built from those lines (with the picture's
  `--ar`): **Put in bar** (the bar only, never Enter), **Queue**, **Copy**,
  **Save to gallery** (picture + prompt as inspiration in the world, on that
  click only). Midjourney's own Describe lines, when caught, are vocabulary.
- The extension only reads Midjourney's own Describe answer (and its local
  cache of earlier ones); it sends nothing. "Make it ours" is gone (17 Nov 2026).
- Below it, **Grow · recent pictures**: a click opens that picture's Grow
  card again in the Midjourney tab.

## The writer on your own Mac (0.33)

Grow, quick edit and the describer can write with Claude Code on the machine the
browser runs on, instead of a paid provider.

- Install once per Mac: `extension-writer/install.sh` (from the repo). It puts a
  small service on `127.0.0.1:47615`, kept running by the LaunchAgent
  `com.laniameda.writer`, which runs `claude -p` with no tools on Haiku 5.5,
  Sonnet 5.5, Opus 5.5 or Fable 5.2 (bridge 1.4.0: a refused or limited account is left out, a silent run hands over to the next account) using the long-lived sign-ins in `~/.config/claude-tokens/`.
- Where the writer runs and on which model is one pick for every tool (0.41,
  `writer-choice.js`): **This Mac** (Haiku, Sonnet, Opus, Fable through the
  bridge), **Cloud · fal** or **Cloud · Pika** (the gallery's keys), each
  cloud choice naming the model that provider runs: Cloud · fal · Haiku 5.5,
  Cloud · Pika · Haiku 4.5, Cloud · Pika · Fable 5.1 … DeepSeek V4.1 (text
  only) runs in the cloud only. The Grow card and Describe have one grouped
  list; the quick edit has a model chip and a place chip (MAC → FAL → PIKA);
  MJ settings → Writer has both, and the key row follows the cloud picked.
- The same tab shows each tool's system prompt (Grow, Describe, Quick edit) as
  the gallery builds it (`GET /api/extension/writer-prompts`), editable with
  Reset, the per-world notes added after it, and **Show last sent**: the full
  system prompt of the last answer, world files included.
- The writer never moves somewhere else by itself. When the chosen place fails
  (the bridge is not running, fal or Pika is out of credit or refuses the key)
  the card says so and offers the other place as one click (**Try Cloud · Pika
  · …**), which switches the pick and writes again. The default is This Mac; an
  old "Auto" reads as This Mac and an old "Cloud" as Cloud · fal.
- The bridge answers only the extension (the store copy and the unpacked copies
  found at install) and tools on the same Mac. It never opens Midjourney links:
  the extension sends the picture's bytes.
- Log: `~/Library/Logs/laniameda-writer.log`. Remove: `extension-writer/install.sh --remove`.

## Grow: one frame into a set (0.36)

- Point at a generated picture on midjourney.com and press **⌥X** (or hold ⌥
  and click the GROW tag on it). A card opens beside the picture; a coral
  ring marks the frame the writer sees.
- Moves: **1** Angles, **2** Close-ups, **3** Wides, **4** Cast, **5** Props,
  **6** Story (six beats with a logline), **7** World kit, **8** Cinematic
  scene (four moments from a real film in this world), **9** Cinematic
  location (four other places, each an establishing wide), **0** Replay (your
  last 10 Midjourney prompts rewritten one by one in this frame's look),
  **L** Location (six wide views of this place: establishing, reverse,
  doorway, high, dusk or night, one small figure; the place and light
  sentences stay word for word). Or type an idea and press Enter; **⌃** + the
  key runs a move steered by the typed idea.
- **Use image as**: *None*, *Style ref* (`--sref <frame>`), *Image ref* (the
  frame's link at the start) or *Edit* (`--edit <frame>`: Midjourney's Edit
  model, V8.2, reworks the frame toward each prompt; Put in bar and Queue
  carry it). Remembered.
- **Vary moodboards** (on by default): each result swaps one moodboard of the
  world for another, or adds one when the frame has none; taste profiles
  stay. Each result shows its change ("FOG → ROSE").
- **Replay previous prompts**: the writer also gets your last 10 Midjourney
  prompts (read from Midjourney's own history, at most once per 20 s, a read
  under a minute old is reused) and reuses their subjects and views in this
  frame's look.
- Every move follows the cinematic rules (shot size, lens, camera height,
  one motivated light); Dear Annete worlds add their own addendum.
- The writer gets the picture, the words of its prompt and the world's own
  files (`convex/writerBrief.ts`, `lib/writer-brief.ts`). The world menu
  starts on **Auto**: the world is read from where the frame is saved, else
  from its codes (`/api/extension/prompt-world`). It writes words only. The
  source command's `--sref`, `--profile` and other params are put back on
  every result by the gallery; `--seed` is dropped, AndromedaCartoon is never
  carried over and every result is `--v 8.2`.
- The card stays open while you work in the Imagine bar or the dock. A click
  elsewhere folds it into a pill "Grow · 6 prompts"; Esc or × closes it.
- Every run is kept per picture (40 pictures, 8 runs each). ⌥X on the same
  picture brings the card back with its runs: **[** and **]** step through
  them, **H** or *Recent* lists the pictures grown before. Queued results
  stay marked as queued.
- **↵** puts the selected prompt in the Imagine bar (never Enter), **Q**
  queues it, **A** queues the set as one MJ Queue thread "<World> · <set>",
  **C** copies, **E** edits, **D** drops, **R** again, **/** back to the idea.
- Rules and moves live in `lib/mj-expand.ts`; the card in `mj-expand.js`.

## Files

`background.js` service worker (gallery calls), `content.js` save UI,
`midjourney-adapter.js` Midjourney metadata, `moodboard-dock.js` the dock,
`prompt-packs*.js` phrase packs, `mj-queue-compose.js` + `mj-queue.js` +
`mj-queue.css` the queue, `mj-describe-hook.js` (page world: reads
Midjourney's Describe answers) + `mj-describe.js` (keeps them) +
`mj-describe-core.js` + `describe-panel.js` the describer, `mj-expand.js` Grow, `mj-randomize.js` profile mixes, `mj-fast-helper.js` fast edit. History: CHANGELOG.md.
