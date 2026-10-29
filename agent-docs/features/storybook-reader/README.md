# Storybook reader: the record read as blocks

Branch `feat/storybook-reader`, 29 Oct 2026. From the UX audit of the same
night (finding F6, P1): the storybook panel showed the record verbatim in one
paragraph flow. STORY / CAST / LOCATIONS were plain words, asset ids and CDN
URLs sat inline, the "1 blocking gap" was never listed, and the book's own
frames were not shown. On a phone it was ten screens of body text.

## What ships

- `lib/storybook-reader.ts`: `parseStorybookRecord({ name, description,
  script, worldName })` turns the folder description and the attached script
  Story into a `ReaderModel`: title, world, status and blocking count,
  duration, medium, look chips, draft kind, logline and hook, beats (number,
  time range, text, the asset ids and "missing" notes from BEATS TO
  REFERENCES), cast / locations / props as labelled items with their asset ids
  and character codes, gaps as a checklist (kind, summary, fix), the other
  sections (Style, Source notes, "Key: text" paragraphs), free prose, sources
  (URLs shortened), story refs and every asset id cited. `placeFrames` puts
  the shelf's frames beside the beat they name ("beat 5" in the agent
  description, or the id in BEATS TO REFERENCES), else in shelf order one per
  beat; unclaimed location plates become the Locations block's plates; the
  rest form a strip. `splitRefs` cuts any text at `asset:`, `story:` and
  URL references for inline chips. Nothing throws on an unexpected shape.
  Tests: `tests/storybook-reader.test.ts`.
- `components/gallery/storybook-reader.tsx`: the blocks. Status chips, the
  gaps checklist, numbered beat cards with the frame beside the text above
  900 px and under it on a phone, the frames strip, cast / locations / props
  rows with sheet and plate thumbnails, remaining sections, source link chips.
  Every asset reference is a chip that opens the piece.
- `components/gallery/storybook-modal.tsx`: the cover (the shelf's first
  frame) stays at the top; the title is still edited in place; a Read / Raw
  toggle shows the parsed blocks or the verbatim record. Raw is where the
  description is edited (same autosave), with a Copy button, the script's
  text and the shelf's frames with their ids. The script is read through
  `api.stories.listStories` (kind `script`) and matched on `storybookId`,
  then `folderId`; pieces cited in the text but not on the shelf are fetched
  with `useQueries` on `api.assets.getGalleryAsset` for their thumbnails.
- `components/gallery/dashboard.tsx`: `onOpenAsset` routes through
  `applyLocation` so a chip opens the detail panel over the book at
  `/storybooks/<id>?asset=<id>`; `suspended` hands Escape to the panel while
  it is open. The modal moved from `z-[80]` to `z-[60]` so the panel
  (`z-[70]`, phone sheet `z-[65]`) draws above it.

## The three formats

- 10 Oct: `TITLE · about 30 seconds · da-film · overcast look (live action)`,
  `NOT READY: N blocking gaps`, upper-case sections. The header line is split
  on ` · `: the title token is dropped, the duration token read, the medium
  taken from the parenthesis, the rest become look chips. Sections are cut
  at lines that are entirely upper case; STORY beats are `N. ` lines with an
  optional `0–6 seconds.` prefix; CAST / LOCATIONS / PROPS items are `- `
  lines whose text before the first colon is the label when it is short and
  carries no reference; GAPS lines of the form `NO PLATE: text` become the
  checklist, other lines its notes.
- 13 Oct: `Revised story draft · 30–45 seconds` then `WORLD · style-tag` (or
  `WORLD › Film › Dari · crimson valley (tag)`), a logline paragraph, bare
  numbered beats, `Key: text` paragraphs and a readiness audit with a dashed
  GAPS list. The first token names the draft kind, the second line the world
  and look; `Character lock` / `Location lock` paragraphs become cast and
  locations, other keyed paragraphs a Notes section.
- 27 Oct free prose: a title line that starts with the book's title, then
  paragraphs. The header tokens over 48 characters go to prose, keyed
  paragraphs ("What is in the shot:") to Notes, no beats and no gaps; the
  frames show as a grid.

The description leads and the script fills what it lacks (beats, gaps,
logline, hook, style tag, asset ids). A description that is a copy of the
script is not parsed twice.

## Not done

- The app has no `.env.local` here, so the reader was checked on the live
  deploy after the merge, not locally.
- Cast chips open the asset, not the character record; the character
  registry link is a later step.
