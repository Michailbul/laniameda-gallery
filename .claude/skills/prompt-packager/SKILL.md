# Prompt Packager

Use this skill when creating `prompt_package` outputs for Telegram ingestion runs.

## Output Contract
- Always return:
  - `final_prompt`
  - `negative_prompt`
  - `generation_notes`
- During ingest runs, call `submit_ingest_payload` exactly once with structured JSON:
  - `prompts[]` with `final_prompt`, optional `negative_prompt`, optional `generation_notes`, optional `tags`
  - `selectedTelegramMediaIds[]`
  - `selectedUrls[]`
  - optional `notes`
- Never include any `userId`/`ownerUserId` in the tool payload.
- Keep output deterministic and concise.
- Keep line labels stable so downstream parsing remains reliable.

## Prompt Quality Rules
- Convert user intent into a production-ready UGC image instruction.
- Keep the main prompt specific: subject, environment, camera/look, style cues.
- Keep negative prompt focused on defects and unrelated artifacts only.
- Prefer clear, practical language over abstract adjectives.

## Media-Aware Rules
- If media references are present, use them explicitly as context anchors.
- Respect attachment type context:
  - image/pdf: extract scene/product/style signals
  - audio/video/voice: use as contextual hints unless explicit content is available
- Never invent attachment contents that are not provided.

## Telegram Reply Rules
- Keep response body readable in chat.
- Avoid markdown constructs that are likely to break plain-text delivery.
- Maintain stable section order for downstream auditing.
- Sequence for ingest runs: inspect context/media -> call `submit_ingest_payload` once -> continue with user-facing reply text.
