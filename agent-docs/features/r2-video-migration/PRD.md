# PRD — Migrate video assets to Cloudflare R2

> Move video bytes off Convex `_storage` to Cloudflare R2 to eliminate egress
> overage and free up the Free-tier file-storage budget. Images, embeddings,
> and posters stay on Convex. Existing videos migrate cleanly. Both manual
> ingest paths (Seedance modal, generic upload panel) and agent ingest
> (`agent_ingest.ts`, used by the `laniameda-gallery-ingest` skill) target R2
> for video kind after this lands.

---

## 1. Problem & motivation

- The Convex Free tier was tripped (1 GB file storage, 1 GB egress/mo) almost
  entirely by video assets and the gallery's hover-to-play behaviour.
- A typical Seedance video is 10–30 MB. ~50 videos fills the entire free file
  budget. Each hover-play streams the full file from Convex storage.
- Convex Free overage: $0.033/GB storage, **$0.132/GB egress**.
- Cloudflare R2: $0.015/GB storage, **$0 egress**. Same data hosted on R2
  drops the bill from ~$40/mo (active vault scenario) to ~$0.08/mo.
- Convex ships an official `@convex-dev/r2` component that handles presigned
  uploads (browser → R2 direct), server-side `store()`, and `deleteObject()`
  — so we don't write or maintain an AWS SDK wrapper.

## 2. Goals

- All new **video** ingests write bytes to R2, not Convex `_storage`. Three
  ingest paths must be updated:
  1. `components/seedance-ingest-modal.tsx` (manual Seedance ingest)
  2. `components/upload-panel.tsx` (generic uploader)
  3. `convex/agent_ingest.ts` (agent / `laniameda-gallery-ingest` skill)
- Existing videos in Convex `_storage` migrate to R2 in a one-shot script
  with a 24h soak before the Convex blob is deleted.
- Hydration and the gallery UI render R2-hosted videos transparently (no UI
  regression).
- Asset deletion (single, replace, bulk) cleans up the R2 object.
- Generated poster image is created at upload time and stored on Convex
  `_storage` so video cards can render a still without streaming the video.
- Convex bill returns to the Free tier after migration + cleanup.

## 3. Non-goals

- Moving image assets to R2 — small, multimodal-embedded, not a cost
  problem.
- Custom domain for R2 — use the Cloudflare-issued `pub-<hash>.r2.dev`
  public URL. Custom domain can be added later without a schema change.
- Signed (time-limited) read URLs — use public bucket. Same access model
  as the current Convex `_storage` URLs. Locking down later is a hydration
  helper change, no schema migration.
- Adaptive bitrate / HLS / transcoding — Seedance MP4s play directly.
- Migrating thumbnails or design-extension previews to R2.

## 4. Decisions (locked in)

| Decision | Choice | Rationale |
|---|---|---|
| R2 component | `@convex-dev/r2` | Built-in presigned uploads, `store()`, `deleteObject()`, server-side metadata table. No AWS SDK code to maintain. |
| Public hostname | `pub-<hash>.r2.dev` (auto-issued at bucket creation) | No custom domain owned. Custom domain can swap in later by changing `R2_PUBLIC_BASE_URL` env var. |
| Access model | Public bucket | Matches current Convex `_storage` URL behaviour (anyone-with-URL). Simpler hydration. |
| Asset linkage | New `r2Key` (and reserved `r2Bucket`) field on `assets` row | Don't overload `sourceUrl` (already means "external page" / "url-ingested upstream"). Keeping bucket explicit allows a future migration to a different bucket without re-ingest. |
| Poster frames | Convex `_storage` via existing `thumbStorageId` | Tiny (~50 KB), keeps multimodal embedding working on the still, no second upload path. |
| `bulkDeleteAssets` orphan fix | Bundled into Phase 1 | Three-line additive fix; prevents the bug from worsening once R2 is wired. |
| Pre-migration backup | Skipped | User decision. R2 has its own durability; soak window is the safety net. |
| Agent ingest | In scope | Critical for the `laniameda-gallery-ingest` skill which is the primary ingest path for the studio. |

## 5. Architecture

```
┌─────────────────────┐    presigned PUT URL    ┌───────────────┐
│ Browser (modal /    │ ──────────────────────▶ │ R2 bucket     │
│ panel / agent CLI)  │     direct upload       │ pub-xxx.r2... │
└─────────────────────┘                         └───────────────┘
            │                                            │
            │ /api/ingest with r2Key + posterFile         │
            ▼                                            │
   ┌──────────────────┐                                  │
   │ convex/ingest.ts │                                  │
   │  createAsset     │ ── stores poster on _storage     │
   │  with r2Key      │                                  │
   └──────────────────┘                                  │
            │                                            │
            ▼                                            │
   ┌──────────────────────────┐                          │
   │ Hydration                │   public URL =           │
   │ galleryAssetResults.ts   │   R2_PUBLIC_BASE_URL +   │
   │ + 2 mirrors              │   "/" + r2Key   ────────▶│
   └──────────────────────────┘                          │
                                                         │
   ┌──────────────────┐                                  │
   │ Gallery card     │ ◀────────────────────────────────┘
   │ <video src=URL>  │     (browser fetches from r2.dev)
   └──────────────────┘
```

For the agent ingest path the source isn't a browser but a Convex action
that already has the bytes in scope. The component's `store(ctx, blob)`
helper is called server-side.

## 6. Schema changes

`convex/schema.ts` — `assets` table:

```ts
r2Key: v.optional(v.string()),       // e.g. "videos/2026/05/abc123.mp4"
r2Bucket: v.optional(v.string()),    // optional; default bucket assumed
```

Both **must** be optional (existing rows and image rows won't have them).
No new index.

Validators that surface raw asset rows must declare the new fields:

- `convex/galleryAssetResults.ts` — `galleryAssetResultValidator`
- `convex/assets.ts` — `getAsset`, `listAssets` return shapes

## 7. Hydration

Single change, mirrored in three files. Fallback chain:

```ts
const url = asset.r2Key
  ? `${process.env.R2_PUBLIC_BASE_URL}/${asset.r2Key}`
  : asset.storageId
    ? (await ctx.storage.getUrl(asset.storageId)) ?? undefined
    : asset.sourceUrl;
```

Files:

- `convex/galleryAssetResults.ts` (`hydrateGalleryAssetResults`)
- `convex/designInspirations.ts` (preview hydration)
- `convex/assetPacks.ts` (pack preview hydration)

## 8. Phased rollout

### Phase 0 — Cloudflare provisioning (manual, ~10 min)

1. Cloudflare → R2 → Create bucket (e.g. `laniameda-gallery-videos`).
2. Bucket → Settings → **Public access** → Enable. Copy the
   `pub-<hash>.r2.dev` URL — this becomes `R2_PUBLIC_BASE_URL`.
3. Account → R2 → Manage API Tokens → Create token with **Object Read &
   Write** scoped to the bucket. Copy access key ID, secret, account ID,
   token value, and S3 endpoint.
4. Bucket → Settings → CORS → add a permissive `GET, HEAD` rule for
   `https://laniameda-galery.vercel.app` (and `http://localhost:3000` for
   local dev). Required for the browser to PUT directly.
5. Test the bucket: upload a small test object via the dashboard, fetch
   the `pub-<hash>.r2.dev/<key>` URL in a browser. Must return 200.

### Phase 1 — Foundation (PR 1, ships first)

No user-visible change. New videos still go through the Convex storage
path. The schema, component, hydration fallback, and deletion are all
ready for Phase 2.

1. `bun add @convex-dev/r2`
2. `convex/convex.config.ts`:
   ```ts
   import r2 from "@convex-dev/r2/convex.config";
   app.use(r2);
   ```
3. Set Convex env (`bunx convex env set`):
   - `R2_BUCKET`
   - `R2_TOKEN`
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
   - `R2_ENDPOINT`
   - `R2_PUBLIC_BASE_URL` (e.g. `https://pub-abc123.r2.dev`, no trailing
     slash)
4. Schema additions: `r2Key`, `r2Bucket` (optional).
5. Update validators in `galleryAssetResults`, `assets:getAsset`,
   `assets:listAssets`.
6. Hydration fallback in three files (above).
7. Wire `r2.deleteObject(ctx, asset.r2Key)` into:
   - `assets.deleteAsset` — additive after existing `_storage.delete`
     loop.
   - `assets.replaceAssetMedia` — when replacing a row that has an
     `r2Key`.
   - `assets.bulkDeleteAssets` — also fix the existing storage orphan
     bug (add the missing `_storage.delete` loop, then the R2 delete).
8. Unit test `tests/r2-hydration.test.ts` — asserts the
   `r2Key → storageId → sourceUrl` fallback ordering.

### Phase 2 — New videos go to R2 (PR 2)

1. `lib/video-poster.ts` — pure utility:
   `extractVideoPoster(file: File): Promise<Blob>`. Hidden `<video>`,
   seek to 0.1s, draw to canvas at max edge 720px, JPEG q=0.82.
2. `lib/video-ingest.ts` — shared helper called by both manual paths.
   Steps: extract poster → call component upload helper → return
   `{ r2Key, posterBlob, contentType, size, width, height }`.
3. `components/seedance-ingest-modal.tsx` — replace the second
   `ingestOne` call (the video) with the new flow. Image upstream still
   flows through the existing image ingest path.
4. `components/upload-panel.tsx` — branch on file kind. Video → R2 path.
   Image → existing path unchanged.
5. `app/api/ingest/route.ts` — accept new optional fields: `r2Key`,
   `r2Bucket`, `mediaContentType`, `mediaSize`, `mediaKind`,
   `posterFile` (multipart). Forward to Convex.
6. `convex/ingest.ts` — `ingestFromApi` branches: if `r2Key` is set,
   skip `processMediaInput`, store the poster via
   `ctx.storage.store(...)`, build a `ProcessedMedia` shape with
   `storageId: undefined` and `r2Key` set. Pass through to
   `assets.createAsset`. `createAsset` accepts the new optional
   `r2Key`.
7. `convex/agent_ingest.ts` — at line ~447 where `ctx.storage.store(blob)`
   runs, add a kind branch:
   - If `media.kind === "video"`: call `r2.store(ctx, blob, { ...key })`
     to push to R2, get the key back, do **not** call
     `ctx.storage.store`. Build a poster server-side from the video
     bytes (use `ffmpeg.wasm` or a simpler "no poster yet" fallback —
     decision below).
   - Else: existing code unchanged.
   - **Open question:** server-side poster extraction from video bytes
     in a Convex action. Options:
     a. Skip server-side posters; agent-ingested videos render without
        a poster (fall back to first-frame from `<video preload>`).
        Matches existing skill contract (skill explicitly states
        posters aren't auto-generated).
     b. Use a lightweight WASM tool. Heavier dependency.
     c. Client-side step in the skill: capture poster in the script
        before sending, pass as `posterBase64` field. Adds complexity
        to the skill.
   - **Recommended: option (a)**. Matches existing skill behaviour
     (line 99 of the skill: "A poster/thumbnail is not generated
     automatically for videos"). Skill users can manually replace the
     thumbnail later.

### Phase 3 — Migrate existing videos (PR 3)

1. Convex action `convex/r2.ts:migrateVideoToR2` (`"use node"`):
   - Args: `{ assetId, dryRun }`.
   - Skip if `kind !== "video"`, `r2Key` already set, or no `storageId`.
   - `const blob = await ctx.storage.get(asset.storageId)`.
   - Build R2 key (e.g. `videos-migrated/${ownerUserId}/${assetId}.mp4`).
   - `await r2.store(ctx, blob, { key })` — component handles the put.
   - HEAD-verify via `pub-<hash>.r2.dev/<key>` (size must match).
   - If real: `db.patch(assetId, { r2Key, r2Bucket })`.
     **Leave `storageId` in place for 24h** — safety net.
2. `scripts/migrate-videos-to-r2.ts` — paginated driver, dry-run mode,
   batch size flag. Same shape as `scripts/backfill-semantic-index.ts`.
3. `scripts/cleanup-migrated-convex-video-blobs.ts` — runs 24h after
   step 2. For assets with `r2Key` and `storageId` set, delete the
   `_storage` blob and clear the `storageId` field.

## 9. Files to change

### Phase 1
- `convex/convex.config.ts` (new component registration)
- `convex/schema.ts` (`r2Key`, `r2Bucket`)
- `convex/galleryAssetResults.ts` (validator + hydration)
- `convex/designInspirations.ts` (hydration mirror)
- `convex/assetPacks.ts` (hydration mirror)
- `convex/assets.ts` (validators, `deleteAsset`, `replaceAssetMedia`,
  `bulkDeleteAssets` fix)
- `tests/r2-hydration.test.ts` (new)
- `package.json` / `bun.lockb` (component dep)

### Phase 2
- `lib/video-poster.ts` (new)
- `lib/video-ingest.ts` (new)
- `components/seedance-ingest-modal.tsx`
- `components/upload-panel.tsx`
- `app/api/ingest/route.ts`
- `convex/ingest.ts`
- `convex/agent_ingest.ts`

### Phase 3
- `convex/r2.ts` (new — migration + delete actions)
- `scripts/migrate-videos-to-r2.ts` (new)
- `scripts/cleanup-migrated-convex-video-blobs.ts` (new)

## 10. Env vars summary

| Var | Where | What |
|---|---|---|
| `R2_BUCKET` | Convex env | Bucket name |
| `R2_TOKEN` | Convex env | API token value |
| `R2_ACCESS_KEY_ID` | Convex env | Access key id |
| `R2_SECRET_ACCESS_KEY` | Convex env | Access key secret |
| `R2_ENDPOINT` | Convex env | S3-compatible endpoint, e.g. `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_PUBLIC_BASE_URL` | Convex env | The `pub-<hash>.r2.dev` URL (no trailing slash) |

Vercel env: nothing new for this migration. Hydration runs server-side
in Convex, which has its own env. The browser only ever sees URLs
already constructed for it.

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| R2 outage post-cleanup → videos return 5xx | 24h soak between Phase 3 migration and cleanup script; the soak window catches misconfigs before bytes are gone from Convex. |
| Component schema changes break hydration test | Pin component version in `package.json`. Unit test catches drift. |
| CORS not configured → browser PUT fails | Phase 0 step 4 + Phase 1 manual smoke (test upload from local dev). |
| `pub-<hash>.r2.dev` URL not stable across bucket recreation | Treat the bucket as durable. If a fresh bucket is needed, run a re-migration to update `r2Key` (no schema change). |
| Vercel build accidentally references R2 env | None expected — server-side hydration runs in Convex. Verified during PR 1 review. |
| Skill (`laniameda-gallery-ingest`) instructions go stale | Update skill SKILL.md after Phase 2 lands to note that videos now route to R2 transparently. No agent-side code change required. |

## 12. Success criteria

- [ ] New Seedance modal upload of a video writes bytes to R2 (verified
  via Cloudflare dashboard) and renders correctly in the gallery.
- [ ] New generic-panel upload of a video writes to R2.
- [ ] Agent ingest of a video (via `laniameda-gallery-ingest` skill)
  writes to R2.
- [ ] All gallery videos play correctly after migration. Source URLs
  resolve to `pub-<hash>.r2.dev`.
- [ ] Convex `_storage` size drops by ≥90% after Phase 3 cleanup.
- [ ] Asset deletion from the gallery card removes the R2 object
  (verified by HEAD-fetching the URL → 404).
- [ ] No new Convex egress overage warnings for ≥7 days post-cleanup.

## 13. Open questions

1. **Bucket name** — `laniameda-gallery-videos` proposed. Confirm or
   suggest alternative.
2. **Migration batch size** — start with 1 (sequential) and raise to 3
   if upload throughput is fine. Final value chosen at Phase 3 dry-run
   review.
3. **Skill update timing** — should the `laniameda-gallery-ingest`
   skill SKILL.md be updated as part of Phase 2 or as a follow-up? No
   skill behaviour change is required — only a note about where bytes
   land.

## 14. Out-of-band follow-ups (post-migration)

- Add a "Storage used" indicator to the gallery sidebar (sum of
  `assets.size` across the user's vault) so the next overage is visible
  before it triggers.
- Generate a video poster server-side at upload time (currently
  deferred — agent-ingested videos lack a poster).
- Consider migrating images to R2 only if image storage becomes a cost
  driver. Today it isn't.

---

_Last updated: 2026-05-04. Owner: Michael._
