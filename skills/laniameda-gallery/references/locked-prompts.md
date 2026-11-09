# Locked location prompts: one prompt per place, redone in any style

Michael's location workflow (9 Nov 2026): style exploration → location images
→ scenes → group and save in the project. A **locked location prompt** is the
place written once without style words, with the images that hold its
architecture and a fixed seed, so the whole set can be redone in another
world style in one click. Art-director scope (references/projects.md):
owner and agents only; nothing here reaches the director review.

CASSANDRA's 20 locked prompts came from the 29 items of queue thread
thr-0ed418f9 (9 of them were the same place with another profile; those are
restyles now). They live on the project page,
`/w/cassandra/project` → Locked locations.

## The record (`lp:<id>`)

- `title` ("The patio with the big tree"), `place` (`Area · place`:
  "School · Patio"; the area groups places), `reviewFolder` (review folder
  slug, `school`), `shelf` (the world shelf its frames go on), `scenes`.
- `text`: the "what" only: place, shot, objects, light. No style words
  ("feature animation film", "hand-drawn 2.5D…" belong to the style), no
  flags (refused).
- `imagePrompts`: brief/reference images with their weight (`--iw`), e.g. the
  school brief photos at 0.75.
- `aspect` (16:9), `seed` (fixed, 0–4294967295; made from the ingestKey when
  left out), `extraParams` (rare flags that belong to the place).
- `lockedFrame`: the take Michael picked. Its `editUrl` is the Midjourney CDN
  image when the frame came from a job (what `--edit` reads best), else the
  gallery copy.
- `currentStyle`, `takes` (frames made from it: style, mode, job), revisions
  (every content change; `expectedRevision` guards edits).

## Restyle: two modes

`restyle_locked_prompts {world, prompts | places, styles, mode}` writes one
MJ Queue thread ("CASSANDRA · School · in CAS STORYBOOK"), one item per
prompt × style, from the locked words, aspect and seed plus the style's first
recipe (sref, profiles, moodboards, parameters, template; lib/mj-recipe).

- `seed` (Same prompt and seed): a new generation, similar composition. Say
  it plainly: a different sref or profile still moves the picture.
- `frame` (Restyle the locked frame): the locked frame attached with
  `--edit` (Midjourney V8.2's Edit model, which replaced Retexture). It holds
  the frame's layout and changes the look; image prompts are left out.
  Prompts without a locked frame go as `seed`, with a warning.

The style's template wraps the words: its lead sentence goes first ("Painted
storybook animation frame. [subject]"), its medium words follow; words the
prompt already says and the template's place words ("in Mexico City") are
left out. A style template should carry medium words only. `dryRun` shows
every command first. Repeating a call returns the same items (one per prompt
revision, style and mode).

Michael sends every job himself from the MJ Queue panel or the gallery queue
page, one per click. Never submit, never loop, never time a sender (the
Midjourney pacing rules in CLAUDE.md). Items carry `lockedPromptId`,
`placeLabel`, `styleLabel`, `restyleMode` and `editRefs`; the panel shows
place · style · mode and the attached frame.

## Results back

After he sends and the frames are saved in the gallery (the extension's save,
or an agent's save of frames he kept), `file_restyle_results {world, thread?}`
files each frame onto the prompt's place shelf, the style's shelf and the
art-director **Location takes** shelf, adds it to the prompt's takes and links
it to its sources (`edit_source` = the locked frame, `starting_image_asset` =
brief images). It never promotes to the director review. When Michael picks a
take as the new reference, `save_locked_prompt {prompt, lockedFrame}`.

## Tools

| Tool | What it does |
|---|---|
| `list_locked_prompts` | A project's locked prompts, filtered by place. |
| `get_locked_prompt` | One whole, with takes and revisions. |
| `save_locked_prompt` | Create or change (versioned, journaled). |
| `restyle_locked_prompts` | Prompts or places × styles → one MJ Queue thread. |
| `file_restyle_results` | Saved frames from sent restyle jobs → place, style, takes, lineage. |

In the gallery: the project page (Locked locations: "Redo in style ▾" on an
area, a place or a prompt), the styles page ("Redo locked locations in
<style>"), and an open frame that is a locked frame or a take ("Redo in
style").
