---
name: laniameda-gallery-ingest
description: >-
  This skill should be used when the user asks to "add this to my gallery",
  "save this in my gallery", "put this in the Love collection", "ingest this
  prompt and video", "add these statics to the DADDY ISSUES world", "sort these
  into characters and locations", "make this a beat", or update/delete an
  existing gallery item. It resolves the authenticated user's collections,
  worlds, projects, and beats, and saves prompts, files, URLs, and visual
  references through the current gallery contract.
version: 0.3.0
---

# laniameda-gallery-ingest

Use this skill to ingest content into `laniameda.gallery` through the canonical backend contract in this repo.

The skill now supports explicit `create`, `update`, and `delete` operations through the same script entrypoint.

## Product language

- Interpret **"my gallery"** as the authenticated user's whole gallery, not a collection or legacy pillar named `creators`.
- Treat **collections** as the primary user-facing organization.
- **"World"** means the showcased top tier — the published story universe at
  `/w/<slug>`. Never showcase a project that sits inside one.
- **"Project"** groups a world's sectioned member collections and holds no
  assets itself. **"Beat"** is one video plus the statics it uses.
  **"Statics"** are the characters / locations / stills.
- Treat tags as descriptive classification, not navigation destinations.
- Leave the dormant `pillar` field unset on ordinary new saves. Use a specialized internal pillar only when its dedicated backend contract explicitly requires one, such as `cinema-inspiration`.

## Collection-first workflow

1. Call `list_collections` before saving whenever the user names a collection or asks to file content contextually.
2. Match requested names case-insensitively against `name` and `normalizedName`.
3. Reuse exact matches. Do not create a near-duplicate such as `love` when `LOVE` exists.
4. Ask before creating a missing collection unless the user explicitly requested creation.
5. Pass every requested collection ID in `folderIds` for asset saves. Preserve the user's order; the first ID becomes the primary/backward-compatible `folderId`.
6. Verify the saved asset after ingest and confirm its collection names, not a legacy pillar label.

When no collection is named, save uncategorized unless an obvious existing collection can be resolved with high confidence from the user's wording. Do not silently substitute a tag or pillar for a collection.

## Content hierarchy — worlds, projects, episodes, beats, statics

Everything in the vault is a `folders` row. There is no `worlds`, `beats`, or
`collections` table. The tiers are expressed with `folders.kind`,
`folders.parentFolderId`, and the `projectCollections` join table:

```
world      showcased root collection or root project — publishes /w/<slug>
└─ project kind:"project"        groups sectioned member collections
   ├─ episodes  kind:"episode"   chapters that group beats; hold no assets
   ├─ beats     one folder per video + its statics
   ├─ characters │
   ├─ locations  │ section pools of statics
   └─ stills     │
```

- **world** — the story universe and the ONLY tier that publishes.
  `folders:setFolderShowcased` allocates the stable `/w/<slug>` on first
  showcase. Two shapes coexist: a plain root collection with sub-collections
  (`Dear Annete`), and a root `kind:"project"` that is itself showcased
  (`CASSANDRA`, `DADDY ISSUES`, `LIZ`). Both are "the world" in conversation.
- **project** — `kind:"project"`. Holds no assets itself; groups member
  collections through `projectCollections`. A project nested under a world via
  `parentFolderId` cannot be showcased ("a project publishes inside its world").
- **episode** — `kind:"episode"`, filed in the project's `episodes` layer.
  Beats point at it via `projectCollections.episodeFolderId`. Holds no assets.
- **beat** — one video plus the statics it uses. Beats are **never pooled**:
  each beat is its own `kind:"direction"` folder linked at `section: "beats"`.
- **statics** — characters / locations / stills. These DO pool: one shared
  folder per section per project, named `"<PROJECT> — Characters"` etc.

`projectCollections` columns: `{ownerUserId, projectId, folderId, section,
episodeFolderId?, episodeOrder?, beatCharacterFolderIds?,
beatLocationFolderIds?}`. The two `beat*FolderIds` arrays link a beat to the
character/location directions it uses; they are read-side today with no
ingest-facing write API.

Naming convention: projects/worlds are ALL CAPS (`CASSANDRA`, `DADDY ISSUES`).
Section pools and episodes are namespaced `"<PROJECT> — <Label>"` so the same
label can exist in every project without colliding on `normalizedName`.

## Filing into a world

Resolve or create the destination BEFORE ingesting, then pass the resulting
`folderId` on each save. Direct-Convex mutations (admin/agent path):

```bash
# 1. statics — idempotent, returns the shared pool for that section
projects:ensureSectionPool {ownerUserId, projectId, section}
#    section is characters | locations | stills — NOT beats

# 2. a beat — one folder per video, then link it into the beats layer
folders:createFolder      {ownerUserId, name: "<PROJECT> — <Beat>", kind: "direction"}
projects:addCollectionToProject {ownerUserId, projectId, folderId, section: "beats"}

# 3. optional: file the beat under an episode
projects:createEpisode  {ownerUserId, projectId, name}
projects:setBeatEpisode {ownerUserId, projectId, beatFolderId, episodeFolderId, order?}
```

Then ingest with `folderId` set to the pool / beat folder. `createAsset` writes
the `assetFolders` link from `folderId`, so one `folderId` is enough — do not
also call an add-membership mutation.

### Publishing — showcasing is not enough

A world page renders ONLY assets with `isPublic: true`. A showcased world full
of private assets is a blank page. After ingesting into a world, curate:

```bash
assets:bulkSetAssetCuration {assetIds, actorUserId, isPublic: true, isFeatured?, adminSecret}
```

`adminSecret` must match `CURATION_ADMIN_SECRET`, and `actorUserId` must be in
`CURATION_ADMIN_USER_IDS` (both set on the deployment and in `.env.local`).
Asset-level `isFeatured` feeds the public home's featured reel; folder-level
`showcaseFeatured` is a separate hero treatment.

Or curate as part of the ingest, with `isPublic` / `featured` on the payload:

```json
{ "filePath": "/path/to/cut.mov", "featured": true }
```

**There is no private "featured" state.** `convex/assets.ts` force-ANDs
`isFeatured` with `isPublic`, so asking for `featured` publishes the asset and
puts it at the head of the reel on the public home page. Never set either flag
because a filename or a folder implies polish — only when the user has actually
asked to publish. If the secret is missing the ingest still succeeds and the
asset stays private, so re-running with the same `ingestKey` is safe.

Verify with `showcase:getWorld {slug}` before reporting done — it returns the
world's `sections` exactly as the public page will render them. For the public
home reel, `showcase:getShowcaseHome {}` returns `featuredReel` in render order.

## Read first

Before constructing payloads or changing the ingest script, read these repo files:

- `convex/schema.ts`
- `convex/validators.ts`
- `convex/ingest.ts`
- `convex/agent_ingest.ts`
- `convex/workflows.ts`
- `app/api/ingest/route.ts`

When the save targets a world, also read:

- `convex/folders.ts` — kinds, `parentFolderId` nesting rules, `setFolderShowcased`
- `convex/projects.ts` — `projectCollections`, section pools, episodes, beats
- `convex/showcase.ts` — what the public `/w/<slug>` page actually reads
- `lib/video-ingest.ts` — the browser upload path that the large-video script mirrors

Use `references/schema-contract.md` for a quick map and `references/ingest-examples.md` for copy-ready examples.

## Source of truth

- Canonical skill source: `skills/laniameda-gallery-ingest/`
- Installed copies under `~/.openclaw/skills/`, `~/.codex/skills/`, and `~/.agents/skills/` are disposable `bunx skills` installs.
- When ingest contracts change, update this skill in the same commit.

## Runtime env

Local Claude/Codex agents should prefer the gallery MCP server and app API:

- `LANIAMEDA_GALLERY_API_URL` — app host, e.g. `https://gallery.example.com`
- `LANIAMEDA_GALLERY_AGENT_TOKEN` — user-issued token from `/api/agent/tokens`

When MCP tools are available, use them directly:

- Ingest: `save_asset`, `save_prompt`
- Maintain records: `update_gallery_item`, `delete_gallery_item`
- Customize the user's page: `list_tags`, `upsert_tag`, `upsert_tags`, `archive_tag`, `list_collections`, `create_collection`, `update_collection`, `delete_collection`

Never send `ownerUserId` through MCP calls. The user-issued token selects the owner.

### Collections

Collections are owner-scoped groupings stored in `folders`; "collection" is the product-facing term.

- Pass `folderIds` to `save_asset` for one or more collections.
- Pass `folderIds` to `update_gallery_item` with `target: "asset"` to replace an asset's collection memberships. Pass `[]` to clear them.
- Pass `folderId` to `save_prompt`; prompt-only records retain a single primary collection.
- Use raw IDs returned by `list_collections` / `create_collection`, never `folders:<id>` typed tokens.
- Create or reuse collections with `create_collection`, which is idempotent by normalized name.
- Leave assets uncategorized when no collection is requested or confidently resolved.
- Treat `folderId` as the primary/backward-compatible alias. Treat `folderIds` as the current asset collection contract.

The legacy script in this skill still reads `CONVEX_URL`/`KB_OWNER_USER_ID` and calls Convex directly. Treat that path as admin migration only; do not use it for multi-user agents.

## Supported content

- Prompt-only saves with explicit `allowPromptOnly: true`
- File uploads from local disk or inline base64 (images AND videos)
- Remote URL ingestion (images AND videos)
- Media bytes are delivered from R2 for both images and videos. Image thumbnails are also R2-backed; legacy Convex storage rows remain readable as fallbacks.
- Visual references, including UI/design references, are saved as assets. Use tags such as `design`, `ui`, `website`, `component`, or `reference` instead of a separate design-specific MCP path.
- **Video prompts**: prompts for AI video generation tools (e.g. Seedance 2.0) with attached `.mp4` / `.mov` / `.webm` output
- Batched ingestion via JSON array
- Metadata updates for prompts and assets
- Idempotent deletes for prompts and assets
- Automatic pack sync for multi-asset prompt variations that share a prompt record
- **Workflows**: multi-step presets/tutorials that bundle prompt + media steps under one record via `operation: "workflow"`

## Reading ingested content back (for agent handoff)

After you create or update an asset/prompt/pack/design, the user can copy its ID from the gallery UI:

- **Card corner button** (hover on desktop) — copies `asset:<id>` / `pack:<id>`
- **Detail panel metadata strip** — a persistent, clickable `asset:<id>` chip sits next to the model/date badges and copies the same token
- **Detail panel Copy dropdown** — "Copy asset/design ID" and "Copy pack ID" menu items

When the user pastes one of these `kind:<id>` tokens to an agent, do **not** query via ingest. Hand off to the `laniameda-gallery-query` skill:

- `getById` accepts `asset:<id>` and `pack:<id>` and returns the hydrated record (prompt text, tag names, resolved media URL, thumbnail URL, model, pillar, folder, pack membership, etc.).
- Use `get` / `getPack` when the ID type is already known.
- Use `download` to pull raw bytes for local use.

Agents should treat this as the canonical read path after an ingest. The ingest script intentionally exposes only create/update/delete — all reads live in `laniameda-gallery-query`.

## Semantic search

All ingested assets and prompts are automatically indexed for semantic search using Gemini multimodal embeddings (`gemini-embedding-2-preview`).

- **Image assets** are embedded as pure image data (no text metadata). A text query like "car" matches images that visually contain cars via cross-modal matching.
- **Prompts** are embedded as prompt text only (no tags/pillar/model padding).
- **Tags and metadata** are applied as post-filters, not included in embeddings.
- Search via `semanticSearch:searchAssets` (text → assets) or `semanticSearch:findSimilarAssets` (image → similar images).
- Backfill after schema changes: `npx convex run semanticIndex:backfillBatch '{"sourceType": "asset", "batchSize": 25}'` (loop until `done: true`).

## CRITICAL: Screenshots and prompt images

When Michael sends a **screenshot of a prompt** or **image containing text/JSON**:
- **DO NOT** use that image as the `imagePath` or asset
- **DO** read the image, extract the text/prompt from it, and put it in `finalPrompt`
- The image is the delivery mechanism, not the content
- The content is the prompt text inside it

Only use an image as `imagePath`/asset when it is a **generated output** (the result of a prompt), not when it contains text or code to be saved.

## Video prompts

Video generations ingest through the **same script and payload shape** as images. The only differences:

- Use `imagePath` / `filePath` / `url` pointing at a video file (`.mp4`, `.mov`, `.webm`). The server detects `video/*` content-type automatically and stores the asset with `kind: "video"`.
- Set `generationType: "video_gen"` and `promptType: "video_gen"`.
- Preserve the model name only when the user provides it or reliable source metadata identifies it. Do not infer Seedance 2.0 from prompt structure alone.
- The backend generates **no** thumbnail for video. `scripts/ingest.ts` extracts a poster frame for you (see "Video of any size" below) — set `posterAtSeconds` to pick the frame. Through MCP `save_asset`, which has no ffmpeg, you must supply the still yourself.
- The same prompt-only rule applies: **never save a video prompt without the video file unless the user explicitly approves** `allowPromptOnly: true`.

Example:

```json
{
  "promptText": "cinematic dolly-in on a neon-lit alleyway, rain falling, 5 seconds",
  "promptType": "video_gen",
  "generationType": "video_gen",
  "filePath": "/path/to/output.mp4",
  "folderIds": ["<resolved-collection-id>"],
  "ingestKey": "gallery:neon-alley-dolly:v1",
  "tagNames": ["video", "cinematic", "neon"]
}
```

Pass this payload to MCP `save_asset`. Use the legacy direct script only when a single `folderId` is sufficient.

Batched video prompt variations use the same `promptIngestKey` pattern as images — variants auto-group into an `assetPack`.

### Video of any size — the script handles it

Pass `filePath` and nothing else. `scripts/ingest.ts` detects video and runs the
whole pipeline itself, so **do not hand-roll an R2 upload script**:

1. **ffprobe reads the real dimensions** (rotation applied). This matters more
   than it looks: the R2 branch of `ingestFromApi` decodes nothing server-side,
   so the dimensions the script sends are the only ones the asset will ever have.
   Wrong or missing dims mean a 1:1 masonry cell and a cropped card.
2. **Browser-hostile audio is remuxed.** `.mov` exports from DaVinci and
   QuickTime routinely carry `pcm_s24le`, which browsers cannot decode — the
   asset ingests clean, looks right in the grid, and plays **silent**. The video
   stream is copied, so remuxing costs no quality. `.mov`/`.avi`/`.mkv`
   containers are normalised to `.mp4` for the same reason.
3. **A poster frame is extracted** at 15% of duration (clamped to 1–10s).
   Videos get no server-generated thumbnail, so the poster IS the card. Override
   with `posterAtSeconds` when the default lands on a fade or a murky shot.
4. **Bytes go direct to R2**, then the asset is created with `r2Key`. Only the
   poster rides base64. This is unconditional for video, not a size threshold —
   `posterFile` is only honoured on the `r2Key` branch, so a base64 video could
   never get a thumbnail.

```bash
bun run ~/.agents/skills/laniameda-gallery-ingest/scripts/ingest.ts '{
  "filePath": "/path/to/episode1.mov",
  "folderId": "<collection-id>",
  "tagNames": ["cinematic"],
  "ingestKey": "gallery:my-project:episode1:v1"
}'
```

Requires `ffmpeg` and `ffprobe` on PATH (`brew install ffmpeg`); the script fails
with that instruction rather than ingesting a dimensionless, posterless asset.

**Images still ride base64** through the Convex argument, which caps near 10 MB —
the server decodes them and builds the thumbnail. Oversized images fail with a
"compress to JPEG first" error instead of a cryptic argument-size failure.

**No R2 branch on `update` or workflow steps.** `updateFromApi` and
`workflows:ingestWorkflowFromApi` accept base64 only. To attach a large video,
ingest it as its own `create` and link it with `upstreamInputs`.

Verifying an upload by hand: `r2.dev` public URLs reject `HEAD` with 403. That is
not a broken upload — use a range GET:

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" -r 0-1023 "<r2-url>"
```

## Cinema Inspiration pillar (frames, no prompt)

The `cinema-inspiration` pillar is for **cinematic frames, stills, and screenshots** — a reference vault of moments worth recreating. Unlike every other pillar, cinema frames **do not carry a prompt**. The cinematographic context lives in a dedicated `cinemaMetadata` struct on the asset.

**Use a different mutation.** Cinema frames bypass the standard prompt-ingest contract entirely. Call the dedicated `cinemaInspiration:ingestCinemaFrame` Convex action instead of the generic ingest endpoint:

```ts
ctx.runAction(api.cinemaInspiration.ingestCinemaFrame, {
  ownerUserId,
  base64: imageBase64,
  mimeType: "image/png",
  fileName: "blade-runner-2049-001.png",
  ingestSource: "agent",
  cinemaMetadata: {
    movieTitle: "Blade Runner 2049",
    director: "Denis Villeneuve",
    year: 2017,
    scene: "Sea wall confrontation at Wallace HQ",
    cinematographer: "Roger Deakins",
    lens: "Panavision Primo 35mm",
    aperture: "T1.4",
    composition: "Centered vanishing point. Strong horizontal banding from monolithic wall. Subject in lower-third silhouette.",
    lighting: "Single warm amber key from upper-right; deep cool ambient fill in shadows. Practical glow from holographic surfaces.",
    cameraMovement: "Locked-off static shot.",
    colorPalette: "Amber #d97742 against teal #2e4a55. ~92% of pixels in two-tone split.",
    mood: "Apocalyptic stillness. Industrial sublime.",
    agentDescription: "Optional: full cinematographic read used by downstream agents.",
  },
  ingestKey: "cinema:blade-runner-2049:wallace-confrontation:001",  // optional, makes ingest idempotent
});
```

Required fields:
- `ownerUserId`, `base64`, `cinemaMetadata.movieTitle`

Everything else in `cinemaMetadata` is optional. Use `ingestKey` for idempotency when the same source is ingested twice.

**No prompt is created.** No `prompts` row, no `promptType`, no `final_prompt`. The asset is stored with `pillar: "cinema-inspiration"`, `assetRole: "cinema_frame"`, `kind: "image"`, and `cinemaMetadata` populated. The image embedding is still computed automatically via `reindexAsset` — semantic search works the same way.

**Storage:** image bytes go to R2 via the same `storeBlobToR2` path used for agent ingest. A 420px-wide thumbnail is generated and also stored to R2.

**Manual UI ingest:** Michael uses `components/cinema-upload-panel.tsx` (drag-and-drop batch upload) for fast manual ingestion. Same backend contract.

**Codex-driven enrichment:** when the codex agent ingests cinema frames, it should populate `cinemaMetadata.agentDescription` with a full cinematographic read (lens, focal length, composition principle, lighting setup, color theory, implied camera movement). See `agent-docs/features/cinema-inspiration/CODEX_INGEST_PRD.md` for the full contract, including the planned GPT Image 2 annotated-overlay feature.

**Do NOT:**
- ingest cinema frames through `agent_ingest:ingestFromAgentPayload` (will require a prompt, which doesn't make sense)
- attach a prompt to a cinema asset — they are intentionally promptless
- use the cinema-inspiration contract for AI-generated images — save those as ordinary gallery assets and organize them with collections/tags

## Multi-stage workflows (prompt lineage)

When a generation was produced from an earlier prompt or asset — e.g. a Seedance 2 video made from a GPT-Image-2 starting frame — capture the chain with `upstreamInputs`. Without this, the relationship is lost and agents cannot reproduce or remix the workflow.

Pattern:

1. Ingest each upstream step first. Use stable `ingestKey`s so you can reference them.
2. Ingest the final/derivative step with an `upstreamInputs` array linking back to each upstream by `ingestKey` (or `id`).

```bash
# Step 1: save the GPT-Image-2 starting-frame prompt
bun run ~/.agents/skills/laniameda-gallery-ingest/scripts/ingest.ts '{  "promptText": "cinematic neon start frame, rain-slick street, 35mm",
  "promptType": "image_gen",
  "generationType": "image_gen",
  "modelName": "GPT-Image-2",
  "modelProvider": "openai",
  "imagePath": "/path/to/start-frame.png",
  "ingestKey": "creators:neon-alley:startframe:v1"
}'

# Step 2: save the Seedance 2 prompt + video with upstream link
bun run ~/.agents/skills/laniameda-gallery-ingest/scripts/ingest.ts '{  "promptText": "dolly-in 5s, rain intensifies, neon flicker",
  "promptType": "video_gen",
  "generationType": "video_gen",
  "modelName": "Seedance 2.0",
  "modelProvider": "other",
  "imagePath": "/path/to/output.mp4",
  "ingestKey": "creators:neon-alley:seedance:v1",
  "upstreamInputs": [
    {
      "type": "prompt",
      "ingestKey": "creators:neon-alley:startframe:v1",
      "role": "starting_image_prompt",
      "stageOrder": 1
    },
    {
      "type": "asset",
      "ingestKey": "creators:neon-alley:startframe:v1",
      "role": "starting_image_asset",
      "stageOrder": 1
    }
  ]
}'
```

Rules:

- `upstreamInputs[].type` is `"prompt"` or `"asset"`. One of `id` or `ingestKey` is required — prefer `ingestKey` for idempotency.
- `role` uses the `lineageRoleValidator` enum: `starting_image_prompt`, `starting_image_asset`, `style_reference`, `motion_reference`, `upscale_source`, `variation_source`, `edit_source`, `other`.
- Target resolution: when the ingest creates both a prompt and an asset, lineage attaches to the asset (the output). Prompt-only ingests attach lineage to the prompt.
- Lineage rows are idempotent on `(owner, target, source, role)`. Re-ingest with the same keys updates `stageOrder`/`notes` without duplicating rows.
- Unresolvable upstream `id`/`ingestKey` fails the ingest rather than silently dropping the link — ingest the upstream step first.

## Workflows (presets / tutorials)

A **workflow** bundles several prompt + media steps under one organizing record — a reusable preset or tutorial. Use it when the knowledge is multi-step (e.g. an image-gen prompt + result images, then a video-gen prompt + result video) and worth keeping together rather than as scattered one-shot prompts.

Use `operation: "workflow"`. The script calls `workflows:ingestWorkflowFromApi`, which creates the workflow row and ingests each step through the canonical ingest path — so every step's prompt and media also stay normal, independently-searchable gallery entries.

```bash
bun run ~/.agents/skills/laniameda-gallery-ingest/scripts/ingest.ts '{
  "operation": "workflow",
  "title": "Neon alley cinematic loop",
  "description": "Start frame in GPT-Image-2, then animate in Seedance 2.0.",
  "agentInstructions": "Generate the still first, then feed it as the Seedance start frame.",  "tagNames": ["cinematic", "neon"],
  "ingestKey": "creators:neon-alley:workflow:v1",
  "steps": [
    {
      "stepLabel": "Base still",
      "promptText": "cinematic neon start frame, rain-slick street, 35mm",
      "promptType": "image_gen",
      "generationType": "image_gen",
      "modelName": "GPT-Image-2",
      "modelProvider": "openai",
      "media": [{ "filePath": "/path/to/start-frame.png" }]
    },
    {
      "stepLabel": "Animate",
      "promptText": "dolly-in 5s, rain intensifies, neon flicker",
      "promptType": "video_gen",
      "generationType": "video_gen",
      "modelName": "Seedance 2.0",
      "modelProvider": "other",
      "media": [{ "filePath": "/path/to/output.mp4" }]
    }
  ]
}'
```

Rules:

- `title` is required; provide at least one step.
- Each step is one prompt. `media` is an array — multiple images in a step all attach to that step's prompt. A step with several images is `media: [{...}, {...}]`.
- Step media accepts `filePath`/`imagePath` (read to base64) or `url`. Videos work the same way (`.mp4`/`.mov`/`.webm`).
- A prompt-only step needs `allowPromptOnly: true` on that step — same hard rule as elsewhere.
- `ingestKey` makes the whole workflow idempotent; per-step `promptIngestKey` and per-media `ingestKey` are derived from it when omitted, so re-running is safe.
- The workflow's cover thumbnail is auto-pinned from the first step's media.

## CRITICAL: Never save without an image unless user approves

**Do NOT use `allowPromptOnly: true` without explicit user approval.** This is a hard rule — no exceptions, no silent fallbacks.

If you cannot attach an image (no file path, inline-only attachment, broken URL, extraction failure):
1. **Stop.** Do not ingest.
2. **Tell the user** exactly why the image is missing.
3. **Ask:** "Should I save the prompt without the image, or do you have a file path for it?"
4. Only proceed with `allowPromptOnly: true` if the user explicitly says yes.

When ingesting from PDFs, documents, websites, or any source that contains both prompts and images:
1. **Always extract images** alongside prompts — never skip them
2. **Match each prompt to its image** by order/position in the source
3. If images are too large (>5MB), compress to JPEG before uploading; the backend stores the final image and generated thumbnail in R2.
4. **If images cannot be fetched or extracted, stop and ask the user** — never silently drop images

Common trap: user shares an image inline in a chat conversation. You cannot extract inline attachments to a file path. **Ask the user for the local file path before ingesting.** Do not save prompt-only and "attach later" — get the path first.

## Payload rules

- Always provide content: `promptText`, `promptSections.finalPrompt`, `url`, `filePath` / `imagePath`, or `designInspiration`.
- **Default: include `imagePath` or `filePath` with every prompt.** Never set `allowPromptOnly: true` without asking the user first.
- Organize asset saves with `folderIds` and prompt-only saves with `folderId`. **Pillars are retired from the product** — do not set `pillar` on ordinary new saves. The schema column remains for backward compatibility and specialized internal contracts.
- Prefer `typedTags` when category and source are known.
- Use stable `ingestKey` values for retry safety.
- Use `promptIngestKey` when multiple assets should attach to one prompt.
- Reusing one `promptIngestKey` across multiple media ingests now creates or updates an `assetPack` automatically.
- Keep `ownerUserId` env-driven; callers never pass it directly.
- `ingestKey` is only an idempotency key for `create`; it does not patch existing records.
- For `update` and `delete`, pass `target` plus either `id` or `ingestKey`.
- Design inspiration create/update payloads may include `sourceTitle`, `userNote`, `captureKind`, `saveIntent`, `templateKey`, `sourceFingerprint`, and `status` when the source carries that metadata.
- `update` supports media attachment for prompts (`target: "prompt"` + `imagePath`/`filePath`) and media replacement for assets (`target: "asset"` + `imagePath`/`filePath`).
- When attaching media to a prompt, an `assetIngestKey` is derived as `${ingestKey}:img` by default, or can be set explicitly.
- Re-uploading media with the same `assetIngestKey` replaces the existing asset's file rather than creating a duplicate.
- Legacy rows can be backfilled into explicit packs with `assetPacks:consolidateOwnerPromptPacks`.

## Install/update workflow

Repo-local development:

```bash
bun run skills:install:local
```

GitHub-backed install:

```bash
bun run skills:install:github
```

Refresh installed GitHub-backed skills:

```bash
bun run skills:update
```

These repo scripts now install/update both maintained gallery skills:

- `laniameda-gallery-ingest`
- `laniameda-gallery-query`

## Validator quick reference

These are the valid enum values the Convex schema enforces — use these or ingest will fail:

**`modelProvider`:** `openai`, `anthropic`, `google`, `xai`, `meta`, `flux`, `midjourney`, `runway`, `other`
→ Use `other` for Kora Reality / Enhancor and any non-listed providers.

**`workflowType`:** `component_prompt`, `page_prompt`, `system_prompt`, `asset_recipe`, `other`

**`typedTags[].category`:** `model_name`, `style`, `content_type`, `platform`, `color`, `camera_angle`, `lighting`, `composition`, `car_make`, `car_model`, `car_angle`, `environment`, `design_style`, `design_type`, `workflow_type`, `component_type`, `custom`
→ No `subject` — use `content_type` instead.

**`promptSections` fields:** `finalPrompt` (required), `generationNotes` (optional), `negativePrompt` (optional)
→ No other keys — extra fields cause validation errors.

**`folders.kind`:** `storybook`, `project`, `direction`, `episode`
→ Undefined = a plain collection. A beat is a `direction`.

**`projectCollections.section`:** `characters`, `locations`, `stills`, `beats`, `episodes`
→ Undefined = unsorted. `ensureSectionPool` accepts only the first three.

**`parentFolderId` nesting:** only a plain root collection may be a parent, and
only plain collections and projects may be children. One level deep — anything
deeper is expressed through join tables, never by chaining `parentFolderId`.

## Update workflow (important)

**Always edit the canonical source first:**

```
~/work/laniameda/laniameda.gallery/skills/laniameda-gallery-ingest/SKILL.md
```

Then push to GitHub:

```bash
cd ~/work/laniameda/laniameda.gallery
git add skills/laniameda-gallery-ingest/
git commit -m "update laniameda-gallery-ingest skill"
git push
```

Then refresh installed copies across all agents:

```bash
bun run skills:update
# or manually:
bunx skills add https://github.com/laniamedaHQ/laniameda-gallery/tree/main/skills/laniameda-gallery-ingest -g -a openclaw -a codex -a cline -y
bunx skills add https://github.com/laniamedaHQ/laniameda-gallery/tree/main/skills/laniameda-gallery-query -g -a openclaw -a codex -a cline -y
```

**When Michael says he pushed updates to the gallery repo:**
Run this immediately:
```bash
cd ~/work/laniameda/laniameda.gallery && git pull && bun run skills:update
```
No need to ask — just pull and update.

Installed copies at `~/.openclaw/skills/`, `~/.codex/skills/`, `~/.agents/skills/` are **disposable** — source of truth is always the repo.

## Script

Legacy direct-Convex invocation:

```bash
CONVEX_URL=https://<your-laniameda-deployment>.convex.cloud KB_OWNER_USER_ID=<your_telegram_id> \
  bun run ~/.agents/skills/laniameda-gallery-ingest/scripts/ingest.ts '{"promptText":"cinematic portrait","allowPromptOnly":true}'
```

Preferred MCP invocation:

```bash
LANIAMEDA_GALLERY_API_URL=https://<app-host> LANIAMEDA_GALLERY_AGENT_TOKEN=lgat_... \
  bun run mcp:gallery
```

If the installed path is different for your agent runtime, use that runtime's installed `laniameda-gallery-ingest/scripts/ingest.ts` path instead.

### Deployment ground truth (direct-Convex path only)

One Convex deployment serves both local dev and production: `dev:perfect-buffalo-375`
at `https://perfect-buffalo-375.convex.cloud`. There is no separate prod
deployment — never pass `--prod`.

The shell commonly inherits `CONVEX_DEPLOYMENT` pointing at a *different*
project. `bunx convex run …` picks that up silently and resolves IDs against the
wrong tables, returning plausible-looking wrong data. Always prefix CLI calls:

```bash
CONVEX_DEPLOYMENT=dev:perfect-buffalo-375 bunx convex run folders:listFolders '{"ownerUserId":"<id>"}'
```

Scripts that build their own `ConvexHttpClient` should hardcode the cloud URL
rather than read `process.env.CONVEX_URL`, for the same reason. And source
secrets from the repo's `.env.local` explicitly — `export $(grep … .env.local)`
run from a scratch directory silently finds nothing and dumps the whole
environment.
