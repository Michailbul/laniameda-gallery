# Inspiration intake: Michael throws it, the agent files and processes it

Michael sends raw material (screenshots, photos, phone imports, links, a folder,
a post) with a short note naming the project, sometimes only a word ("Anya",
"cars", "NOISE"). The agent turns that into finished gallery entries without
further briefing. Be proactive. Asking is for a genuinely ambiguous destination
or a cost above the limits below, not for routine steps.

Read SKILL.md, the authenticated references/worlds.md and the target world's
native style lock before the first save. The style lock holds the cast sheets,
places, rendering blocks and the world's processing recipe. This file holds the
procedure every world shares.

## 1. Resolve the destination

- Map Michael's word to a live collection: open_world for a world's shelves,
  list_collections {world} or {search} for anything else. World names, their
  purposes and IDs come from worlds.md and open_world, never from memory.
- One batch can split across projects: family moments to the family world,
  cars to the car library, metro shots to a music-video board. Sort per item
  by what it actually shows, and say how you split it.
- Missing collection: create it when Michael named a new project in the same
  message ("for the new NOISE MC collection"); otherwise ask once.

## 2. Make a clean source and save it as inspiration

- Strip social and app UI by cropping: Instagram/TikTok/X chrome, captions,
  buttons, status bars, watermarks. Crop to the picture; never upscale,
  inpaint or invent pixels to fill a gap. A video gets its clean frames or its
  original file, not a screen recording of the app.
- Keep the clean crop as the source file. A raw screenshot is saved only when
  the screenshot itself is the reference (a UI, a website, a prompt).
- Save with assetRole inspiration_capture, the inspiration piece type, the
  real medium (live-action for photos, animation for drawn or rendered work),
  sourceUrl when a permalink is known, an agentDescription of what it shows
  and why it was kept, and a stable ingestKey derived from the source.
- Cross-file by subject: romance, couples and family also go to LOVE; outside
  references also go to the matching ART shelf. The world's own membership is
  added on top.

## 3. Process it into the world (generated derivatives)

Processing means making the world's own version of the idea, by the recipe in
that world's style lock:

- A world with a locked production style and cast: describe the source in
  words, then write a different scene in that language with the world's cast
  sheets, a location plate and the locked rendering blocks. Do not restyle the
  photo itself; Michael rejected restyles. Keep the source's framing only when
  he asks for the same angle.
- Default output: two stills per source, in 16:9, 1:1 or 21:9 unless the world
  sets another format. Name in the prompt what each reference image contributes.
- A library without a production style (car references, music-video moodboards,
  design and science shelves): the clean source is the deliverable. Offer a
  processed version only when it adds something, such as a car isolated into
  the studio look.
- Check every result before saving: hands, arm and child counts, identity drift
  (hair, beard, face), garbled text, and whether the rendering holds the world's
  look. Regenerate a failed frame once; report anything that still fails.
- Save passing frames as generated_output in the world (and LOVE where it
  applies), with the exact prompt, model and provider, five tags at most, and
  upstreamInputs pointing at the saved source with role style_reference or
  starting_image_asset.

## 4. Motion is proposed, never run unasked

When a source would make a good moving shot, prepare the video prompt and price
and show them. A paid video run needs Michael's explicit go for that run.

## 5. Show it on the board and report

- Every processed batch goes onto the project's HTML board (pick, comment,
  archive; versions along the top; copy-ID and prompt on every card), opened
  in the browser pane. Board images can load from the saved gallery URLs.
- Archiving a saved derivative on the board means removing it from the world
  collections on the next pass. It is never deleted without Michael's approval.
- The chat reply lists what was saved where, what was processed, what failed
  and the spend. Keep it short; the board carries the detail.

## From a video or scene to a storybook

Some inspiration is a story, not a look: a reel, a film clip, a scene whose
vibe Michael likes. Those run through four stages and end as a storybook
(references/storybooks.md). Storybooks are the end of the pipeline: packaged
episodes ready to send to the video model. Some grow into a series.

**Stage 1. Take the source apart (no project needed).**
- Get the media. Social video is often login-walled for command-line tools;
  if so, play it in the browser pane (the user's session) and capture frames.
  Never ask for a password or export cookies.
- Capture 6 to 10 key frames that cover every beat, plus the caption, author,
  audio track and length. Save the frames as inspiration_capture with the post
  permalink, author credit, LOVE/ART memberships by subject, and the world only
  once Michael has named one.
- Save a native Story (kind idea, status idea) as the source analysis: source
  block, what the film is (camera, light, place, wardrobe, sound), the beats as
  filmed with timestamps, why it works, what transfers to our worlds, two or
  three adaptation pitches in named worlds with real cast, and open questions.
  Link the frames with assetIds.
- Put it on the Storybook Studio board (one entry per source, stages along the
  top, versions V1, V2…): frames, beats, notes and the pitches as concept cards.
  Michael picks a pitch or names a world, and comments.

**Stage 2. Treatment (after Michael names the world).**
- Read the world's style lock and cast. Prefer existing characters from the
  gallery; ask only when the story needs a choice Michael must make (which
  couple, which child). A new character is designed from the world's sheets,
  never from text alone.
- Write the episode for that cast: logline, 4 to 8 filmable beats, the vibe in
  one paragraph, wardrobe per character, locations, props, runtime under 60 s.
  Save it as a second Story (kind script, status draft) that links back to the
  source analysis. Keep the source's wording out of the adaptation.

**Stage 3. Pre-production.**
- Cast: the character sheets each beat needs, from the gallery or made by the
  sheet procedure. Locations: a plate in the world's lane for every place, plus a
  close angle where a beat needs one. Props with references when a beat depends
  on one.
- Style frames: one key still per beat in the lane, built from those sheets and
  plates as references. Every round goes on the Studio board as a new version;
  picks anchor the next round, comments steer it, archived items never return.
- Iterate until Michael's picks cover every beat.

**Stage 4. Package.**
- Create the storybook collection (`WORLD · Title`, kind storybook) with the
  description in the storybooks.md order, every gap flagged, the picked sheets,
  plates and frames as members, and the treatment Story linked by storybookId.
  The source frames stay inspiration and are never storybook members; the
  Story links them.
- Read the book back and report status (READY or the gaps with their cheapest
  fix and price). The video run waits for Michael's go.

## Cost

State the per-image cost and the batch total before generating. Stills up to
about $0.20 each run without asking; anything above that, and every video,
waits for Michael's OK. Follow the provider routing in his instructions.
