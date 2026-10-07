# YouTube channel research workspaces

Use the existing `/youtube` collection filters and owner-only proposals. A channel
concept is a research workspace, not a created YouTube account. Source channel
statistics stay on video references; our proposed channel is its own collection.

The **Europe / Germany** concept uses `channel-europe-self-sabotage`. Ten related
references are linked in the database and three existing draft ideas remain
Untested. Sources may belong to multiple collections without duplication. Use
`reference-topic`, `reference-packaging`, `reference-hook`, `reference-format`,
`reference-script`, and `reference-facts` to record intended reuse. A facts role
means research material; verify the claim against primary sources before scripting.
Preserve owner likes, notes, previous collections and proposals.

Every new proposed target niche needs independent checks for demand, audience
visual fit, the exact topic/format crossing, prior attempts and urgency. Show
concrete titles and adaptation instructions with video evidence. Missing checks
remain visible as unknown. Public views do not establish viewer demographics,
CTR or retention. Existing proposal records remain readable.

## Hosted chronological previews

Hover/focus previews sample up to24 actual YouTube seek tiles across the video.
The authenticated saved-video route first reads public metadata from the existing
R2 bucket under `youtube-storyboards/v1/<videoId>.json`, then tries watch metadata.
The cache contains only public video ID, duration, checked date and tile metadata.
No private notes, proposals, user data or credentials belong there.

For newly saved references, collect a shortlist of at most50 IDs:

```sh
bun scripts/collect-youtube-storyboards.ts --ids ids.json --output snapshots.json
bun scripts/cache-youtube-storyboards.ts --snapshots snapshots.json --deployment perfect-buffalo-375
```

The collector stops on the first429; back off rather than continuing requests.
Failed metadata requests never replace good snapshots. The publisher validates
metadata, uses existing storage credentials in memory only, and reads public
objects back. Runtime needs no write credentials. Missing/unusable storyboard
images retain the existing stored-still fallback. Three fallback stills do not
constitute a full visual inspection.

Initial coverage on5October2026:276 of546 saved references have public metadata
cached; the remaining collection request hit429. Do not claim full coverage.
Refresh only new or shortlisted references during recurring research, and check
the hosted endpoint plus actual images before declaring a preview usable.
