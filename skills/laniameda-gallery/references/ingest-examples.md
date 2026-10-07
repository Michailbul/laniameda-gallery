# Agent save examples

Discover the live tool schema first. These examples use the authenticated MCP or
scripts/gallery.mjs tool surface; owner comes from the token. Replace placeholders
with IDs returned by list_collections/prepare_uploads. Scripts/files containing
real tokens or signed slots are private and must not enter Git or chat reports.

## Generated media

After uploading the file, call save_asset:

```json
{"uploadId":"<image upload slot>","promptText":"cinematic fashion portrait in Tokyo rain","promptType":"image_gen","generationType":"image_gen","folderIds":["<resolved collection ID>"],"tagNames":["character","portrait","cinematic"],"agentDescription":"A woman in a rainlit Tokyo street, framed as a cinematic portrait; kept as a lighting study.","assetRole":"generated_output","ingestSource":"agent","ingestKey":"gallery:tokyo-rain-portrait:v1"}
```

Read get_gallery_item with the returned asset:<id>; verify prompt, tags and
collection names. Preserve modelName only if the source or user named the model.

## External reference

```json
{"url":"https://example.com/reference.png","sourceUrl":"https://example.com/project","agentDescription":"A restrained pricing layout with readable plan cards; kept for its information hierarchy. By the credited designer.","assetRole":"inspiration_capture","ingestSource":"agent","tagNames":["inspiration","pricing-page","website"],"ingestKey":"web:example.com/project:1"}
```

agentDescription is the agent's retrieval text. description/userNote hold
Michael's own words. A website screenshot can be an external reference; a prompt
screenshot is not the generated result image.

## Video and poster

Prepare/upload the video and still, then call save_asset:

```json
{"uploadId":"<video slot>","posterUploadId":"<poster slot>","promptText":"Slow dolly toward a rainy neon alley","agentDescription":"A slow move into a neon alley in rain; kept as a camera and light study.","assetRole":"generated_output","ingestSource":"agent","tagNames":["scene","cinematic","rain"],"ingestKey":"gallery:neon-alley:v1"}
```

To replace only its poster, upload a new still and call set_video_poster:

```json
{"assetId":"<owned video ID>","posterUploadId":"<new poster slot>"}
```

A normal asset media update with an image replaces the video itself. Inspect
playback/audio if the requested deliverable is a verified video.

## A reusable Skill

```json
{"title":"Neon alley camera study","ingestKey":"skill:neon-alley:v1","description":"Generate a coherent start frame, then animate its light and camera.","body":"# Recipe\nKeep the start-frame composition and preserve the shot's source references.","tagNames":["cinematic","camera-study"],"folderIds":["<resolved collection ID>"],"steps":[{"stepLabel":"Base still","promptText":"Rain-slick neon street, cinematic 35mm framing","media":[{"uploadId":"<still slot>","agentDescription":"Neon alley start frame used to lock composition and lighting.","description":"Start-frame master"}]},{"stepLabel":"Animate","promptText":"Slow five-second dolly; rain and neon reflections move","media":[{"uploadId":"<video slot>","posterUploadId":"<poster slot>","agentDescription":"Camera-study animation derived from the retained start frame.","description":"Animation result"}]}]}
```

Use create_skill, then get_skill with the returned skill:<id>. Text-only Skills
can omit steps/media when body or agentInstructions contains the reusable recipe.
An image group belongs in a collection; a Skill should contain reusable knowledge.

## Native Story and revision

```json
{"ingestKey":"story:short-film:v1","title":"The missed stop","body":"She is already running when the doors close.","kind":"script","status":"draft"}
```

Use save_story. After get_story, update_story must include its positive
expectedRevision. Changed re-saves of an existing ingestKey require that revision
too; an exact retry/new save can omit it. Keep original text in revision history.

## Filing an existing asset

Read current memberships before replacing the full set:

```json
{"target":"asset","id":"<asset ID>","folderIds":["<existing membership>","<new membership>"]}
```

Omitted fields are preserved; [] explicitly clears. Use supported additive
fields for independent filing changes. A partial response carries persisted IDs:
repair those records rather than re-create with a fresh ingest key.

## Local/admin compatibility

Direct ingest.ts/query.ts use signed owner env, not the token client's contract.
They support folderIds as well as a primary folderId. Read authenticated
references/maintenance.md before use. Legacy operation: workflow is the internal
Skill ingest shape and supports R2 video steps; the public create_skill contract
avoids its historical pillar parameter. Do not run legacy pack-to-Skill backfills
just to group ordinary prompt variations.
