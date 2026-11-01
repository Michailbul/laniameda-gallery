# In-place edits

Branch `feat/in-place-edits`, 1 Nov 2026. Port of the reviewer kit's quick edit
(`~/AI-video-work/laniameda/reviewer-kit/server.py`, `web/board.js`, plan in
`GALLERY-PLAN.md`) into the gallery.

| Kit | Gallery |
|---|---|
| `MODELS`, `estimate`, `edit_size`, `aspect`, `build_input`, `blocked()` | `lib/edit-models.ts` |
| `Fal` / `Pika` submit + poll, billing `charge_micro_usd` | `convex/editRunner.ts` |
| `Board.queue` ($30 refusal, one job per model per take), `retry` | `convex/editJobs.ts` `startEdit`, `retryEdit` |
| resume by request id on restart | the scheduler poll chain; Retry re-polls after a timeout or failed filing |
| jobs/*.json, costs.jsonl | `editJobs` rows (`estimateUsd`, `chargedUsd`, `chargedExact`) |
| edits/ folder | a new asset in the source's collections, `edit_source` lineage |
| `sideHtml` edit panel, `takesHtml`, `stageHtml` wipe | `components/gallery/edit-in-place.tsx`, `before-after-wipe.tsx` |

Differences from the kit: the source and references go to the provider as their
public gallery URLs, so there is no upload step; key 5 (save a character's main
image) is the gallery's character registry instead (sheet and face).
