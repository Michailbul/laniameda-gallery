# Changelog

## 0.34.5 (14 Nov 2026)

- MJ Queue: queue sent prompts again. On a thread's Sent tab, "Queue all again"
  copies every sent prompt back into the queue at the end of the thread (same
  words, codes and seeds), and each sent card has "Queue again". Set the
  stylize and send the round again to compare. The sent originals stay sent,
  with their jobs and filed frames; the copies carry an "Again" tag.
- MJ Queue: prompts left "In the bar" (put in the bar in an earlier session and
  never sent) count as still to send everywhere. Before, a thread holding only
  those showed "To send 2" while Next · Send stayed grey and the stylize slider
  said nothing was left.
- MJ Queue: a click on the stylize slider that changes nothing no longer
  freezes the panel until you click elsewhere.

## 0.34.4 (13 Nov 2026)

- MJ Queue: a thread never opens empty. Opening a thread loads its own
  prompts, and the gallery now sends every prompt still to send. Before, the
  list stopped at 500 prompts sorted by thread name, so the 21 Cassandra
  "Style · CAS …" threads showed in the list with nothing inside.

## 0.34.3 (12 Nov 2026)

- MJ Queue: one stylize for a whole thread. Under the send bar a Stylize
  slider shows the thread's value (or "mixed"); drag it and let go, and every
  prompt still to send gets that --stylize. Sent prompts keep theirs.
- The writer describes, never refers. Grow, quick edit and Make it ours never
  put a character's name, a place name, "the other country" or "our city" into
  a prompt (Midjourney knows none of them): a person is written by their look,
  a place by its architecture in style words (late Gothic, Brick Gothic, lancet
  windows, stepped gables), materials, land and light.
- Dear Annete's second country stays medieval fantasy: a richer, stricter,
  smoother Gothic (pale limestone towers with long lancet windows, or dark red
  brick Gothic with stepped gables), never glass skyscrapers. The default world
  prompt is updated; a saved copy that is still the old default switches by
  itself.

## 0.34.2 (12 Nov 2026)

- Attached images stay visible on Midjourney. When you attach an image, a
  style reference or a starting frame, Midjourney shows a strip of thumbnails
  under the prompt box. The moodboard and profile bar sat right on top of it.
  The bar now measures the whole prompt block (the box, the strip of attached
  images and the row of queued jobs) and docks below it, so nothing is covered.
  With the bar docked on top, it clears the block the same way.

## 0.34.1 (11 Nov 2026)

- The writer sizes world details to the shot. Grow, quick edit and Make it
  ours keep the picture's camera distance and add only what can be seen from
  there: a far city behind a person gets skyline-size things (a cathedral,
  colossal statues fused into it, spires, airships moored at masts), never
  lamps or signs along streets nobody can see. Lamps, emblems and garment
  detail stay for near shots.
- Dear Annete's default world prompt is rewritten: mechanisms and a quiet
  magic with cyberpunk at about one part in ten, no clocks, monsters and
  vampires, world details listed by distance, and a second, corporate country
  kept apart. The old default had "gilded clock faces, crystal-column lamps".
  A saved prompt that is still exactly the old default switches to the new one
  by itself; a prompt you edited stays yours (Reset brings the new default).
- Prompt packs: new **Far city** pack; Upper towers drops the retired basalt.

## 0.34.0 (11 Nov 2026)

- The writer reads the world's own files. Grow, quick edit (⌥E) and Make it
  ours are now given the rule file, the learnings, the named cast with their
  costumes, the character directory, the World Bible, the storybooks already
  told and the world's notes on places and vehicles, straight from the
  gallery. Before, Grow got a cut-off copy of the rule file and nothing else.
  A named character keeps their canonical look, wardrobe stays inside the
  world, and a story agrees with the bible.
- The world is found by itself. The Grow card's world menu starts on **Auto**
  and shows the world it read from the frame's codes (its moodboards, profiles
  and style codes), for example "Auto · DEAR ANNETE". Pick a world to set it
  yourself, or "No world" to write from the picture alone. When two unrelated
  worlds fit the codes equally, nothing is guessed: the menu says so.
- After writing, the status line says what was read: "DEAR ANNETE: rules,
  style, learnings, cast, bible, stories, world notes".
- Quick edit reads the world from the prompt in the bar and falls back to the
  world on its chip. It gets the shorter brief (rules, learnings, cast) so it
  stays fast.
- Make it ours reads the files of the world its chosen style belongs to.

## 0.33.2 (11 Nov 2026)

- Midjourney bar: **Other worlds** at the end of the profile row opens one
  line per world with that world's profiles (and a last line of profiles no
  world uses, such as GLOBAL). A click adds the profile to this prompt while
  the dock stays on its world; the world's name on the left opens that world
  in the dock. Open or closed is remembered.
- Switching worlds is instant for any world opened before in the tab: the
  dock shows what it had and refreshes behind it.
- Profiles deleted in Midjourney ("… (deleted in MJ)") no longer show.

## 0.33.1 (11 Nov 2026)

- MJ Queue: your own clicks are never held back. Next · Send and the card
  Send buttons no longer stop at 30 jobs in the last hour or wait while two
  jobs are still running. Those limits are for agents and scripts that send
  by themselves. The counter still shows the account's jobs in the last hour,
  and from 150 on it shows a heads-up without blocking.

## 0.33.0 (11 Nov 2026)

- The writer can run on your own Mac. Grow, quick edit (⌥E) and Make it ours
  now write through the laniameda writer bridge when it is running: a small
  local service that runs Claude Code (`claude -p`) on Haiku 5.5 or Sonnet 5.5
  with your Claude sign-in, so no fal or Pika credit is needed. A picture and
  its prompt come back in about three seconds.
- The Grow card has a switch next to the world: Haiku · Mac, Sonnet · Mac or
  Cloud. One click changes it, and quick edit and Make it ours follow the same
  choice. Quick edit on DeepSeek still goes through the gallery.
- With no bridge on the machine nothing changes: the writer goes through the
  gallery's providers as before.
- The gallery still builds the writer's instructions and reads its answer, so
  the Midjourney rules, the world's rule file and the kept codes are the same
  on either path. Install the bridge once per Mac: `extension-writer/install.sh`.

## 0.32.0 (10 Nov 2026)

- Grow. Point at any generated picture on midjourney.com and press ⌥X: a
  card opens beside that picture and the picture gets a coral ring, so it is
  clear which frame the writer sees. Press 1–7 for a move, or type an idea and
  press Enter: New angles ×3, Close-ups ×3, Wides ×3, Cast ×3, Props ×4, a
  Story in six beats, a World kit of eight frames. ⌃1–⌃7 runs a move with the
  idea you typed as its steer.
- The writer (Haiku 5.5) looks at the picture and the prompt that made it and
  writes new prompts in the same look. The frame's own codes and params
  (--sref, --profile, --ar, --stylize, --v …) are put back on every prompt
  unchanged; a seed is left out. The card shows what rides along. "+ this
  frame as sref" adds the picture itself as a style reference, for frames
  with no codes; an image prompt in the source is left out unless you keep it.
- A world can be picked in the card: its WORLD.md and LEARNINGS.md from the
  gallery steer the writer, and queued prompts land in that world's threads.
- Results by keys: ↑↓ pick, ↵ puts one in the Imagine bar to edit and send by
  hand, Q queues it, A queues the whole set as one MJ Queue thread named
  "<World> · <set>", C copies, E edits the text, D drops, R runs the move
  again, / goes back to the idea. Esc closes; the set stays with its picture
  and comes back on the next ⌥X.
- Holding ⌥ over a picture shows a small GROW tag on it (a click opens the
  card). Nothing is sent to Midjourney: every job is still your own Enter.

## 0.31.3 (9 Nov 2026)

- A folded prompt shows exactly two lines (a cut third line peeked out
  under them).

## 0.31.2 (9 Nov 2026)

- MJ Queue cards are calmer: the agent's note is gone (you read the prompt
  in Midjourney), the prompt shows two lines and opens on a click, reference
  thumbs are smaller.
- Next · Send no longer waits 20 s between clicks. The 30-jobs-an-hour stop
  stays. The last-hour count tries again after 5 s when it misses, and shows
  … while reading and ? with the reason on hover when it cannot read.

## 0.31.1 (9 Nov 2026)

- MJ Queue: a world's name stays on one line in the threads list; its
  counts shorten instead.

## 0.31.0 (9 Nov 2026)

- MJ Queue: one button, Next · Send. It puts the next queued prompt (or the
  one already waiting in the bar) in the Imagine bar and presses Enter once,
  so a thread goes out by clicking it again and again (⌥⇧S). One job per
  click, never a timer or a loop. Put next in bar (⌥⇧N) stays for editing
  first.
- Pacing on the button: after each send it counts down at least 20 s (from
  the last send or the account's newest job), and a live "N / 30" shows the
  account's jobs in the last hour from Midjourney's own history (finished
  plus running). At 30, or with two jobs still running, it stops and says
  why. Card Send buttons follow the same gate.
- The queue tab is dark and follows the panel's width: narrow is one column
  with readable contrast; wide (680 px and up) shows the threads on the left
  and the open thread on the right, with bigger reference thumbs and cards in
  a grid when there is room. Every prompt shows in full. Geist, bold
  uppercase titles, mono badges; the selected thread is a soft neutral pill.
- Threads grouped by world (DEAR ANNETE, CASSANDRA, ANDROMEDA …) under
  collapsible headers with thread and prompt counts. Pin a world or a thread
  and it sits on top; pins follow you across your Chromes.
- A prompt made by the describer shows its source picture as a SOURCE thumb.

## 0.30.1 (9 Nov 2026)

- Describer style tiles name their world only when the style comes from a
  sister world (3D, ART DECO …); the side panel shows every style without a
  scroll of its own.
- (0.29.1) The describer's style list loads: its world was cut from the
  request, so "Our style" showed HTTP 404.

## 0.30.0 (9 Nov 2026)

- Dock presets are copied to the gallery as style presets of the world, so
  the gallery's prompt runs (prompts × presets × locked seeds) can use them.
- The gallery's own style presets that a chip can set (moodboard, profiles,
  settings) show in the dock with a dashed edge; they cannot be deleted
  there.
- The MJ Queue shows a run's labels (place, preset, wording, seed) like any
  restyle item.

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
