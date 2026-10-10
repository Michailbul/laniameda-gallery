# Storybooks: production-ready episodes

A storybook is a package Michael can pick up and send to Seedance 2.5 without
asking what is missing. It holds one short episode, the exact assets to feed the
model, and an honest list of what is still lacking. A pretty grid of frames with
a paragraph of text is not a storybook. A board whose images do not match its
story is worse than an empty one, because it looks finished.

Storage: a collection with `kind: "storybook"` (root, never nested). The story
text lives in the collection `description` and is edited in the storybook modal.
Member assets are the images and clips the episode uses. The source or longer
text, if any, lives in a native Story (references/stories.md) linked by
`storybookId`.

## What a storybook must contain

Write the description as plain text in this order. Use the headings as written so
every book reads the same way.

1. **Header.** Two lines, written exactly like this because the gallery reads
   them to filter and badge the book:
   `TITLE · about 40 seconds · style-lane (animation)` (or `(live action)`)
   then `READY` or `NOT READY: <n> blocking gaps`. The collection name is
   `WORLD · Title`; the world before the dot becomes the world filter.
2. **STORY.** The episode in plain language, 4 to 8 numbered beats. Each beat is
   one visible action a camera can film, with the place and who is in it. About
   5 to 8 seconds per beat. No abstract feeling that cannot be seen.
3. **CAST.** One entry per character who appears: name, one line on look and
   wardrobe, the `asset:<id>` of the character sheet, and the sheet's status.
4. **LOCATIONS.** One entry per place: name, a description (time of day, light,
   key props, layout, what is in the background), and the `asset:<id>` of each
   reference plate. Several locations are normal. Each needs its own plate.
5. **PROPS.** Anything a beat depends on (the basket, the jar, the strawberry)
   with a reference if the model must keep it consistent.
6. **BEATS TO REFERENCES.** For each beat: location, characters present, the
   asset IDs to attach, approximate seconds.
7. **STYLE.** The lane in one sentence and the `story:<id>` of the world style
   lock. Every asset in the book is in this lane.
8. **GAPS.** Every flag, one per line (see below). Empty only when status is
   `READY`.
9. **ASSET LINKS.** The full list of `asset:<id>` in the book, so the set can be
   copied in one go.

## The episode

- One episode, not the whole saga. A single scene, event or turn that stands
  alone in under a minute.
- Start inside the action, or on an image worth looking at. No setup beats, no
  waking up, no establishing montage unless the waking is the image.
- One visible choice by a character, and an ending the choice earns.
- Keep it small enough to produce: few characters, few locations, each shot
  needing only a few references. If a beat needs a person or place the board
  cannot supply, cut or change the beat. Do not paper over it with a stand-in.
- Use the character's name the same way everywhere: title, logline, hook, body,
  asset descriptions. After writing, search all of those for a name that drifted
  (`Ann` in a logline, `Anya` in the body is a real past defect).
- Follow the world's current rules: read the authenticated `references/worlds.md`
  and the native style lock before writing a world story. A story with no world
  is allowed and has no lane constraint beyond the one it declares.

## Character sheets

Every character who appears on screen has a sheet. No exceptions for children,
extras with a close-up, or characters who appear for one beat.

- The sheet is in the same style as the original reference: same rendering
  lane, line quality, palette, proportions, and face design. Identity must be
  exact, because the model will copy it into every shot. A different-looking
  "close enough" sheet is a gap.
- A new character (a daughter, a friend) is designed from the existing anchor's
  look first, then sheeted. Her sheet is not a stock image that vaguely fits.
- Build sheets with `leera-character-reference-sheet`: face close-up, front and
  back masters, one visible face. Keep animated casts and live-action
  interpretations separate; a photoreal sheet never stands in for an animated
  character.
- One sheet per costume the episode uses.
- A source reference is not a sheet. If only an inspiration image exists, flag
  `NO SHEET` and say what the image is.

## Generating characters and wardrobes: ground every image in the world

Never invent a look from text alone. In a world with an existing cast, the
costume language, materials, proportions and rendering belong to that cast, and
a generated person who does not look like they live there is a failed
generation, whatever the model made.

- **Read the cast first.** Pull the world's character sheets with
  `preview_assets` and look at them before writing any prompt. Note the
  actual garments, fabrics, metals, colours and how mechanical parts are worn.
- **Pass references on every call.** A new character is made with an image-edit
  model and two or three of the world's own sheets as reference images, each
  named in the prompt for what it contributes ("reference 1 shows the ruff
  collar, reference 2 the black Baroque tailoring, reference 3 the brass limb").
  Say that the result is a new, different person and must not copy any
  reference face.
- **Re-clothing takes a real garment.** Dress an existing character in a
  garment that already exists on another character, passed as a reference
  image and named in the prompt, with the face anchor passed as a second
  reference. Write what stays fixed (face, hair, build, mechanical limb,
  backdrop) and what changes. Ordinary clothes with no source in the world
  (aprons, waistcoats, a tram coat) are not wardrobe for this cast.
- **Identity carries by derivation.** Make the face close-up from the full-body
  master with the master as the reference, not from a fresh description.
- **Show your references.** Every generated still on a review board lists the
  gallery asset IDs it was built from, next to its prompt.
- **Stories follow the cast.** Write episodes for the characters and costumes
  that exist, and name the costume each character wears. A trade or job with no
  place in the world (baker, waiter) is a sign the story is not for this world.

## Locations

- Every location named in a beat has at least one plate in the book's lane,
  in the right time of day. Add a second angle when the action needs one
  (kitchen wide and counter close-up).
- A plate of a different place is not a plate of this place. Flag it.
- Write the description for the model: surfaces, light direction, objects that
  must stay put. Plates give the look; the text gives the layout.

## Gap flags

Put every shortfall in GAPS using these labels, one line each, with the beats
it blocks. Blocking flags stop `READY`; advice flags do not.

Blocking:
- `NO SHEET: <character> (beats 4, 5)`
- `SHEET INCOMPLETE: <character>, has <what exists>, needs <what is missing>`
- `SHEET STYLE MISMATCH: <character>, <asset id>, <what differs>`
- `NO PLATE: <location> (beats 2, 6)`
- `PLATE STYLE MISMATCH: <location>, <asset id>`
- `OVER LENGTH: <n> seconds`

Advice:
- `NO PROP REFERENCE: <prop> (beats 2, 4)`
- `NO CLOSE ANGLE: <location>, <beat needs>`
- `ACTION UNPROVEN: <beat>, no frame shows it`
- `UNUSED ASSET: <asset id>, no beat uses it` (remove it from the book)

For each flag add the cheapest fix: the exact asset to generate or find, the
model route from the image routing rules, and the price per image. Money
rules apply: state the batch total, and ask before anything over $0.20 per
image. Never generate paid media to close a gap without Michael's go.

Status is `READY` only when every character has a complete sheet, every location
has a plate, every asset matches the lane, and runtime is 60 seconds or less,
that is, when no blocking flag remains. Advice flags stay listed.

## Membership rules

- Every asset in the book is used by a beat. No leftover mood images, no
  alternates, no assets from another project.
- Every beat is covered: its location plate and each character sheet in it are
  in the book.
- Assets keep their world, piece type, tags and source. Adding to a storybook is
  additive membership. Never remove an asset from its other collections.
- Source WebP originals, Pinterest captures and outside inspiration are never
  members of a production storybook. Derived thumbnails are exempt.

## Workflow

1. Choose the premise. Use a saved Story (references/stories.md) or a new idea.
2. Write the episode and count its seconds.
3. List every character, costume, location and prop the beats need.
4. Search the gallery for existing sheets and plates in the lane
   (`search_gallery`, then `preview_assets` to look at them, then
   `get_gallery_item`). Pick by identity and place, not by a similar hairstyle.
5. Build the coverage table: each beat against its assets. Mark every hole.
6. Write the description in the order above, with GAPS filled in.
7. Create the collection with `create_collection` (`kind: "storybook"`, name,
   description) or rewrite it with `update_collection`, which needs `folderId`
   and `name` on every call and replaces the description. To add an asset,
   read its current `folderIds` with `get_gallery_item` and send the full set
   plus the book through `update_gallery_item`, because `folderIds` replaces
   the list. Link the native Story with `storybookId` and `assetIds`.
8. Read the book back: member IDs, description text, every `asset:<id>` in the
   text exists and is in the collection, status line matches GAPS.
9. Report the gaps and what each fix costs. Stop there. Generation and video
   runs wait for Michael.

## Auditing an existing book

Run steps 4 to 8 on the book as it stands. Typical findings: a character in the
text with no sheet, a location in the text with no plate, a sheet in a
different style from the anchor, assets in the book that no beat uses, and a
status line that says nothing about any of it. Preserve the old description
(it lives in the linked Story's revision history or in a new revision you save
first), rewrite to the order above, and mark every shortfall in GAPS.
