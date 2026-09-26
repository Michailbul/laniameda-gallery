# Extraction: from a source Michael liked to a gallery record

Michael saves things he likes all over: X bookmarks, Instagram, Pinterest,
Dribbble, websites, generation platforms. Extraction turns each one into a
gallery record another agent can find months later without context: the media
itself, where it came from, what it is, and why it was worth keeping.

## The loop

1. **List the items.** Source-specific, below.
2. **Skip what's already in.** Run query `sources` with the permalinks; drop
   every `alreadySaved` one. For bookmarks this makes a run incremental: walk
   newest-first and stop after about 10 saved posts in a row.
3. **Fetch the media at full quality** into the session scratchpad. The
   gallery needs a visual: an item with no image or video is not gallery
   material (see "No media" below).
4. **Pull the text that matters.** A generation prompt in the post, its alt
   text, or an image of a prompt (read it, don't save the screenshot as the
   asset; see the screenshot rule in `SKILL.md`). Plain commentary is not a
   prompt.
5. **Classify** with the tagging contract in `SKILL.md`: piece type, medium,
   platform, content, style. Use `source: "agent"` on every tag you infer.
6. **Write the `agentDescription`**: one or two sentences, 45 words at most, on
   what it shows and how it looks, why it's worth keeping, and `by @handle`.
   It leads the text lane of search and it's the field a future agent reads
   first. Look at the actual image before writing it.
7. **Save** with `sourceUrl` set to the post/page permalink, `ingestSource:
   "agent"`, the right `assetRole`, and a source-derived `ingestKey` so a rerun
   merges instead of duplicating.
8. **Report**: saved items with their `asset:<id>`, skipped items with the
   reason, and anything that needs Michael (login, missing media).

Batch in groups of about 10 and let each group finish. Every asset queues a
background reindex, and video reindexing is heavy (see "Timeouts and retries"
in `references/ingest.md`).

## Record shape for a captured reference

```json
{
  "filePath": "/path/to/scratchpad/x-1839204711-1.jpg",
  "sourceUrl": "https://x.com/<handle>/status/1839204711",
  "agentDescription": "Brutalist landing page hero with a slow parallax 3D product turn, black and acid-green palette. Kept for the depth layering. By @handle.",
  "assetRole": "inspiration_capture",
  "ingestSource": "agent",
  "tagNames": ["inspiration"],
  "typedTags": [
    { "name": "x", "category": "platform", "source": "agent" },
    { "name": "landing-page", "category": "design_type", "source": "agent" },
    { "name": "motion-design", "category": "content_type", "source": "agent" },
    { "name": "brutalist", "category": "design_style", "source": "agent" }
  ],
  "ingestKey": "x:1839204711:1"
}
```

- `assetRole`: `inspiration_capture` for someone else's work Michael liked;
  `reference` for material pulled in for a specific production;
  `generated_output` for his own generations.
- `ingestKey`: `<platform>:<native id>:<media index>`. Examples: `x:<status
  id>:1`, `ig:<shortcode>:2`, `pin:<pin id>:1`, `web:<host><path>:1`.
- A post with several images: one asset per image, same `sourceUrl`, index in
  the key. When they share a prompt, give them one `promptIngestKey`.
- A post that carries a real generation prompt: add `promptText`,
  `promptType`, and `modelName` only when the post names the model.
- Collections: only when Michael names one or the fit is certain. Otherwise
  leave it uncategorized; the tags carry it.

## No media

Text posts, threads, articles and link-only bookmarks have nothing for the
gallery to show. Don't save them prompt-only (that needs Michael's explicit
yes). Route knowledge-type posts to `laniameda-x-post` / `laniameda-youtube-digest`,
which digest into `laniameda-hq/content-kb/`, and list them in the report.

## Sources

### X bookmarks and posts

- **Browser:** Claude in Chrome, running in Comet (connected 26 Sep 2026).
  Work in the Claude tab-group window (`tabs_context_mcp` with
  `createIfEmpty: true`), never in Michael's own tabs.
- **URL:** `https://x.com/i/bookmarks`. It lands on `/i/history` with the
  Bookmarks tab selected. Scroll to load more; X virtualises the list, so
  collect permalinks as you go rather than at the end.
- **Read-only.** Never unbookmark, like, repost, reply or follow.
- **Images:** the `pbs.twimg.com/media/<id>` URL with `name=orig` gives the
  original size.
- **Video / GIF:** download from the post permalink with the
  `video-downloader` skill (yt-dlp). If it needs a login, stop and tell
  Michael. Don't export browser cookies to get around it.
- **Quote posts:** the media usually belongs to the quoted post; use that
  post's permalink as `sourceUrl`.

### Instagram

Posts, carousels and reels through the same logged-in browser. One asset per
carousel slide (`ig:<shortcode>:<n>`). Reels download with `video-downloader`;
`supadata` gets the transcript if the reel teaches something (that part goes to
the content KB).

### Pinterest, Savee, Dribbble, Behance, Awwwards

Save the original image, not the page screenshot, when the page offers it. For
websites and landing pages, a full-viewport screenshot is the asset; tag
`website` / `landing-page` with `design_type`, and add `motion-design` when the
reason to keep it is the motion (then capture a short screen recording if the
tool allows, since a still loses the point).

### Generation platforms (Midjourney, Higgsfield, Krea)

Michael's browser extension already saves from these and tags them `midjourney`
/ `midjourney-web`, `higgsfield` / `higgsfield-input`, `krea`. When an agent
saves from the same places, use the same tag names so both paths land in one
bucket. His own generations are `generated_output` with the prompt attached.

### Local files and Michael's own renders

The ordinary ingest path in `references/ingest.md`. Video goes through the
script's remux → probe → poster → R2 pipeline.

## Before a big batch

- Say how many items you found and how many have media, then run.
- Start with a sample of three and show Michael the records before the rest,
  unless he asked for the whole run outright.
