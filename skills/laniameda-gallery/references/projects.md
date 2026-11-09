# Projects: a film Michael art-directs, in one place

A project is a world with project details. CASSANDRA (the animated feature for
Sula Entertainment; Michael is the art director) is the first. Its project
room is `https://gallery.laniameda.space/w/cassandra/project`, owner only.

## Art-director scope first (Michael, 9 Nov 2026)

"When I ask to add it as project I mean so that we do that first always for
the art director scope. Not to the public/director views."

- Everything added to a project is Michael's alone: briefs, their files and
  pictures, art-director shelves and the style recipes.
- It reaches the director review (`/review/<slug>`) only when Michael promotes
  it, and the public world page (`/w/<world>`) only when he publishes it.
- New shelves in a project world are art-director shelves by default
  (`world_shelf` without `scope`); `scope: "shared"` makes an ordinary one.
  An art-director shelf never feeds the public wall, the public showcase or
  the review by itself.
- `review_promote` refuses frames that sit on an art-director shelf unless
  Michael said to show them in this session (`confirmed: true`).
- Frames that were already public before they joined an art-director shelf
  stay public: the shelf hides nothing that was published another way.

## Find anything (agents start here)

1. `project_open {world}`: the whole project as a map with handles: details,
   briefs, art-director and other shelves, the director review and its
   folders (with script scenes), **locked places** grouped by area and place,
   **shot sets**, **looks** (style presets, variations under their parent),
   **runs**, world styles, moodboards, inspiration.
2. `project_find {world, query}`: one search across all of it, by words
   ("school patio", "night beach", "metro") or a scene ("scene 61"). Results
   are ranked, each with its handle and the tool that opens it; brief
   pictures that match come back as `asset:` handles.
3. `project_get {ref}`: opens any project handle whole: `brief:`, `lp:`,
   `set:`, `preset:`, `run:` (or `thr-xxxxxxxx`), `style:`.
   `get_gallery_item` points here for those prefixes.

| Handle | What | Open with |
|---|---|---|
| `brief:<id>` | what production sent: sender, date, why, files, pictures | `project_get` |
| `lp:<id>` | a locked place: wordings, seeds, brief images, takes | `project_get` |
| `set:<id>` | a shot set: shots with every wording and seed | `project_get` |
| `preset:<id>` | a look: codes, copy-ready parameters, variations, runs | `project_get` |
| `run:<id>` | a run: rows = looks, columns = shots, frames, Michael's keep/drop | `project_get` |
| `style:<id>` | a world style and its recipes | `get_style` |
| `moodboard:<id>` | a moodboard | `get_moodboard` |
| `asset:<id>` | a picture | `get_gallery_item`, `preview_assets` |
| review folder slug | frames in the director review | `review_items {project, folder}` |
| shelf id | pieces on a shelf | `list_assets_page {folderId}` |

## The objects

- **Project details** on the world root (`folders.project`): `line`,
  `client`, Michael's `role`, `people` (name, role, org), `reviewSlugs`,
  `status`. `set_project` writes them. Review projects whose world is this
  world belong to it anyway.
- **Art-director shelf**: a world shelf with `scope: "art_director"`.
  `open_world` marks it `artDirectorOnly: true`.
- **Production brief** (`brief:<id>`): what the director or producers sent.
  `title`, `kind` (brief, storyboard, script, style_guide, references,
  other), `from` (who sent it, plain words), `receivedAt`, `note` (why it was
  sent, what it asks), `topics`, `reviewFolders` (review folder slugs it
  informs), its pictures (`assetIds`, optional `groups` such as "School",
  "Metro") and its `files` (the PDF, the script: private bytes, each with
  name, size, sha256, pages, an optional first-page cover). Keyed by a stable
  `ingestKey` (`cassandra:brief:school-design`).

Inspiration stays separate from production: brief pictures are outside
references (piece type `inspiration`, source kept); they are not the world's
frames and never its cast. The project's Inspiration block lists the world's
other inspiration pieces and inspiration-library takes made for the project.

## Tools

| Tool | What it does |
|---|---|
| `project_open` | The whole project in one call: details, world, styles count, art-director and other shelves, director review(s) with rounds, reviewers and unread feedback, every brief, the inspiration. |
| `production_briefs` | Find briefs by words (`query: "school brief"`), all of a project's (`world`), or one whole (`brief`): pictures with descriptions and urls, files with private urls. |
| `save_production_brief` | Add or update a brief (journaled; `world_undo` reverts). |
| `production_brief_file` | `upload_url`, POST the bytes, then `attach` with the hex sha256. |
| `set_project` | Make a world a project or change its details. |
| `get_style` | Each recipe now carries `copy`: `params` (every code merged into one Midjourney parameter line) and `prompt` (the template with `[subject]`). |

Locked location prompts (one style-neutral prompt per place, redone in any
style in one click) are part of the project: references/locked-prompts.md.

## Add a brief

1. Save its pictures first as ordinary gallery assets in the world (piece
   type `inspiration`, a `location-reference` or similar tag, the source in
   the description) on the project's production shelf (art-director scope).
2. `save_production_brief {world, ingestKey, title, kind, from, receivedAt,
   note, topics, reviewFolders, assetIds | groups, session}`. Write `from`
   only with what is known; never guess a sender.
3. Files: `production_brief_file {step: "upload_url"}`, `curl -sS -X POST -H
   'Content-Type: application/pdf' --data-binary @file '<uploadUrl>'` →
   `{storageId}`, then `production_brief_file {step: "attach", brief,
   storageId, name, sha256, pages, coverStorageId?}`. A cover is the first page
   as PNG/JPEG (macOS: `sips -s format png file.pdf --out cover.png`),
   uploaded the same way.
4. Never put a brief file's url anywhere public: it opens only for Michael's
   session or an owner token.

## Style recipes for the art director

Every style's recipes show, copy-ready, on the styles page
(`/w/<world>/styles/<style>`) and in the director review's owner view (under
the style header when a style is chosen; "Copy MJ" on each style section).
One button copies the whole parameter line for the Midjourney bar, one the
template with `[subject]`. Codes are named (moodboard or profile) underneath.
The director and producer never receive recipes (`reviewStyleRecipes`
answers null to anyone but the owner).
