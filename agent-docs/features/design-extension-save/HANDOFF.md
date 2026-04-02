# Design Extension Save — Backend Done / Frontend Handoff

Last updated: 2026-03-31

## Status

Backend for the design-pillar browser extension save flow is implemented and verified.

Done:
- dedicated extension save route for design references
- page save with required screenshot preview
- image save with browser-captured bytes preferred over backend refetch
- owner-scoped design save templates in Convex
- app-facing template CRUD route for authenticated users
- design gallery backend filtering for explicit metadata
- source fingerprint dedupe with image+source-page support

Still open:
- finish the extension frontend flow so templates feel one-click and editable without friction
- manually install the unpacked extension and validate the live workflow end-to-end
- keep auth hardening as a later pass unless scope changes

## Source Of Truth

Core backend files:
- `convex/designExtensionSaves.ts`
- `convex/designSaveTemplates.ts`
- `convex/designSaveHelpers.ts`
- `convex/designInspirations.ts`
- `convex/schema.ts`
- `app/api/extension/design/save/route.ts`
- `app/api/gallery/designs/route.ts`
- `app/api/gallery/designs/templates/route.ts`

Extension files:
- `extension/content.js`
- `extension/background.js`
- `extension/popup.html`
- `extension/popup.js`

Tests:
- `tests/design-extension-save.test.ts`

## Backend Contract

### Save route

`POST /api/extension/design/save`

Payload:
- `capture`
- `captureKind`
- `saveIntent`
- `inspirationType`
- `platform`
- `workflowType`
- `tagNames`
- `userNote`
- `templateKey`

`capture.mode = "page"`:
- `sourceUrl`
- `sourceTitle`
- `title`
- `screenshotBase64`
- `screenshotContentType`

`capture.mode = "image"`:
- `imageUrl`
- `sourceUrl`
- `sourceTitle`
- `title`
- optional `imageBase64`
- optional `imageContentType`

Behavior:
- if `imageBase64` is present, backend stores that exact image
- if not, backend falls back to `fetch(imageUrl)`
- if `templateKey` is present, it must resolve to a real template
- template defaults fill missing save metadata and tags

### Template route

`GET /api/gallery/designs/templates`
- returns owner-scoped templates

`POST /api/gallery/designs/templates`
- upserts a template

`DELETE /api/gallery/designs/templates`
- deletes a template by id

Template defaults currently support:
- `captureKind`
- `saveIntent`
- `inspirationType`
- `platform`
- `workflowType`
- `tagNames`

## Intended Frontend UX

The backend is ready for this extension UX:

1. User opens popup.
2. Popup loads saved templates from `/api/gallery/designs/templates`.
3. User selects a template.
4. Popup applies template defaults locally and stores the chosen `defaultTemplateKey`.
5. User can still override tags/intent/template before save if needed.
6. One click on page save or image save uses the active template by default.

## Frontend Work Remaining

The next agent should finish the extension UI/flow, not redesign backend contracts.

Minimum target:
- make template selection obvious and frictionless in the popup
- make editing an existing template clean
- make “save as new template” vs “update current template” unambiguous
- keep one-click save fast
- do not reintroduce prompt-oriented UX into the designs flow

Recommended tasks:
- polish popup state handling around template load/save/delete
- auto-select the stored default template on popup open
- make template form fields reflect current selection reliably
- add a lightweight “use template for next saves” feel instead of exposing raw config-first UX
- manually test against localhost with Telegram-authenticated app session

## Manual Validation Checklist

1. Start app and Convex locally.
2. Log into the app in the browser used for extension template requests.
3. Load unpacked extension from `extension/`.
4. Open popup and confirm templates load from the app.
5. Create a template.
6. Reopen popup and confirm template persists.
7. Save current page with that template.
8. Save an image with that template.
9. Confirm both entries appear in the designs gallery with preview images.
10. Save the same image from a different source page and confirm it creates a separate entry.

## Verification Run

Completed for this backend pass:
- `bunx convex codegen`
- `bun run lint`
- `bun test`
- `bun run typecheck`

`bun run convex:dev` was started successfully and then stopped because it is a persistent dev process.

## Important Notes For Next Agent

- Treat backend as done for V1 unless a manual test exposes a real bug.
- Do not reopen the generic cross-pillar abstraction discussion in this pass.
- Do not remove the template table or collapse it back into a raw string field.
- If the extension frontend is completed, update:
  - `agent-docs/PROGRESS.md`
  - `agent-docs/OBSERVATIONS.md`
  - `agent-docs/BACKLOG.md`
  - this handoff doc

When the frontend is fully shipped, move the remaining extension item out of TODO/backlog and mark it done instead of leaving duplicate “next step” notes behind.
