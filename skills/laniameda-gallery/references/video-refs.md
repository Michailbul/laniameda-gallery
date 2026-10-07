# YouTube research references

A YouTube reference is a separate research record in videoRefs, shown at
/youtube and /youtube/<YouTube-id>. It keeps the source video, dated metrics,
channel facts, visual stills and clearly labelled analysis. Asset semantic
search does not include these records. Michael's generated or downloaded video
files are ordinary media assets; a reference record does not ingest that video.

## Save facts and distinguish interpretation

Use save_video_refs, list_video_refs, get_video_ref, update_video_ref and
delete_video_ref. Use list_video_refs_page for complete inventories. Discover the deployed schemas first. Send the original
YouTube URL or 11-character ID. Saves are idempotent per video: another save
updates supplied research fields, merges theme/tag labels and preserves
Michael's userNote and isLiked. A save is not a generation prompt extraction.

| Field | Meaning |
|---|---|
| url, externalId, title | Original video identity and source title |
| views, publishedAt, durationSeconds | Video metrics checked at a stated time |
| channelName, channelHandle, channelUrl, subscribers | Channel identity and dated size |
| medianViews, isChannelBest, channelLastUploadAt | Research findings; state the sampling window/method in notes and omit unverified values |
| checkedAt | When the supplied numbers were actually verified; ISO date or epoch milliseconds |
| collections | Plain theme labels such as youtube-cars-competitors; these are not gallery collection IDs |
| topic, styleFamily, productionStyle, language | Subject and observed visual/spoken format; infer only from inspected material |
| styleDescription, format, whyItWorks, hook, titlePattern, thumbnailPattern, audience | Analysis based on inspected evidence; performance correlation does not prove causation |
| bendIdea | Michael's reuse idea, retained in the private record |
| agentDescription | One or two factual sentences, about 45 words maximum, saying what it shows and why kept |
| tagNames | Plain research labels, separate from typed gallery tags |
| thumbUrl, frames | Persisted thumbnail and still media |
| userNote, isLiked | Michael's own metadata, preserved by research upserts |

There is no mandatory faceless, 50K median, language, subscriber or channel-
qualification gate. Apply such editorial filters only when Michael requests
them. Existing passes-filters tags and fits=1 links remain legacy curated
labels; their presence does not establish current eligibility or verified
evidence. Do not fabricate facts or claim a channel passed unrequested tests.
Prefer existing theme labels and report saved IDs and failures.

## Stills and timed previews

By default the save action attempts to copy YouTube's thumbnail and numbered
automatic stills into R2. Supplied thumbnailUrl and up to six public HTTPS
frameUrls may override them; refreshMedia: true requests a refresh on a repeat
save. Inspect the result and readback before claiming media persisted.

Saved frame reads report sourceKind: youtube-auto-still, supplied-still or
legacy-unverified; sourceUrl is retained when known. positionVerified is false.
Automatic and legacy frames use neutral labels such as YouTube still 1.
No exact time or 25/50/75-percent position is inferred from these stills.
A thumbnail is packaging, so inspect actual video footage before describing
movement, the hook or the first 30 seconds.

The chronological hover/scrub storyboard preview on the website is a separate
timed preview/cache path. Its timeline does not make the saved automatic stills
timestamp-verified, and it is not an archived original video file.

## Examples

```bash
bun <this skill>/scripts/gallery.mjs save_video_refs '{"items":[{
  "url":"https://www.youtube.com/watch?v=<video-id>",
  "title":"<source title>",
  "checkedAt":"<actual verification date>",
  "agentDescription":"<observed format and why Michael kept it>",
  "collections":["youtube-cars-competitors"],
  "tagNames":["youtube","cars"]
}]}'

bun <this skill>/scripts/gallery.mjs list_video_refs '{"collection":"youtube-cars-competitors","sort":"views","limit":20}'
bun <this skill>/scripts/gallery.mjs list_video_refs '{"productionStyle":"Whiteboard animation","language":"en","sort":"recent"}'
```

Optional list filters include collection, topic, styleFamily, productionStyle,
language, tagNames, channelHandle, search, onlyLiked, onlyChannelBest,
minViews and publishedAfter. productionStyle/language match case-insensitively;
every supplied tag must match. sort is views, recent or saved; limit is bounded
at 2000. Keyword search matches words in research metadata rather than semantic
image/video content. A bounded list is not proof of an exhaustive inventory.

list_video_refs_page accepts the same filters (without sort/limit), cursor and
pageSize from 1 to 200. It returns videos, cursor, isDone, scannedCount and
order: owner-candidate-createdAt-desc. Keep filters unchanged and continue until
isDone:true even through empty matching pages. For complete ranked research,
collect all pages and sort locally by views/date. The Bun client videoRefs.pages(),
all() and inventory() follow this surface. CLI all_video_refs starts from the
beginning and writes <output-directory>/videos.json:

```bash
bun <this skill>/scripts/gallery.mjs all_video_refs '{"pageSize":200}' --out ./youtube-inventory
```

## Edit, sharing and privacy

update_video_ref edits userNote/isLiked or replaces the complete collections
theme list. delete_video_ref deletes the record; perform deletion only when
Michael authorizes it. Local/admin scripts/video-refs.ts is a compatibility
path requiring signed owner access; hosted MCP is preferred.

The website is a shareable YouTube research surface behind its configured page
password; the owner's signed session bypasses that password. It exposes video/
channel facts, tags, themes, stills and several analysis fields, including hook,
whyItWorks, format, titlePattern and thumbnailPattern. userNote and bendIdea
are omitted from the public projection. Do not put private plans in shareable
analysis fields. A page password is distinct from gallery OAuth/token scope.

Views are Videos, Thumbnails and Channels. URL filters select theme, visual
production style, channel, upload window, words and curated tags; sorting also
includes views per day and breakout ratios. New theme labels appear automatically;
display order/names are website presentation in lib/youtube-page.ts. Research
theme membership does not file a media asset in a World.
