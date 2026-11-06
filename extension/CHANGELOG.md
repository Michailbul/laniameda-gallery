# Changelog

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
