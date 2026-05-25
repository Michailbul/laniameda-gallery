# Ingest examples

## 1) Direct script call with prompt + local image

```bash
bun run ~/.agents/skills/laniameda-gallery-ingest/scripts/ingest.ts '{
  "pillar": "creators",
  "promptText": "cinematic fashion portrait in tokyo rain",
  "promptType": "image_gen",
  "generationType": "image_gen",
  "modelName": "gpt-image-1",
  "modelProvider": "openai",
  "imagePath": "/path/to/image.jpg",
  "typedTags": [
    { "name": "fashion", "category": "style", "pillar": "creators", "source": "agent" },
    { "name": "cinematic", "category": "style", "pillar": "creators", "source": "agent" }
  ]
}'
```

## 1b) Explicit prompt-only save

```bash
bun run ~/.agents/skills/laniameda-gallery-ingest/scripts/ingest.ts '{
  "pillar": "creators",
  "promptText": "cinematic fashion portrait in tokyo rain",
  "allowPromptOnly": true,
  "promptType": "image_gen"
}'
```

## 1c) Video prompt save (Seedance 2.0)

```bash
bun run ~/.agents/skills/laniameda-gallery-ingest/scripts/ingest.ts '{
  "pillar": "creators",
  "promptText": "cinematic dolly-in on a neon-lit alleyway, rain falling, 5 seconds",
  "promptType": "video_gen",
  "generationType": "video_gen",
  "modelName": "Seedance 2.0",
  "modelProvider": "other",
  "imagePath": "/path/to/output.mp4",
  "ingestKey": "creators:neon-alley-dolly:v1",
  "tagNames": ["video", "cinematic", "neon"]
}'
```

Supported video formats: `.mp4`, `.mov`, `.webm`. The asset is stored with `kind: "video"` and renders inline in the gallery with a video player. To attach a custom thumbnail still, follow up with an `update` op on the asset pointing at an image frame.

## 2) Design inspiration only

```bash
bun run ~/.agents/skills/laniameda-gallery-ingest/scripts/ingest.ts '{
  "pillar": "designs",
  "typedTags": [
    { "name": "saas", "category": "design_type", "pillar": "designs", "source": "agent" },
    { "name": "editorial", "category": "design_style", "pillar": "designs", "source": "agent" }
  ],
  "designInspiration": {
    "title": "Stripe pricing layout reference",
    "summary": "Strong hierarchy with simple plan cards",
    "sourceUrl": "https://example.com/pricing-reference",
    "sourceTitle": "Stripe Pricing",
    "userNote": "Strong spacing and restrained plan-card density",
    "inspirationType": "website",
    "platform": "web",
    "workflowType": "page_prompt",
    "captureKind": "website",
    "saveIntent": "inspiration",
    "templateKey": "design-default",
    "sourceFingerprint": "website:https://example.com/pricing-reference",
    "ingestKey": "design:stripe:pricing:v1"
  }
}'
```

## 3) Prompt variations sharing one prompt record

```bash
bun run ~/.agents/skills/laniameda-gallery-ingest/scripts/ingest.ts '[
  {
    "pillar": "cars",
    "promptText": "low-angle porsche rolling shot at sunset",
    "promptIngestKey": "cars:porsche:rolling:v1",
    "ingestKey": "cars:porsche:rolling:v1:a",
    "imagePath": "/path/shot-a.jpg",
    "tagNames": ["prompts", "cars", "porsche"]
  },
  {
    "pillar": "cars",
    "promptText": "low-angle porsche rolling shot at sunset",
    "promptIngestKey": "cars:porsche:rolling:v1",
    "ingestKey": "cars:porsche:rolling:v1:b",
    "imagePath": "/path/shot-b.jpg",
    "tagNames": ["prompts", "cars", "porsche"]
  }
]'
```

These variations now auto-sync into an `assetPack` because they share the same `promptIngestKey` / prompt record.

## 4) Remote URL ingest with structured prompt sections

```bash
bun run ~/.agents/skills/laniameda-gallery-ingest/scripts/ingest.ts '{
  "pillar": "designs",
  "url": "https://example.com/reference.png",
  "promptSections": {
    "finalPrompt": "Warm editorial SaaS landing page with asymmetrical cards",
    "negativePrompt": "generic, bland, low contrast"
  },
  "workflowType": "page_prompt",
  "assetRole": "reference",
  "ingestSource": "agent"
}'
```

## 5) Direct Convex action contract summary

The underlying `ingest:ingestFromApi` action accepts:

- `ownerUserId`
- `promptText`
- `allowPromptOnly` (required when saving prompt text without media or design inspiration)
- `url`
- `file`
- `tagNames`
- `typedTags`
- `folderId`
- `ingestKey`
- `promptIngestKey`
- `modelName`
- `modelProvider`
- `pillar`
- `generationType`
- `promptType`
- `workflowType`
- `promptSections`
- `promptProfile`
- `assetRole`
- `ingestSource`
- `designInspiration`
- `domain`

It returns:

```json
{
  "assetId": "optional",
  "promptId": "optional",
  "designInspirationId": "optional"
}
```

## 6) Update a prompt by ingestKey

```bash
bun run ~/.agents/skills/laniameda-gallery-ingest/scripts/ingest.ts '{
  "operation": "update",
  "target": "prompt",
  "ingestKey": "cars:porsche:rolling:v1",
  "promptText": "low-angle porsche rolling shot at blue hour",
  "tagNames": ["prompts", "cars", "porsche", "blue-hour"],
  "modelName": "gpt-image-1"
}'
```

## 7) Update an asset's metadata and clear its folder

```bash
bun run ~/.agents/skills/laniameda-gallery-ingest/scripts/ingest.ts '{
  "operation": "update",
  "target": "asset",
  "ingestKey": "cars:porsche:rolling:v1:a",
  "folderId": null,
  "tagNames": ["cars", "porsche", "hero-shot"],
  "assetRole": "reference"
}'
```

## 8) Delete a design inspiration by ingestKey

```bash
bun run ~/.agents/skills/laniameda-gallery-ingest/scripts/ingest.ts '{
  "operation": "delete",
  "target": "designInspiration",
  "ingestKey": "design:stripe:pricing:v1"
}'
```

## 9) Update a design inspiration with extension metadata

```bash
bun run ~/.agents/skills/laniameda-gallery-ingest/scripts/ingest.ts '{
  "operation": "update",
  "target": "designInspiration",
  "ingestKey": "design:stripe:pricing:v1",
  "sourceTitle": "Stripe Pricing 2026",
  "userNote": "Worth borrowing for plan density and CTA ordering",
  "captureKind": "website",
  "saveIntent": "inspiration",
  "templateKey": "design-default",
  "sourceFingerprint": "website:https://example.com/pricing-reference",
  "status": "active"
}'
```

## 10) Attach image to an existing prompt-only record

```bash
bun run ~/.agents/skills/laniameda-gallery-ingest/scripts/ingest.ts '{
  "operation": "update",
  "target": "prompt",
  "ingestKey": "cars:tachometer-macro:v1",
  "imagePath": "/path/to/tachometer.png"
}'
```

Creates an asset linked to the prompt. The asset's `ingestKey` defaults to `cars:tachometer-macro:v1:img`. Re-running with a different image replaces the asset's file.

## 11) Replace media on an existing asset

```bash
bun run ~/.agents/skills/laniameda-gallery-ingest/scripts/ingest.ts '{
  "operation": "update",
  "target": "asset",
  "ingestKey": "cars:tachometer-macro:v1:img",
  "imagePath": "/path/to/better-version.png"
}'
```

Replaces the stored file and thumbnail. Old storage blobs are cleaned up. Metadata (tags, pillar, etc.) is preserved.

## 12) Attach image via URL to a prompt

```bash
bun run ~/.agents/skills/laniameda-gallery-ingest/scripts/ingest.ts '{
  "operation": "update",
  "target": "prompt",
  "ingestKey": "creators:portrait:v1",
  "imageUrl": "https://example.com/portrait-output.jpg",
  "assetIngestKey": "creators:portrait:v1:hero"
}'
```

## 13) Update/delete contract summary

- `updateFromApi`
  - Requires `target`
  - Requires either `id` or `ingestKey`
  - Supports `prompt`, `asset`, and `designInspiration`
  - **Prompt + media:** attaches an image to a prompt-only record (creates asset) or replaces media on the derived asset
  - **Asset + media:** replaces the stored file, thumbnail, and file metadata (kind, dimensions, contentType)
  - Media can be provided via `file` (base64), `filePath`/`imagePath` (script reads from disk), or `url`/`imageUrl` (server fetches)
  - `assetIngestKey` overrides the default `${ingestKey}:img` derivation for prompt media attachment
  - Design inspiration updates support `sourceTitle`, `userNote`, `captureKind`, `saveIntent`, `templateKey`, `sourceFingerprint`, and `status`

- `deleteFromApi`
  - Requires `target`
  - Requires either `id` or `ingestKey`
  - Returns `deleted: false` when the target is already absent

## 11) Backfill legacy prompt groups into packs

```bash
bunx convex run assetPacks:consolidateOwnerPromptPacks '{"ownerUserId":"<your_telegram_id>","limit":200}'
```
