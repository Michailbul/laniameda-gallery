---
name: laniameda-gallery
description: >-
  Michael's gallery (laniameda.gallery): the agent-readable vault of the work he
  makes and the work he likes. Use it to save anything into the gallery
  (prompts, images, videos, references, multi-step workflows), to update or
  delete items, to find and pull things back out (semantic search, browse by
  collection, tag, piece type, medium or liked, resolve a copied asset:<id> or
  pack:<id>), and to extract liked items from X bookmarks, Instagram, Pinterest,
  Dribbble or websites into it. Triggers: "add this to my gallery", "save this",
  "put this in the Love collection", "file this under CASSANDRA", "sort these into
  characters and locations", "what do I have for...", "find in my gallery",
  "pull the prompt for asset:...", "go through my X bookmarks", "save my
  bookmarks to the gallery", "extract these into the gallery".
version: 1.1.0
---

# laniameda gallery

## What the gallery is for

The gallery is Michael's taste and his production vault, kept so that agents can
use it. What he makes and what he likes goes in with enough structure that an
agent who has never heard of an item can find it months later and reuse it: the
prompt that made a shot, every location in a world, the motion references he
saved for a landing page.

So **a save is only done when the item is findable.** Media, a source, an agent
description and the right tags, not just a file in a bucket. A save with no
tags and no description is a dead record.

The gallery's code is the source of truth (`convex/schema.ts`,
`convex/validators.ts` in `~/AI-video-work/laniameda/laniameda.gallery`). This
skill describes it; `references/data-model.md` has the detail with file
references.

## How a piece is found

| Handle | What it is | Example |
|---|---|---|
| **Collection / folder** | Where it lives. Root collections (worlds are ALL CAPS) hold one level of folders. | `CASSANDRA › Balcony`, `LOVE` |
| **Piece type** | What it IS. One tag of four: `character`, `location`, `scene`, `inspiration`. Never a folder. | a Dari portrait → `character` |
| **Medium** | The exact tag `animation`; anything without it is Live action. | a clay short → `animation` |
| **Descriptive tags** | Typed tags: platform, content, style, lighting, camera, model… | `x`, `landing-page`, `golden-hour` |
| **Words** | Hybrid semantic search: the pixel lane (what it looks like) plus the text lane (agent description, caption, prompt, tags). Automatic. | "clay character waving in a doorway" |

Plus provenance on the record: `sourceUrl`, `agentDescription`, `description`,
`modelName`, `assetRole`, `ingestSource`, the linked prompt.

**Pillars are legacy.** The `pillar` column is a dormant free string. When
Michael says "pillar" he means a piece type or one of his island-bar filters.
Resolve it to those and leave `pillar` unset, except where a contract requires
it (cinema frames, workflow ingest).

## The tagging contract

Every save carries, where it applies:

1. **Piece type**: one of `character`, `location`, `scene`, `inspiration`.
   Someone else's work he liked is `inspiration`. Pieces of his own worlds are
   `character` / `location` / `scene`.
2. **Medium**: `animation` for drawn, illustrated, anime, clay, stop-motion or
   3D-animated work. Exactly that word; `animated` or `anime` alone don't count.
3. **Platform** (`category: "platform"`): `x`, `instagram`, `pinterest`,
   `dribbble`, `behance`, `awwwards`, `youtube`, `website`, `midjourney`,
   `higgsfield`, `krea`.
4. **What it is** (`content_type` or `design_type`): one to three, e.g.
   `motion-design`, `landing-page`, `portrait`, `product-shot`, `title-card`.
5. **How it looks** (`style`, `lighting`, `camera_angle`, `composition`,
   `color`, `environment`): only what's visibly true, two to five.
6. **Model** (`model_name`): only when Michael or the source names it. Never
   infer a model from how a prompt reads.

Rules for tags:

- **Reuse before inventing.** Read his tags first (query `tags`, or MCP
  `list_tags`). If `cinematic` exists, don't add `filmic`; point the synonym at
  it with `tags:addTagAliases` so later saves resolve it automatically. The
  ingest script warns on stderr when a save would create a new tag.
- Lowercase, singular, hyphenated: `golden-hour`. Matching folds case, `-`,
  `_` and spaces, but not plurals.
- Tags you infer get `source: "agent"` so his own tags stay distinguishable.
- Keep it to about 4–10 tags. Tags are for retrieval, not for describing
  everything.

And on the record itself:

- **`agentDescription`**, required on every agent save: one or two plain
  sentences, 45 words at most, on what it shows (subject, setting, action) and
  how it looks (medium, style, light, framing), plus why it was kept and
  `by @handle` for someone else's work. Written for retrieval: it leads the
  text lane of search and it's the first thing a future agent reads. Keep it
  out of `description`, which is Michael's own caption. Anything saved without
  one (extension, Telegram) gets an automatic description marked `auto`, which
  an agent may replace; an agent-written one is never overwritten.
- **`sourceUrl`**: the permalink of the post or page it came from.
- **`assetRole`**: `inspiration_capture` (liked work), `reference` (pulled in
  for a production), `generated_output` (his own generations).
- **`ingestSource: "agent"`** and a stable **`ingestKey`**
  (`<platform>:<native id>:<n>` for captures), so reruns merge instead of
  duplicating.
- **Collection**: only when Michael names one or the fit is certain. Match
  existing names case-insensitively; ask before creating a missing one.

## Route the request

| Michael wants | Go to |
|---|---|
| Save a prompt, image, video or reference | `references/ingest.md` (examples: `references/ingest-examples.md`) |
| File into a collection, folder or world; publish a world | `references/ingest.md`, "Filing" and "Publishing" |
| A multi-step preset or tutorial | `references/ingest.md`, "Workflows" |
| A cinema frame (film still, no prompt) | `references/ingest.md`, "Cinema Inspiration" |
| Update or delete an item | `references/ingest.md` and the update examples |
| Find, browse, pull a prompt, download media | Query recipes below, then `references/query.md` |
| Go through X bookmarks, Instagram, Pinterest, sites and save what he liked | `references/extraction.md` |
| What a field, tag category or enum means | `references/data-model.md` |
| Access, env, deployment, keeping this skill current | `references/maintenance.md` |

## Query recipes

All through `scripts/query.ts` (see `references/query.md` for every field).

- **"Find me X"**: `search` with a plain-language query. Hybrid by default: it
  matches what pieces look like AND what their words say. Narrow with filters:
  ```json
  {"action":"search","query":"clay character waving","pieceType":"character","medium":"animation","limit":10}
  ```
  `mode: "visual"` for looks-only, `"text"` for described-alike. Results carry
  `agentDescription`, `score`, `visualScore`, `textScore`.
- **Browse by handle**: `list` with `tagNames` (all), `anyTagNames`,
  `excludeTagNames`, `pieceType`, `medium`, `onlyLiked`, `onlyStarred`,
  `folderId` (+ `includeDescendants`). Tag names match canonically.
- **More like this**: `similar` with `assetId` (visual by default).
- **Hand me N references**: `refs` searches (or lists), downloads the top
  matches and writes `refs.json` + `refs.md` with each piece's description,
  tags, prompt and source. The one call for "pull references for this task".
- **Already saved?**: `sources` with a list of permalinks, before any
  extraction run.
- **Which tags exist**: `tags` (optionally `search`), before inventing one.
- **A copied ID** (`asset:<id>`, `pack:<id>`): `getById` with the token
  verbatim.
- **The bytes**: `download` to the session scratchpad.

## Hard rules

- **Never save a prompt without its image or video** unless Michael says yes to
  `allowPromptOnly`. If the media can't be fetched, stop and ask.
- **A screenshot of a prompt is not the asset.** Read the text into
  `promptText`; only generated outputs are assets.
- **Never star, feature, publish or set the taste collection** unless Michael
  asked to publish. Star equals featured, and featuring makes a piece public.
- **Never create folders named Characters, Locations, Scenes or Inspirations.**
  Those are tags.
- **Write `agentDescription` on every save you make.** No description, no
  save.
- **Leave `pillar` unset** on ordinary saves.
- **Read back after saving** and report the `asset:<id>`s, plus anything
  skipped and why.

## Access

Claude Code saves and reads through the direct Convex scripts today:

```bash
bun run ~/.agents/skills/laniameda-gallery/scripts/ingest.ts '<JSON>'
bun run ~/.agents/skills/laniameda-gallery/scripts/query.ts '<JSON>'
```

They need `CONVEX_URL` and `KB_OWNER_USER_ID` from the repo's `.env.local`, and
the deployment rules in `references/maintenance.md` (one deployment,
`dev:perfect-buffalo-375`; prefix `CONVEX_DEPLOYMENT` on every CLI call). The
script takes `folderIds` (first is primary) and warns on stderr when a save
would mint a new tag. The gallery MCP server (`save_asset`, `search_gallery`,
`find_similar`, `check_sources`, …) is the multi-user path, and isn't
registered in Claude Code yet.
