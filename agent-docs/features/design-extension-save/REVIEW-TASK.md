# Review Task: Design Extension + Gallery Functional Verification

Status: Ready
Owner: Full-stack / QA
Date: 2026-04-01

## Goal

Run an end-to-end review of the recent design-extension save work and confirm the gallery app is fully functional with the new backend/frontend wiring in place.

This is a verification task, not a redesign task. Prefer finding real breakage, missing wiring, bad assumptions, or doc drift over proposing speculative architecture changes.

## Scope

Review and validate:

- extension popup template flow
- extension page save flow
- extension image save flow
- authenticated template CRUD route
- extension save route to Convex action
- design gallery rendering/filtering of newly saved entries
- local Convex/dev environment wiring
- any doc drift in extension handoff/fix notes

## Files To Read First

- `AGENTS.md`
- `agent-docs/PROGRESS.md`
- `agent-docs/OBSERVATIONS.md`
- `convex/schema.ts`
- `agent-docs/features/design-extension-save/HANDOFF.md`
- `agent-docs/features/design-extension-save/CONVEX-DEPLOYMENT-FIX.md`

## Files Most Likely In Scope

- `extension/popup.html`
- `extension/popup.js`
- `extension/background.js`
- `extension/content.js`
- `app/api/extension/design/save/route.ts`
- `app/api/gallery/designs/templates/route.ts`
- `app/api/gallery/designs/route.ts`
- `convex/designExtensionSaves.ts`
- `convex/designSaveTemplates.ts`
- `convex/designInspirations.ts`
- `lib/server/extension-auth.ts`
- `scripts/convex-dev.ts`
- `scripts/lib/convex-dev-env.ts`
- `.env.local`

## Required Review Checklist

- [ ] Confirm `bun run convex:dev --once` succeeds from this repo without cross-project schema mismatch
- [ ] Confirm `bun run lint` passes
- [ ] Confirm `bun test` passes
- [ ] Confirm extension popup loads existing templates from the logged-in app session
- [ ] Confirm selecting a template actually affects the next page save without a separate hidden setup step
- [ ] Confirm saving the current page writes a `designInspiration` with preview asset in the `designs` pillar
- [ ] Confirm image hover save writes the image preview asset and correct design metadata
- [ ] Confirm template create/update/delete works from the popup against `/api/gallery/designs/templates`
- [ ] Confirm saved entries appear in the designs gallery with preview image, tags, and metadata
- [ ] Confirm re-saving the same page dedupes correctly by source fingerprint
- [ ] Confirm saving the same image from different source pages still creates distinct design entries
- [ ] Confirm any auth/CORS/session assumptions used by the extension still work in a real browser session
- [ ] Confirm docs match reality; update docs if a verified mismatch is found

## Manual Validation Flow

1. Start local app and Convex.
2. Log into the app in the same browser profile used for the extension.
3. Load the unpacked extension from `extension/`.
4. Open the popup and verify template list loads.
5. Create a new template with non-default metadata.
6. Reopen popup and verify the template persists and can be selected.
7. Save the current page and verify the saved record uses the selected template/defaults.
8. Save a visible image from the page and verify the image save lands in the designs gallery.
9. Open the designs gallery and verify preview, tags, capture kind, save intent, platform, workflow type, and source data.
10. Repeat a dedupe case and a same-image-different-source-page case.

## Reporting Format

Return:

1. Findings first, ordered by severity, with file references where applicable.
2. Explicit pass/fail for:
   - extension popup/template UX
   - extension save backend/frontend wiring
   - local Convex setup
   - gallery rendering of saved design entries
3. A short list of remaining manual risks if no bug is found.

If everything passes, say so explicitly and identify any residual untested edge cases.
