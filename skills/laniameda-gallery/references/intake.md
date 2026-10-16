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

- Map Michael's word to a live collection with list_collections. World names,
  their purposes and IDs come from worlds.md, never from memory.
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

## Cost

State the per-image cost and the batch total before generating. Stills up to
about $0.20 each run without asking; anything above that, and every video,
waits for Michael's OK. Follow the provider routing in his instructions.
