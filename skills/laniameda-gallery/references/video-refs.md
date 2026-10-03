# Video references: YouTube research

A **video reference** is a YouTube video kept as research: what performs, how it
looks, why it works. It is its own object (table `videoRefs`,
`convex/videoRefs.ts`), shown on the **YouTube** page (`/youtube`) and kept apart
from assets, so a batch of several hundred videos never floods the grid.

Use it when Michael says "save this YouTube video as a reference", "add these
competitors", "what do car channels do", "find a video in this style". A
generated clip of his own, or a video file he wants in a collection, is still an
ordinary asset (`references/ingest.md`).

## What one record holds

| Field | Meaning |
|---|---|
| `url`, `externalId`, `title` | The video. `url` accepts any YouTube link or the 11-character id. |
| `views`, `publishedAt`, `durationSeconds` | The video's numbers when it was saved. |
| `channelName`, `channelHandle`, `channelUrl`, `subscribers`, `medianViews` | A snapshot of the channel. `medianViews` is the median of its recent long-form uploads. |
| `isChannelBest` | The channel's best performer in the window the research looked at. |
| `collections` | Plain labels used as themes on the YouTube page, e.g. `youtube-cars-competitors`. They are not gallery folders. Lowercase, hyphenated. |
| `topic` | Subject area: `cars`, `history`, `success-stories`, `what-if`, `animation-styles`… |
| `styleFamily` | Plain-words name of the look: "Map animation", "3D cutaway and schematic animation". |
| `styleDescription` | What the picture is made of: materials, colour, type, how things move. |
| `format`, `whyItWorks`, `hook`, `titlePattern`, `thumbnailPattern`, `audience`, `bendIdea` | The analysis. Leave out what you did not check; never guess. |
| `agentDescription` | One or two plain sentences, 45 words at most. Required on every agent save, same rule as assets. |
| `tagNames` | Plain strings (not the typed tag table). |
| `thumbUrl`, `frames[]` | The thumbnail and the in-video stills, copied into R2 at save time. |
| `userNote`, `isLiked` | Michael's own. An agent save never overwrites them. |

## Stills are copied for you

Send the link. The save action copies YouTube's own thumbnail and its three
auto-captured frames (about 25, 50 and 75 percent of the video) into R2, so the
look survives the video being taken down. To supply your own stills instead,
pass `thumbnailUrl` and up to six `frameUrls` (public https image URLs).

Outside the gallery, the same stills are at
`https://i.ytimg.com/vi/<id>/maxresdefault.jpg` and `…/maxres1.jpg`, `maxres2.jpg`,
`maxres3.jpg`. Look at the frames before you describe a style: a thumbnail is
packaging and often shows nothing of how the video looks.

## Save

Idempotent per video: saving it again updates the numbers and notes, merges
`collections` and `tagNames`, and keeps the stills (pass `refreshMedia: true`
to copy them again). Up to 12 videos per MCP call; the script batches any number.

```bash
# MCP / gallery.mjs
node <this skill>/scripts/gallery.mjs save_video_refs '{"items":[{
  "url":"https://www.youtube.com/watch?v=zpkbsKs5DCw",
  "title":"Fiat’s Pocket Rocket. The Fiat X1/9 Story",
  "channelName":"Big Car","channelHandle":"@BigCar2",
  "subscribers":286000,"medianViews":117000,"views":172736,
  "publishedAt":"2026-07-24","durationSeconds":1294,
  "topic":"cars","styleFamily":"Archive photos, brochures and old ads, narrated",
  "styleDescription":"Period brochures and press photos held on screen with slow moves, one narrator.",
  "agentDescription":"Big Car model history told over archive brochures and press photos; kept as a car-history competitor.",
  "collections":["youtube-cars-competitors"],"tagNames":["youtube","cars"]}]}'

# Direct, on Michael's machine (any number of items, or @file.json)
bun run <this skill>/scripts/video-refs.ts '{"action":"save","items":[ … ]}'
```

Rules:

- **Faceless references only**, unless Michael says otherwise: no presenter on
  camera, no podcasters, no footage built on real people. Check the frames.
- **Nothing under 50K median views** for competitor research, and prefer each
  channel's best video of the last three to four months.
- Reuse existing `collections` labels (list first); ask before inventing a new one.
- Report the `video:<id>`s you saved and anything that failed.

## Find

```bash
# Most-viewed car competitors
node <this skill>/scripts/gallery.mjs list_video_refs '{"collection":"youtube-cars-competitors","sort":"views","limit":20}'

# One look, newest first, each channel's best only
bun run <this skill>/scripts/video-refs.ts '{"action":"list","styleFamily":"Map animation","sort":"recent","onlyChannelBest":true}'

# Words: every term must appear in the title, channel, style or notes
bun run <this skill>/scripts/video-refs.ts '{"action":"list","search":"cutaway engine","minViews":500000}'
```

Filters: `collection`, `topic`, `styleFamily`, `channelHandle`, `search`,
`onlyLiked`, `onlyChannelBest`, `minViews`, `publishedAfter` (ISO date or epoch
ms). `sort`: `views` (default), `recent` (upload date), `saved`. `limit` up to
2000. Each result carries `thumbUrl` and `frames[].url`; read those images when
the task is about a look.

`search` here is plain word matching. Video references are not in the semantic
index, so `search_gallery` does not return them.

## Edit and delete

`update_video_ref` (or `{"action":"update"}`) sets `userNote`, `isLiked` and the
whole `collections` list. `delete_video_ref` removes the record; ask first.
The YouTube page (`/youtube`) is public behind one password (`YOUTUBE_PAGE_PASSWORD`,
default `ANDROMEDA`; the owner's own session skips it). It lists videos or channels by
theme, Cars first, with sort and filters kept in the URL, and every video has its own
link (`/youtube/<youtube id>`) to share. `userNote` and `bendIdea` never appear there.
New collection labels show up as themes on their own; to name one or move it up the
order, edit `THEMES` in `lib/youtube-page.ts`. Likes, notes and deletes go through the agent
tools; the old in-gallery Videos tab is gone.
