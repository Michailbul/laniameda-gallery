# Agent search: how relevance was measured (12 Nov 2026)

The agents' `search_gallery` returned the 24 nearest pieces whether 4 or 400
pieces answered the request. Embeddings rank by likeness and never say no.
Since 12 Nov it checks each candidate with a decision model
(`semanticSearch:searchAssetsVerified`, `convex/searchVerify.ts`) and returns
only pieces that answer the whole request.

The labels, contact sheets and scripts hold private asset ids and live outside
this public repo: `~/AI-video-work/laniameda/search-eval-2026-11-12/`.

## Method
- 44 agent-style searches (single subjects, names, styles, multi-part
  requests, exclusions). For each, the live search's top 24 and top 100 and
  the raw lane hits were collected on 12 Nov.
- Graders: one Claude subagent per search read numbered contact sheets plus
  what the gallery wrote about each piece, and labelled every piece 2 (right:
  every part of the request), 1 (partial: main subject there, a detail missing
  or doubtful) or 0 (wrong). Told to be strict.
- Two sets: 17 searches for tuning, 12 held out. The held-out searches' required
  parts and the threshold were fixed before any of their results were seen.
- Grader agreement: a second, independent grader relabelled 8 searches.
  Right-vs-not agreement 92.8%; of one grader's "right" pieces the other agreed
  on 84% and 91%. That is the ceiling for any single-judge precision figure.

## What the check asks
One yes/no for the whole request and one per required part (`mustShow`), each
with a description of what counts as no. Naming "small, far off or only in the
background" as a no moved right results on the tuning set from 79% to 88%.
match = whole x weakest part; >= 0.7 is a match, whole >= 0.5 otherwise is
"near". Wording and thresholds: `lib/search-relevance.ts`.

## Results
Precision = share of returned pieces (at most 24) the grader labelled right.
None wrong = share labelled right or partial. Recall = right pieces returned /
right pieces available (up to 24).

| Set | Method | Right | None wrong | Recall | Returned per search |
|---|---|---|---|---|---|
| Tuning, 17 | today's search, top 24 | 59.8% | 92.2% | 81.6% | 24 |
| Tuning, 17 | Gemini, whole request >= 0.8 | 74.9% | 99.7% | 90.0% | 21.1 |
| Tuning, 17 | Jev, whole x parts >= 0.7, plain wording | 82.7% | 99.7% | 82.9% | 17.6 |
| Tuning, 17 | Jev, whole x parts >= 0.7, shipped wording | 87.5% | 100% | 84.3% | 16.9 |
| **Held out, 12** | **today's search, top 24** | **58.0%** | **89.9%** | — | **24** |
| **Held out, 12** | **shipped check (Jev), >= 0.7** | **91.0%** | **100%** | **80.4%** | **16.6** |
| Held out, 12 | same, >= 0.8 | 95.3% | 100% | 72.0% | 14.2 |

On the held-out set the pieces between the match and near thresholds held 51
more right pieces among 126 (121 at least partial); `includeNear` returns them.
The held-out pools were today's first 60 results only; the live search reads
up to 240 candidates, so recall there is a lower bound.

Weakest held-out searches: "minimalist poster with big typography" (5 of 22
right pieces kept: the check reads "big type" more strictly than the grader),
"city street at night with no cars" (12 of 24 kept, all 12 right), "airship in
the sky" (8 of 18 kept).

## Live check after the push (12 Nov 2026, Jev answering)
Seven held-out searches through `semanticSearch:searchAssetsVerified` on the
live gallery. Of the matches graders had already labelled, 74 of 87 right and
none wrong. First search 3–7.5 s with whole waves checked at once (20–37 s
before that change); the same search again 0.5–0.7 s. Without `mustShow`,
"silhouette against a sunset" got 16 of 22 right (with parts offline: 16 of
19): agents should always pass the parts.

## Not measured
- Gemini Decision with required parts and the shipped wording: its prepaid
  credit ran out during the first run. The shipped order is Gemini first,
  then Jev; Gemini's per-part answers are unvalidated until rerun.
- Searches without `mustShow` (whole-request question only) on the held-out set.
- Video judged as video (the check sees a video's poster).

## Costs
Jev: ~3,500 input tokens a piece with three questions, about $0.00015 a piece,
~1 s for 30 at once. A first verified search of 24 reads 60–240 candidates,
so about $0.01–0.04; repeats answer from `pictureJudgments`. This evaluation
spent about $0.35 on Jev and used up the remaining Gemini prepaid credit
(~4.8M tokens, ~$0.50 at the list price).
