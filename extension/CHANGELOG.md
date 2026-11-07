# Changelog

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
