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

## Midjourney prompt queue (0.19)

Agents queue prompts in the gallery (MCP `queue_mj_prompts`), each with its
image prompts, style references, profile codes and params already set. On
midjourney.com a QUEUE pill sits bottom-right with the number left to send.

- **Inject** writes the full command into the Imagine bar: image URLs first,
  then the words, then `--sref`, `--profile` and the params. The card shows
  what the bar now holds: AS QUEUED, or EDITED once you change it there.
- **Send** presses Enter once in the bar for you; your own Enter in the bar
  counts too. One job per click. The item is marked sent with the exact
  command, and the job id is picked up from the new row in your feed.
- **Edit** changes the words, references, codes, params or note and saves
  them to the gallery. **Skip** sets an item aside, **Restore** brings it back,
  **↑** moves it up.
- The tab follows the gallery live: new prompts from agents show within a
  few seconds while it is open.
- **Next →** or ⌥⇧N injects the next queued prompt. ⌥⇧Q opens or closes the
  panel.

Nothing is sent without your click: no timers, no loops, no background
submits. V8.2 has no omni or character reference (the Edit model replaced
both); an item that carries one says so and leaves the flag out.

## Describe → our prompt (0.29)

- On midjourney.com, run Describe as usual. A **MAKE IT OURS** pill shows
  bottom-right with the picture; its card shows how Midjourney read the image
  and writes our prompt from it. The extension only reads Midjourney's own
  Describe answer (and its local cache of earlier ones); it sends nothing.
- **Style words come from:** *Keep its look* (the image's own style,
  described, so the prompt recreates it), *Our style* (the image's style
  words out, the chosen gallery world style in: lock, line, template,
  `--sref`/`--profile`/params from its recipe) or *Both*.
- Each result: **Put in bar** (the bar only, never Enter), **Queue** (MJ
  Queue item with the source picture and Midjourney's descriptions),
  **Copy**, **Save to gallery** (picture + prompt as inspiration in the
  world, on that click only).
- Side panel → **Describe**: drop a file or an image from any page, paste,
  pick a recent Midjourney describe, or right-click an image anywhere →
  *Describe to a prompt*. Same controls; works without Midjourney's Describe.

## Files

`background.js` service worker (gallery calls), `content.js` save UI,
`midjourney-adapter.js` Midjourney metadata, `moodboard-dock.js` the dock,
`prompt-packs*.js` phrase packs, `mj-queue-compose.js` + `mj-queue.js` +
`mj-queue.css` the queue, `mj-describe-hook.js` (page world: reads
Midjourney's Describe answers) + `mj-describe.js` + `mj-describe-core.js` +
`describe-panel.js` the describer. History: CHANGELOG.md.
