# Ingest V0 Feature Spec

## Background and Motivation
- Aligns with the Agent Prompter PRD (desktop-first gallery, prompt/media tagging, `/api/ingest` ingest conduit) and the TODO list items that call out manual ingest UI + tag/folder metadata.
- Serves as the first user-facing surface for capturing prompts + images so we can iteratively tune UX before agent automation arrives.

## Core Objectives
1. Build a modern, desktop-first upload panel that accepts prompt text, drag-and-drop/multi-file uploads, URL pasting, tag entry, and optional folder selection.
2. Persist prompt+media data through `POST /api/ingest`, reusing Convex ingestion helpers, metadata extraction, and thumbnail generation documented in the backend.
3. Surface newly ingested records in the existing gallery grid so manual uploads mirror agent-generated items (with tag filtering and prompt copy affordances).
4. Keep the UI auth-agnostic for now (every visitor sees the panel) while making it easy to augment later with “save to my folders/likes” once authentication is enforced.

## UX Flow
- **Entry point:** floating card above gallery grid with subtle frosted-glass panel and headline like “Capture a new prompt”.
- **Drag-and-drop zone:** central pane that highlights on hover/drag, shows instructions, supports clicking to open file dialog, and renders thumbnails/carousel for selected files (auto-advance effect).
- **Prompt composer & URL input:** text area with placeholder (“Describe the scene or instructions”), limited to 2000 chars; below it a dedicated URL field with inline “Fetch media” hint and error toast when the backend rejects the link.
- **Tag entry:** pill-based input with inline suggestions (reuse Convex `tags` query later). Users add by typing + pressing Enter/Comma; chips display below with removal icons.
- **Folder selector:** optional dropdown (searchable if many folders) labeled “Optional folder”. Default is blank to keep the prompt standalone.
- **Submit controls:** primary button “Save to gallery” disabled until prompt or file/URL exists; secondary “Clear form” resets state; show inline validation errors (e.g., unsupported file type, fetch failure).
- **Feedback:** after submission show toast/smoothed status (“Ingest queued”) and highlight the new gallery card once Convex syncs (Reactive query ensures near-real-time update). Provide skeleton state for the dropzone when uploading.

## Data & Payload
- POST body mirrors existing `/api/ingest` expectations: `promptText`, `url`, `folderId`, `tagNames`, `ingestKey`, `promptIngestKey`, optionally `file` (base64 + name + contentType).
- Build ingestKey client-side as `buildIngestKey({ promptText, url, fileName })` to reuse dedup logic and align with manual ingestion needs.
- Multi-image uploads must queue each file in the same request; when sending to the backend, include all files in multipart/form-data (loop `fileArray.forEach((file) => formData.append('file', file))`). The knee: The API currently accepts a single file, so we need to ensure we only send the most relevant file or batch sequential uploads. If multi-file sync isn't feasible now, upload the first file and keep placeholders for future multi-asset support (explain in future adaptation section).
- The manual UI currently highlights all selected files, but only the first file is posted due to the API limitation. Note this constraint in the docs so future iterations can revisit batch uploads once the endpoint accepts multiple assets.
- Tag parsing reuses `parseTagNames`. Provide type-safe front-end utilities (zod schema or TypeScript interface) to validate before submission.

## Integration with Gallery & Tags
- Once ingestion completes, the main gallery query should automatically include the new prompt record thanks to Convex reactivity (ensure there’s a unique `promptId` or `assetId` to persist). Display tags on cards as chips (existing `GalleryCard` component should already handle this; ensure new records include tags in the response shape).
- Provide link from dropzone to “Filter by these tags” (future) and allow tag chips to act as filters; not yet required but highlight in doc for future iterations.
- Keep the tag system simple now (text input); later extend with auto-suggestions, tag reuse counts, and ability to create new tags.

## API & Backend Expectations
- Continue using `POST /api/ingest` to call Convex action `ingest:ingestFromApi`. Document the required payload fields and mention the `fileToBase64`/`buildIngestKey` helpers currently used in `app/api/ingest/route.ts`.
- Explain that the endpoint returns the Convex action result, which triggers the gallery to show the new entry once the query refreshes.
- Mention we should reuse existing error handling / validation from the endpoint (bad JSON, invalid file, missing prompt) and display errors in the UI (toast or inline message). Provide a plan for unit tests verifying prompt-only, file-only, and URL inputs (see TODO). Client-side validation should align with backend checks (max file size, supported MIME types) to avoid double work.

## States & Testing
- **States:** idle, files selected (carousel + metadata), uploading (spinner + disable submit), success (toast + auto-clear), error (error cards + ability to retry). Document expected accessibility (ARIA live for status messages, focus loops for error states).
- **Testing:** plan React unit tests for the upload panel (simulate file drop, URL paste, tag entry) and integration tests hitting `/api/ingest` (mocked) to assert success/error flows. Future: add Convex ingest action tests covering prompt/file/URL combos (TODO already indicates this).

## Future-proofing for Agent Integration
- Keep the UI decoupled from manual enablement: backend expects the same ingest payload whether a user uses the UI or an autonomous agent does, so avoid injecting agent-specific logic (like hidden fields or heuristics).
- Document how this manual panel can be a fallback (or calibration tool) for agents to verify ingestion before fully automated ingestion is live.
- Reserve space in the doc for later features: e.g., “catalog of prompts” within gallery, agent-curated tags, saved folders per user (once auth adds likes/folders to account). Mention how existing tag/folder schema supports these future hooks.

## Next Steps
1. Wire a new `UploadPanel` component (likely inside `app/(dashboard)/page.tsx` or similar) that renders the UI described above and posts to `/api/ingest` via fetch/form-data.
2. Create Convex-safe hooks (e.g., `useTags`, `useFolders`) to populate tag suggestions/folder dropdown, even if stubbed for now.
3. Build out multi-state Dropzone + Carousel component (maybe reuse `react-dropzone`, `keen-slider`, or custom minimal logic) following design guidelines.
4. Add Storybook/style guide variants and unit/integration tests as noted in TODO.
5. Later: connect to auth state so signed-in users can save to personal folders/likes while others see a call-to-login hint (per AGENT instructions referencing not auth-specific now).

By documenting these points, the team can move forward with a high-fidelity feature while staying aligned with the Convex ingestion backbone and the roadmap toward autonomous agents.
