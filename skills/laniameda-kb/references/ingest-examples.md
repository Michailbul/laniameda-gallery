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

The underlying `ingest:ingestFromApi` action currently accepts:

- `ownerUserId`
- `promptText`
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
