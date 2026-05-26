---
name: laniameda-gallery-ingest
description: >-
  Save prompts, images, videos, and design inspiration to a laniameda.gallery
  vault. Use when an agent needs to ingest prompts, files, URLs, or design
  references into the user's gallery via its HTTP ingest API.
---

# laniameda-gallery-ingest

Use this skill to write content into a laniameda.gallery deployment via its HTTP ingest API. The gallery owns prompts, generated images and videos, multi-step workflows, and design inspiration entries — all scoped to the calling user.

> **Skill status:** preview. The gallery exposes `POST /api/ingest` for authenticated browser sessions today. Programmatic API tokens for headless agents are on the roadmap. Until then, ingest from an agent running in a context that already holds the gallery session cookie (e.g. a desktop assistant attached to the same browser profile), or run an MCP/CLI bridge that injects the cookie.

## Runtime env

The skill reads these at runtime:

- `LANIAMEDA_GALLERY_URL` — base URL of the target gallery, e.g. `https://your-gallery.vercel.app`. No trailing slash.
- `LANIAMEDA_AUTH_COOKIE` — value of the gallery session cookie for the calling user. Used as the `Cookie` header on every request.

The vault is the user's gallery. The skill never hardcodes user IDs — ownership is derived from the session cookie on the server.

## Supported content

- Prompt-only saves with explicit `allowPromptOnly: true`
- File uploads from local disk or inline base64 (images and videos)
- Remote URL ingestion (images and videos)
- Design inspiration records for non-prompt design references, with optional `sourceTitle`, `userNote`, `captureKind`, `saveIntent`, `templateKey`, `sourceFingerprint`
- Video prompts for AI video generation tools (e.g. Seedance 2.0) with attached `.mp4` / `.mov` / `.webm`
- Batched ingestion via JSON array
- Metadata updates for prompts, assets, and design inspirations
- Idempotent deletes for prompts, assets, and design inspirations
- Automatic pack sync for multi-asset prompt variations that share a prompt record
- **Workflows**: multi-step presets/tutorials that bundle prompt + media steps under one record via `operation: "workflow"`

## CRITICAL: Screenshots and prompt images

When the user sends a screenshot of a prompt, or an image containing text/JSON:

- **DO NOT** use that image as the asset `imagePath`
- **DO** read the image, extract the prompt text, and put it in `promptText`
- The image is delivery, not content

Only use an image as `imagePath` when it is a **generated output** — the result of a prompt.

## CRITICAL: Never save without an image unless the user approves

`allowPromptOnly: true` requires explicit user approval. If you cannot attach an image:

1. **Stop.** Do not ingest.
2. Tell the user why the image is missing.
3. Ask: "Save the prompt without the image, or do you have a file path?"
4. Proceed with `allowPromptOnly: true` only if the user says yes.

When ingesting from PDFs, documents, or websites that contain both prompts and images, always extract images alongside prompts and match each prompt to its image by position. Compress images above ~5MB to JPEG before sending. If images cannot be fetched, stop and ask.

Common trap: the user shares an image inline in chat. You usually cannot extract inline attachments to a file path. **Ask for the local file path before ingesting** — don't save prompt-only with a promise to attach later.

## Endpoint

```
POST {LANIAMEDA_GALLERY_URL}/api/ingest
Content-Type: application/json
Cookie: {LANIAMEDA_AUTH_COOKIE}
```

Body is a single ingest payload object, an array of payloads, or a workflow payload (see below).

## Payload rules

- Always provide content: `promptText`, `promptSections.finalPrompt`, `url`, `filePath` / `imagePath`, or `designInspiration`.
- **Default: include `imagePath` or `filePath` with every prompt.** Never set `allowPromptOnly: true` without asking.
- Always set `pillar` when possible. Default keys: `creators`, `cars`, `designs`, `dump`. Custom user pillar keys (e.g. `inspirations`) are also valid if the user has defined them.
- Prefer `typedTags` when category and source are known.
- Use stable `ingestKey` values for retry safety. `ingestKey` is an idempotency key for `create`; it does not patch existing records.
- Use `promptIngestKey` when multiple assets should attach to one prompt. Reusing one `promptIngestKey` across multiple media ingests creates or updates an `assetPack` automatically.
- Never pass `ownerUserId` from the client — the server derives it from the session.
- For `update` and `delete`, pass `target` plus either `id` or `ingestKey`.
- Design inspiration create/update payloads may include `sourceTitle`, `userNote`, `captureKind`, `saveIntent`, `templateKey`, `sourceFingerprint`, and `status`.
- `update` supports media attachment for prompts (`target: "prompt"` + `imagePath`/`filePath`) and media replacement for assets (`target: "asset"` + `imagePath`/`filePath`).
- When attaching media to a prompt, an `assetIngestKey` is derived as `${ingestKey}:img` by default, or can be set explicitly.
- Re-uploading media with the same `assetIngestKey` replaces the existing asset's file rather than creating a duplicate.

## Reading ingested content back

After you create or update an asset/prompt/pack/design, the user can copy its ID from the gallery UI as `asset:<id>`, `pack:<id>`, or `design:<id>`. When the user pastes one of those tokens, do **not** query via ingest — hand off to the `laniameda-gallery-query` skill. Ingest exposes only create/update/delete; reads live in the query skill.

## Video prompts (Seedance 2.0 and other AI video models)

Video generations ingest through the same payload shape as images. Differences:

- Use `imagePath` / `filePath` / `url` pointing at a video file (`.mp4`, `.mov`, `.webm`). The server detects `video/*` and stores the asset with `kind: "video"`.
- Set `generationType: "video_gen"` and `promptType: "video_gen"`.
- Default `modelName` to `"Seedance 2.0"` when not specified. Pair with `modelProvider: "other"` unless a listed provider applies.
- No poster is auto-generated for videos. To set a custom still, ingest the video first, then run `update` on the asset with an `imagePath` pointing at a still frame.
- The prompt-only rule applies: never save a video prompt without the video file unless the user approves `allowPromptOnly: true`.

Example body:

```json
{
  "pillar": "creators",
  "promptText": "cinematic dolly-in on a neon-lit alleyway, rain falling, 5 seconds",
  "promptType": "video_gen",
  "generationType": "video_gen",
  "modelName": "Seedance 2.0",
  "modelProvider": "other",
  "imagePath": "/path/to/output.mp4",
  "ingestKey": "creators:neon-alley-dolly:v1",
  "tagNames": ["video", "cinematic", "neon"]
}
```

## Multi-stage workflows (prompt lineage)

When a generation was produced from an earlier prompt or asset — e.g. a Seedance 2 video made from a GPT-Image-2 starting frame — capture the chain with `upstreamInputs`. Without this, the relationship is lost and the user cannot reproduce or remix the chain.

1. Ingest each upstream step first with stable `ingestKey`s.
2. Ingest the final/derivative step with an `upstreamInputs` array linking back to each upstream by `ingestKey` (or `id`).

```json
{
  "pillar": "creators",
  "promptText": "dolly-in 5s, rain intensifies, neon flicker",
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
}
```

Rules:

- `upstreamInputs[].type` is `"prompt"` or `"asset"`. One of `id` or `ingestKey` is required — prefer `ingestKey` for idempotency.
- `role` uses the lineage enum: `starting_image_prompt`, `starting_image_asset`, `style_reference`, `motion_reference`, `upscale_source`, `variation_source`, `edit_source`, `other`.
- Lineage attaches to the asset (the output) when ingest creates both a prompt and asset; prompt-only ingests attach to the prompt.
- Lineage rows are idempotent on `(owner, target, source, role)`.
- An unresolvable upstream fails the ingest rather than silently dropping — ingest upstream steps first.

## Workflows (presets / tutorials)

A **workflow** bundles several prompt + media steps under one organizing record — a reusable preset or tutorial. Use it when the knowledge is multi-step (e.g. image-gen prompt + result image, then video-gen prompt + result video) and worth keeping together.

Use `operation: "workflow"`. Each step's prompt and media also stay normal, independently-searchable gallery entries.

```json
{
  "operation": "workflow",
  "title": "Neon alley cinematic loop",
  "description": "Start frame in GPT-Image-2, then animate in Seedance 2.0.",
  "agentInstructions": "Generate the still first, then feed it as the Seedance start frame.",
  "pillar": "creators",
  "tagNames": ["cinematic", "neon"],
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
}
```

Rules:

- `title` and `pillar` are required; provide at least one step.
- Each step is one prompt. `media` is an array — multiple images in a step all attach to that step's prompt. Videos work the same way.
- A prompt-only step needs `allowPromptOnly: true` on that step.
- `ingestKey` makes the whole workflow idempotent; per-step `promptIngestKey` and per-media `ingestKey` are derived from it when omitted.
- The workflow's cover thumbnail is auto-pinned from the first step's media.

## Semantic search

All ingested assets and prompts are automatically indexed for semantic search using a multimodal embedding model.

- Image assets are embedded as pure image data — a text query like `"car"` matches images that visually contain cars via cross-modal matching.
- Prompts are embedded as prompt text only.
- Tags and metadata are post-filters, not part of the embedding.
- Search runs server-side via the query skill (`laniameda-gallery-query`), not through ingest.

## Validator quick reference

Enum values enforced by the schema — use these or ingest fails:

**`modelProvider`:** `openai`, `anthropic`, `google`, `xai`, `meta`, `flux`, `midjourney`, `runway`, `other`

**`workflowType`:** `component_prompt`, `page_prompt`, `system_prompt`, `asset_recipe`, `other`

**`typedTags[].category`:** `model_name`, `style`, `content_type`, `platform`, `color`, `camera_angle`, `lighting`, `composition`, `car_make`, `car_model`, `car_angle`, `environment`, `design_style`, `design_type`, `workflow_type`, `component_type`, `custom`

**`promptSections` fields:** `finalPrompt` (required), `generationNotes` (optional), `negativePrompt` (optional). No other keys — extras cause validation errors.

## Minimal request example

```bash
curl -X POST "$LANIAMEDA_GALLERY_URL/api/ingest" \
  -H "Content-Type: application/json" \
  -H "Cookie: $LANIAMEDA_AUTH_COOKIE" \
  -d '{
    "pillar": "creators",
    "promptText": "cinematic portrait, 35mm, soft window light",
    "promptType": "image_gen",
    "generationType": "image_gen",
    "modelName": "Nano Banana Pro",
    "modelProvider": "google",
    "imagePath": "/Users/you/Pictures/portrait.png",
    "ingestKey": "creators:cinematic-portrait:v1",
    "tagNames": ["portrait", "cinematic"]
  }'
```

For inline media without a local file, use `imageBase64` instead of `imagePath`. For remote-hosted media, use `url`.

## Counterpart

Reads live in `laniameda-gallery-query`. Always pair the two skills — ingest writes, query reads, and the gallery UI is the canonical source of truth for what was saved.
