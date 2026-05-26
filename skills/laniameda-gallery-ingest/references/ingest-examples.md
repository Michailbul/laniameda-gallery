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

## 1d) Cinema Inspiration frame (no prompt — different mutation)

Cinema frames bypass the standard ingest script. They call the dedicated `cinemaInspiration:ingestCinemaFrame` Convex action instead — no prompt is created.

```ts
// From an agent, action, or codex script:
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { readFileSync } from "node:fs";

const client = new ConvexHttpClient(process.env.CONVEX_URL!);
const bytes = readFileSync("/path/to/frame.png");

await client.action(api.cinemaInspiration.ingestCinemaFrame, {
  ownerUserId: process.env.KB_OWNER_USER_ID!,
  base64: bytes.toString("base64"),
  mimeType: "image/png",
  fileName: "blade-runner-2049-sea-wall.png",
  ingestSource: "agent",
  ingestKey: "cinema:blade-runner-2049:sea-wall:001",
  cinemaMetadata: {
    movieTitle: "Blade Runner 2049",
    director: "Denis Villeneuve",
    year: 2017,
    scene: "Sea wall confrontation",
    cinematographer: "Roger Deakins",
    lens: "Panavision Primo 35mm",
    composition: "Centered vanishing point with a horizontal monolith band; subject in lower-third silhouette.",
    lighting: "Amber key from upper-right; cool ambient fill; practical hologram glow.",
    cameraMovement: "Locked-off static.",
    colorPalette: "Amber #d97742 vs teal #2e4a55 — two-tone split.",
    mood: "Apocalyptic stillness, industrial sublime.",
    agentDescription: "Full cinematographic read used by downstream agents.",
  },
});
```

Rules:
- `movieTitle` is the only required metadata field; everything else is optional.
- No prompt is created. The asset is stored with `pillar: "cinema-inspiration"`, `assetRole: "cinema_frame"`.
- Image embedding still runs automatically — semantic search picks up the frame after ingest.
- Codex agents must populate `agentDescription` with a full cinematographic read (lens, composition principle, lighting setup, color theory, implied movement) so the frame can be recreated. See `agent-docs/features/cinema-inspiration/CODEX_INGEST_PRD.md`.

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
    "pillar": "creators",
    "promptText": "editorial portrait at golden hour, 35mm",
    "promptIngestKey": "creators:editorial-portrait:v1",
    "ingestKey": "creators:editorial-portrait:v1:a",
    "imagePath": "/path/shot-a.jpg",
    "tagNames": ["prompts", "portrait", "editorial"]
  },
  {
    "pillar": "creators",
    "promptText": "editorial portrait at golden hour, 35mm",
    "promptIngestKey": "creators:editorial-portrait:v1",
    "ingestKey": "creators:editorial-portrait:v1:b",
    "imagePath": "/path/shot-b.jpg",
    "tagNames": ["prompts", "portrait", "editorial"]
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
  "ingestKey": "creators:editorial-portrait:v1",
  "promptText": "editorial portrait at blue hour, 35mm",
  "tagNames": ["prompts", "portrait", "editorial", "blue-hour"],
  "modelName": "gpt-image-1"
}'
```

## 7) Update an asset's metadata and clear its folder

```bash
bun run ~/.agents/skills/laniameda-gallery-ingest/scripts/ingest.ts '{
  "operation": "update",
  "target": "asset",
  "ingestKey": "creators:editorial-portrait:v1:a",
  "folderId": null,
  "description": "Hero portrait reference with blue-hour editorial styling.",
  "tagNames": ["portrait", "editorial", "hero-shot"],
  "modelName": "GPT-Image-2",
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
  "ingestKey": "creators:macro-lens-test:v1",
  "imagePath": "/path/to/tachometer.png"
}'
```

Creates an asset linked to the prompt. The asset's `ingestKey` defaults to `creators:macro-lens-test:v1:img`. Re-running with a different image replaces the asset's file.

## 11) Replace media on an existing asset

```bash
bun run ~/.agents/skills/laniameda-gallery-ingest/scripts/ingest.ts '{
  "operation": "update",
  "target": "asset",
  "ingestKey": "creators:macro-lens-test:v1:img",
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

## 14) Workflow (multi-step preset / tutorial)

```bash
bun run ~/.agents/skills/laniameda-gallery-ingest/scripts/ingest.ts '{
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
}'
```

- Routes to `workflows:ingestWorkflowFromApi`. Creates the workflow record, then ingests each step through `ingestFromApi` — step prompts/assets remain normal gallery entries.
- `title` and `pillar` are required; at least one step.
- A step's `media` is an array — multiple images attach to that step's single prompt.
- Idempotent on the workflow `ingestKey`; per-step and per-media keys are derived from it.
