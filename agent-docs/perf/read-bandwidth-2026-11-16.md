# Read bandwidth cuts, 16 Nov 2026 (branch `perf/read-bandwidth`)

Why: Convex usage 18 Oct – 16 Nov was 136.77 GiB of database I/O (50 included,
$17.40 over) and 96.03 GiB of egress (50 included, $5.64 over), nearly all on
`perfect-buffalo-375`. Function calls (1.25M of 25M) were not the bill; bytes
per run were. On 15 Nov the team hit its $23 spending cap and every
deployment was switched off.

Measured per function in that period (Convex usage API):

| Function | Calls | DB read | Change on this branch |
|---|---|---|---|
| `skills:listSkills` | 10,798 | 32.2 GiB | Steps read once per card (were read twice), the skill row once (was twice), step frames streamed and stopped at the preview count (was every frame of a step). |
| `showcase:getShowcaseHome` | 2,843 | 19.1 GiB | Featured reel reads `by_isPublic_isFeatured_createdAt`: only featured public pieces, not the newest 2,000 public assets. |
| `menuFilters:listMenuFilters` | 10,979 | 16.0 GiB | Collection pills read the folder's stored `memberCount` (exact, the sidebar already shows it), not every membership link. Tag pills unchanged. |
| `menuFilters:listPublicMenuFilters` | 999 | 4.9 GiB | Public slice read once and only when a pill needs it; tag pills count off its `tagIds` (the grid's own match) instead of also reading every tag link; collection pills read `publicMemberCount`. |
| `agentAssets:listAssetsPage` | 32,857 | 13.7 GiB | None. One page of full cards per call; every row it reads is in the answer. The volume is agents paging the vault; the cached export (`/api/agent/inventory`) is the cheaper path. |
| `assets:listGalleryAssetsPage` | 46,752 | 10.7 GiB | None. Already paginated with a read budget. |
| `mjQueue:listQueue` | 80,250 | 8.7 GiB | None. The extension poll went from 4 s to 15 s on 15 Nov (`d6c0d0c`), after most of this window. Convex cache hits cost no DB bandwidth, so the remaining cost is re-runs after queue writes. |

Egress: `semanticIndex:reindexAsset` 35,350 calls, 90.2 GiB. Two causes fixed:

1. The legacy pixel hash folds in `isPublic` and `pillar`, so publishing,
   starring, bulk curation or re-filing made the stored pixel vector look stale
   and downloaded the original again. Now a row whose hash matches under its
   own stored scope is reused.
2. Text-only writers (tags, descriptions, prompts, bookmarks, curation, role,
   filing, design links, duplicate merges) now pass `textEdit: true`. A current
   pixel vector is always reused; a missing one is fetched only when the asset
   is over 10 minutes old (its own first index owns it before that) and no
   pixel retry failed in the last 6 hours.

Unchanged on purpose: the embedder still receives the original image (no
thumbnail, no downscale), the same models, the same text-lane fields, and a
real image change re-embeds exactly as before.

Tests: `tests/semantic-pixel-reuse.test.ts` (no image fetch on text or scope
edits; real image change still embeds; three cases fail on the old code) and
`tests/read-bandwidth.test.ts` (same card fields, counts and reel; reads 8
frames instead of 40, 124 asset rows instead of 324 on the home fixture; four
cases fail on the old code). The mock database now counts reads per table
(`harness.db.reads`).

Not measured live: deployments are disabled by the spending cap, so the new
index and functions are not pushed. After the 18 Nov reset, push with the
sanitized wrapper, let `by_isPublic_isFeatured_createdAt` backfill, then compare
the usage API's per-function DB read for the same functions.
