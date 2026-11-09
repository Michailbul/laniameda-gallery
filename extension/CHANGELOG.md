# Changelog

## 0.29.0 (9 Nov 2026)

- Make it ours. When you run Describe on midjourney.com (drop an image to
  describe, or Describe on a picture), the extension reads Midjourney's four
  descriptions as they arrive (read-only: no extra request, nothing sent) and
  a MAKE IT OURS pill appears bottom-right. Its card writes our prompt from
  the picture, Midjourney's reading and the world's rules: the look's opening
  sentence, the subject as the subject, forms, materials, light, shot and
  lens, no real places, artists or brands, no negatives, the right params.
- Style lock: choose where the style words come from. Keep its look (the
  prompt describes the image's own style, to recreate it), Our style (the
  image's style words out, a gallery world style in: its lock, line,
  template and recipe codes), or Both side by side. Styles are the world's
  styles from the gallery, with their cover pictures.
- Each prompt: Put in bar, Queue (an MJ Queue item, thread "<world> ·
  Described", keeps the source picture and Midjourney's descriptions), Copy,
  Save to gallery (the picture as inspiration in the world, with the prompt
  and Midjourney's reading; only on that click).
- Our own describer: a Describe tab in the side panel. Drop a file or an
  image dragged from any page, paste one, pick one of the last Midjourney
  describes, or right-click any image → Describe to a prompt. Works without
  Midjourney's Describe (Haiku sees the picture) and uses its descriptions
  when the extension caught them for that image.
- Runs through the gallery's quick-edit agent (/api/extension/prompt-describe,
  Haiku 5.5 on fal, Pika when fal is blocked), with the world's system prompt
  from the MJ settings tab.

## 0.28.0 (9 Nov 2026)

- Restyles of locked location prompts show what they are: the place, the
  style ("in CAS STORYBOOK") and the mode (same prompt and seed, or same
  layout from the locked frame). An attached frame shows as a FRAME thumb.
- The command adds `--edit <frame>` (Midjourney's Edit model, V8.2) when an
  item restyles a locked frame. Still one job per click; nothing is sent by
  itself.

## 0.27.1 (9 Nov 2026)

- The MJ Queue tab reads the gallery every 4 seconds while it is open (was
  every minute), and at once when you come back to the window. Prompts an
  agent queues through MCP show up within seconds. The list redraws only
  when something changed, so it never flickers.

## 0.27.0 (8 Nov 2026)

- Keys for the Midjourney dock. While a prompt is being written: ⌥1–⌥9 add
  or remove the moodboard in that place, ⌥⇧1–⌥⇧9 the profile, ⌃⌥1–⌃⌥9 the
  preset; ⌥[ and ⌥] step through worlds, ⌥W opens the world list, ⌥S saves a
  preset. Hold ⌥ to see each chip's key on it.
- Every key is set in the side panel's new MJ settings tab (was Prompt edit):
  click a key, press the new one; Backspace clears it, Reset brings the
  defaults back, a key taken from another slot says so, ⌥E stays the quick
  edit's. Synced; open Midjourney tabs follow at once.
- The world picker no longer closes as it opens. It is the dock's own list
  now (arrows, Enter, Esc work), and picking a world keeps the prompt focused.
  The native list closed whenever the dock moved itself to stay on top.

## 0.26.2 (8 Nov 2026)

- A copy with no sign-in takes it from a local-config.json file next to the
  extension's files (git-ignored, left alone by the sync). Two copies loaded
  from one folder, or a reinstall, are signed in without pasting the token.
  A token saved in the popup still wins.

## 0.26.1 (8 Nov 2026)

- With the extension loaded twice in one browser, the quick edit box shows
  once instead of not at all: both copies share one hiding rule and the
  newest copy's box wins, as the dock already did.

## 0.26.0 (8 Nov 2026)

- The dock reads in labelled lines: a world with many boards shows them by
  family (FILM, HALLOWEEN, then MORE), each board with its cover picture; a
  small world is one MOODBOARDS line. PROFILES has its own line under them.
- A world's main profiles come first, the rest follow quieter after a
  hairline. Dear Annete: DA4, DA 5, DA V3, DA v8.2, DEAR ANNETTE 2, CINEMATIC,
  LOCATIONS. Shift-click a profile to move it into or out of the main group
  (saved per world, synced).
- An update now reaches open Midjourney tabs without a page reload: the new
  copy brings the dock, queue, quick edit and packs, and an older copy's dock
  and quick edit box hide. A copy whose extension was reloaded takes its
  dock away instead of fighting the new one.
- A world without moodboard codes says so on the moodboards line and still
  shows its profiles.

## 0.25.1 (8 Nov 2026)

- A preset carried into the next prompt only fills in settings the prompt
  does not have: a prompt arriving with its own --ar keeps it. Pasted or
  dropped prompts get no packs. Checked with the Midjourney queue: a queued
  prompt goes into the bar exactly as written, Send works, and the next
  prompt of your own gets the preset back.

## 0.25.0 (8 Nov 2026)

- Moodboards and profiles have the dock's first line to themselves, next to
  the prompt. A smaller second line holds the world, presets, Save, the flag
  and a quiet Packs button (closed by default).
- Presets: "+ Save preset" keeps the moodboard, profiles, settings (--ar,
  --s, --c, --w, --v, --raw, --style …) and packs in the prompt under a name,
  per world, synced across your Chromes (chrome.storage.sync). One click sets
  them all; a second click on the lit preset takes them out. An active preset
  sticks: every next prompt gets it after a submit. Hover shows the board's
  pictures and what the preset holds; × deletes, with Undo.

## 0.24.1 (8 Nov 2026)

- Packs sits next to the world, so the line never breaks around it; world
  names shorten in the dock ("DA — ART DECO", full name on hover) and chips
  are a touch tighter, so a full Dear Annete line fits on one row.

## 0.24.0 (8 Nov 2026)

- The Midjourney dock is one slim line (34 px, was about 230 px with the
  packs): world, moodboards, profiles, the flag and a Packs button. The packs
  open under the line on demand (over it when the prompt sits at the bottom),
  with a count of the packs in the prompt. Same obsidian, linen, coral and
  mono look as the quick edit.
- Packs show only in Dear Annete worlds (they are its lexicon).
- Switching the dock's world also switches the quick edit's system prompt
  (Dear Annete worlds → Dear Annete, Andromeda → Andromeda).
- Faster: one page watcher instead of two, no work on page changes while no
  prompt is being written, the settings-panel check cached, styles written
  only when they change, no 45-second polling (codes refresh when a prompt
  starts and they are older than 45 s, on a world switch and on ↻), and the
  world menu is no longer rebuilt (and closed) by a refresh. About 45% less
  script time while typing on a busy page.
- Hover sheet shows the thumb at once and swaps in the full picture; a failed
  thumb falls back to the full picture.
- The remembered flag is no longer lost when typing very fast after a submit.

## 0.23.0 (7 Nov 2026)

- Quick edit on midjourney.com: select words in the Imagine bar (or prompt
  text on the page) and a small ✎ Edit pill appears; click it or press ⌥E,
  type what to change, Enter. Haiku 5.5 (or DeepSeek V4.1) rewrites the
  selection, or the whole prompt when nothing is selected, and the bar gets
  the new text, still selected, with Undo (or ⌘Z in the box). Image links and
  parameters are kept. Page selections are copied, with Put in bar.
- World chip (DA / AN / —) and model chip (H / DS) on the box; a fourth side
  panel tab, Prompt edit, holds the world, the model and each world's system
  prompt (edit and it saves; Reset brings the default back).
- Runs through the gallery (/api/extension/prompt-edit): fal first, Pika when
  fal is blocked. Nothing is sent to Midjourney.

## 0.22.0 (7 Nov 2026)

- The Midjourney queue moved into the side panel: a third tab, MJ Queue,
  next to Add to gallery and Bookmark, in the panel's own look. Threads
  first (grouped by world, progress, left to send, copyable id); a thread
  opens with its prompts, To send / Sent / Skipped / All, ‹ › to step
  threads, Esc back. A strip on top says whether the tab is Midjourney
  Create and offers Open Create or Reload. Put in bar, Send (your click),
  Edit, Skip and the bar readback work as before; your own Enter in the bar
  still counts as Send. The floating box on midjourney.com is gone: the page
  script only does the bar work for the panel. ⌥⇧N on the page puts the
  next prompt in the bar while the panel is open.

## 0.21.0 (7 Nov 2026)

- Every thread has an id (thr-xxxxxxxx) with a copy chip in the thread
  header and the id in its rail row. Paste it to an agent: the gallery tools
  take it wherever a thread name goes.

## 0.20.0 (7 Nov 2026)

- Queue threads: each batch is a thread in a rail on the left of the queue
  panel, grouped by world, with a progress bar, how many prompts are left to
  send and when it last changed. Open threads come first; finished ones fold
  away (Open / All). The chosen thread fills the right side with To send /
  Sent / Skipped / All tabs and bigger reference pictures. A send shows in
  the rail at once. ⌥⇧↑ / ⌥⇧↓ step through threads; the rail hides with the
  button top left and remembers that.

## 0.19.1 (6 Nov 2026)

- Queue reference thumbnails show the whole image (wide lettering no longer
  crops to black) and load at once.

## 0.19.0 (6 Nov 2026)

- Midjourney prompt queue: a QUEUE panel on midjourney.com reads the prompts
  agents queued in the gallery. Inject fills the Imagine bar with the composed
  command and reads it back; Send presses Enter once on your click (or your
  own Enter counts); Edit saves changes to the gallery; Skip, Restore, move up;
  Next → / ⌥⇧N injects the next one; ⌥⇧Q toggles the panel. A sent item records
  its exact command and the job id seen in the feed.
- The moodboard dock no longer adds its remembered `-p` flag to an injected
  queue command. The dock and packs bars sit under an open queue panel.

## 0.18.2

- Midjourney saves carry no source tags (midjourney, midjourney-web/-explore/
  -profile/-teach, personalize).

## 0.18.1

- The moodboard dock retries when Chrome closes the message port and then
  asks the gallery directly.

## 0.18.0

- Type and medium pickers sit behind "set type or medium by hand"; the badge
  shows the manifest version.
