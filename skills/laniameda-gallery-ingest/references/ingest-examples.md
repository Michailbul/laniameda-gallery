# Ingest examples

## 1) Direct script call with prompt + local image

```bash
bun run ~/.agents/skills/laniameda-kb/scripts/ingest.ts '{
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
bun run ~/.agents/skills/laniameda-kb/scripts/ingest.ts '{
  "pillar": "creators",
  "promptText": "cinematic fashion portrait in tokyo rain",
  "allowPromptOnly": true,
  "promptType": "image_gen"
}'
```

## 2) Design inspiration only

```bash
bun run ~/.agents/skills/laniameda-kb/scripts/ingest.ts '{
  "pillar": "designs",
  "typedTags": [
    { "name": "saas", "category": "design_type", "pillar": "designs", "source": "agent" },
    { "name": "editorial", "category": "design_style", "pillar": "designs", "source": "agent" }
  ],
  "designInspiration": {
    "title": "Stripe pricing layout reference",
    "summary": "Strong hierarchy with simple plan cards",
    "sourceUrl": "https://example.com/pricing-reference",
    "inspirationType": "website",
    "platform": "web",
    "workflowType": "page_prompt",
    "ingestKey": "design:stripe:pricing:v1"
  }
}'
```

## 3) Prompt variations sharing one prompt record

```bash
bun run ~/.agents/skills/laniameda-kb/scripts/ingest.ts '[
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

## 4) Remote URL ingest with structured prompt sections

```bash
bun run ~/.agents/skills/laniameda-kb/scripts/ingest.ts '{
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
bun run ~/.agents/skills/laniameda-kb/scripts/ingest.ts '{
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
bun run ~/.agents/skills/laniameda-kb/scripts/ingest.ts '{
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
bun run ~/.agents/skills/laniameda-kb/scripts/ingest.ts '{
  "operation": "delete",
  "target": "designInspiration",
  "ingestKey": "design:stripe:pricing:v1"
}'
```

## 9) Update/delete contract summary

- `updateFromApi`
  - Requires `target`
  - Requires either `id` or `ingestKey`
  - Supports `prompt`, `asset`, and `designInspiration`
  - Asset updates are metadata-only; media replacement is not supported

- `deleteFromApi`
  - Requires `target`
  - Requires either `id` or `ingestKey`
  - Returns `deleted: false` when the target is already absent
