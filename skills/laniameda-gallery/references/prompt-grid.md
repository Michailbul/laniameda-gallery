# Prompt runs: prompt sets × style presets × locked seeds

Michael (9 Nov 2026): "a set of prompts we can run … multiple prompts in
multiple variations, and a set of presets that apply a style preset … so that
we have more results to compare, ideally with the locked seed." Art-director
scope (references/projects.md): owner and agents only.

Research behind it: `~/AI-video-work/CASSANDRA/bible/mj-style-consistency-research-2026-11.md`
(V7–V8.2, 9 Nov 2026). What it changes here:
- A recipe is frozen codes: moodboard and profile **codes** (an ID points at
  the latest board; a profile code changes as ratings are added), srefs with
  their `--sv` version, version, every parameter, the opening sentence.
- A seed is a rerun tool, "99% identical" for the same prompt and recipe; it
  does not hold a layout across recipes (use the Edit model for that).
- Screen in Draft (one submit = 24 small images, one job against the caps),
  lock at full quality. Two fixed seeds per shot (1111, 2222; confirm on
  3333, 4444). Never permutations or `--repeat` for grids (bursts).
- `--weird` is dropped from moodboard jobs; `--raw` can pull a painted board
  toward photo and `--stylize 600` is a habit: ladder stylize
  (100/250/400/750) and raw on/off per painted family.
- Midjourney's Terms (27 May 2026) forbid automated tools: Michael sends
  every job himself, one per click.

## The objects

- **Prompt** = a locked prompt (references/locked-prompts.md) with up to 3
  **variants**: `short`, `prose`, `neutral` (style-neutral), each with its own
  locked **seeds**, reused unchanged across every preset. `attach` holds
  Edit-model images sent with every run (a design sheet).
- **Prompt set** (`set:<id>`): a named, ordered set of prompts. CASSANDRA:
  "Cassandra test shots" (T1 city wide, T2 apartment interior, T3 San Pancho
  street, T4 night sea, T5 magic forest path, T6 Casandra full body, T6b
  close-up, T8 grackle, T9 a scene; seeds 1111/2222; Casandra in a place with
  her sheet waits until a sheet exists in each style) and "Cassandra
  locations" (the 20 locked location prompts, neutral / short / full prose).
- **Style preset** (`preset:<id>`): one exact recipe. A perturbation (board
  alone, sref only, + profile, stylize 750, raw off, sv 6, version 8.1) is a
  preset of its own with a parent, so every frame maps to exactly one recipe.
  Made from a world style (`style_preset_from_style`, codes read now), by
  hand (`save_style_preset`), or copied from the extension dock's presets
  (dock 0.30+ syncs them; gallery presets a chip can set show in the dock).
  `style_preset_to_style` saves one back as a world style.
- **Run** (`run:<id>`): prompts × variants × seeds × presets as one MJ Queue
  thread. Items carry `runId`, `presetLabel`, `variantLabel`, `seed`,
  `screen`; the panel shows them.

## How to run

1. `preview_prompt_run {world, set, presets, stage: "screen"}`: jobs, how many
   are screening, time at the caps (30 an hour, 150 a day, breaks every 20)
   and the first commands. Tell Michael in plain words before queueing.
2. Two stages. **Screen**: every preset × each prompt's first variant on its
   first seed, in Draft. **Refine**: the presets he kept × every variant (and
   with `allSeeds` every seed), plus perturbations of the winners, full
   quality.
3. `queue_prompt_run`: one thread, screening first, prompt by prompt so one
   prompt's presets arrive together. Repeating returns the same items.
4. He sends and saves frames. `file_run_results {run}` files each on the
   art-director **Run results** shelf (and its place shelf; a world style's
   shelf only when the preset is that style's own recipe unchanged) and
   records its exact cell.
5. The grid, `/w/<world>/grid?run=<id>`: rows = presets, columns = prompts.
   Keys on the hovered frame, cell or row: **1 keep, 2 drop** (again clears).
   Kept frames go to a gallery moodboard (gallery first; mirror to Midjourney
   only after his review). A kept row can be saved as a world style.
   `get_prompt_run` reads his verdicts; agents never set them.

## Tools

| Tool | What it does |
|---|---|
| `list_style_presets`, `save_style_preset`, `style_preset_from_style`, `perturb_style_preset`, `style_preset_to_style` | Presets: list, write as frozen codes, from/to world styles, perturbations. |
| `list_prompt_sets`, `save_prompt_set` | Named sets of locked prompts. |
| `save_locked_prompt` (`variants`, `attach`) | Variants with locked seeds; Edit attachments. |
| `preview_prompt_run`, `queue_prompt_run` | Job count and time, then one thread. |
| `get_prompt_run`, `file_run_results` | The grid with verdicts; frames back with their cell. |
