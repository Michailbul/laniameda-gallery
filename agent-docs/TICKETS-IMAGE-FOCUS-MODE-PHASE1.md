# Tickets: Image Focus Mode (Phase 1)

Last updated: 2026-02-26  
Source PRD: `agent-docs/PRD-IMAGE-FOCUS-MODE.md`  
Epic: Image Focus Mode (Selection + Prompt + Side Panel UX)

## Sprint Goal

Deliver Phase 1 of Image Focus Mode so selecting any image always opens a usable detail surface (desktop + mobile), with structured prompt/details/actions UX, keyboard-close behavior, and no filtering regressions.

## Execution Order

1. IFM-01: Focus mode state contract
2. IFM-02: Tabbed detail panel (desktop)
3. IFM-03: Mobile detail surface parity
4. IFM-04: Action continuity with workspace panel
5. IFM-05: Accessibility + keyboard support
6. IFM-06: QA and regression hardening

## Ticket Backlog

## IFM-01 — Define Focus Mode State Contract

- Type: Frontend foundation
- Priority: P0
- Estimate: 0.5 day
- Owner: Frontend
- Dependencies: None

### Scope

Standardize selected-image payload so detail tabs can render without additional requests.

### Implementation tasks

1. Create a shared selected-image type used by `GalleryDashboard`, `MasonryGrid`, `ImageCard`, and `ExpandedDetail`.
2. Include fields needed for tabs: `prompt`, `modelName`, `pillar`, `tagNames`, `sourceUrl`, `createdAt`, `width`, `height`, `fullSrc`, `thumbSrc`.
3. Ensure `listGalleryAssets` mapping in dashboard passes these fields through.
4. Ensure selection switching replaces panel content without stale state leaks.

### Acceptance criteria

1. Selecting any grid image provides enough data to render Prompt, Details, and Actions tabs.
2. No additional Convex query is needed for initial detail render.
3. Existing filter behavior (pillar, folder, tags, model) remains unchanged.

---

## IFM-02 — Build Tabbed Detail Panel (Desktop)

- Type: Frontend feature
- Priority: P0
- Estimate: 1.5 days
- Owner: Frontend
- Dependencies: IFM-01

### Scope

Refactor `ExpandedDetail` into tabbed IA:
- `Prompt` (default)
- `Details`
- `Actions`

### Implementation tasks

1. Add tab navigation UI and local tab state (default `Prompt`).
2. Prompt tab:
   - readable prompt layout,
   - show more/less for long text,
   - copy prompt with visible success state.
3. Details tab:
   - model,
   - pillar,
   - tags,
   - source URL (if present),
   - created date/time.
4. Actions tab:
   - transfer style,
   - transfer pose,
   - replace character.
5. Keep panel close affordance and maintain existing visual language.

### Acceptance criteria

1. Desktop detail panel renders all three tabs.
2. Prompt copy works in <= 2 clicks and shows feedback.
3. Actions still trigger existing run flow.
4. UI matches current design system tone (monochrome editorial).

---

## IFM-03 — Mobile Detail Surface Parity

- Type: Frontend feature
- Priority: P0
- Estimate: 1 day
- Owner: Frontend
- Dependencies: IFM-01, IFM-02

### Scope

Provide a mobile detail surface (sheet or full-screen overlay) using the same tabbed content as desktop panel.

### Implementation tasks

1. Add mobile-only detail container that opens on image select.
2. Reuse `ExpandedDetail` content component to avoid duplicate logic.
3. Ensure close actions work via top close button and backdrop.
4. Verify coexistence with `MobileBottomNav`, upload modal, and workspace panel layering.

### Acceptance criteria

1. On mobile, selecting an image always opens a visible detail surface.
2. User can read/copy prompt and run actions from mobile detail surface.
3. No dead-end selected state exists on small screens.

---

## IFM-04 — Preserve Action Continuity with AI Workspace Panel

- Type: Frontend integration
- Priority: P1
- Estimate: 0.5 day
- Owner: Frontend
- Dependencies: IFM-02, IFM-03

### Scope

Ensure action state remains coherent when user changes selection while a run is active.

### Implementation tasks

1. Keep `AiWorkspacePanel` status independent from currently selected image.
2. Ensure new selection does not cancel or overwrite in-progress run state unexpectedly.
3. Add visible link/cue in Actions tab when a run is active (`View current run` behavior).

### Acceptance criteria

1. Starting an action opens workspace panel and keeps run status visible.
2. Switching selected images does not break ongoing run UI state.
3. Error/success states still display correctly.

---

## IFM-05 — Accessibility and Keyboard Support

- Type: Accessibility
- Priority: P0
- Estimate: 0.5 day
- Owner: Frontend
- Dependencies: IFM-02, IFM-03

### Scope

Add required keyboard and accessibility behavior for focus mode.

### Implementation tasks

1. Add `Esc` to close detail surface (desktop + mobile overlay).
2. Add proper ARIA labels for close, tabs, copy, and action buttons.
3. Ensure mobile overlay has focus trap and correct initial focus.
4. Ensure logical tab order through tab controls and panel actions.

### Acceptance criteria

1. `Esc` closes active detail surface on desktop and mobile overlay contexts.
2. All interactive controls in panel have accessible labels.
3. Keyboard navigation sequence is predictable and complete.

---

## IFM-06 — QA and Regression Hardening

- Type: QA/Test
- Priority: P0
- Estimate: 1 day
- Owner: Frontend + QA
- Dependencies: IFM-01 to IFM-05

### Scope

Validate no regressions and complete the phase with explicit test coverage.

### Implementation tasks

1. Manual QA matrix:
   - desktop, tablet, mobile breakpoints,
   - with and without selected image,
   - with and without model/pillar/tags data.
2. Regression checks:
   - top filters,
   - sidebar interactions,
   - upload modal opening,
   - workspace panel open/close.
3. Add/extend tests for:
   - selected image payload mapping,
   - tab default state,
   - mobile surface open/close behavior.
4. Final quality gates:
   - `bun run lint`
   - `bun test`

### Acceptance criteria

1. All acceptance criteria from IFM-01..05 are verified.
2. No critical regressions in gallery browsing or ingest flows.
3. CI-equivalent local checks pass.

## Definition of Done (Phase 1)

1. All P0 tickets complete and accepted.
2. Mobile/desktop parity achieved for image selection detail flow.
3. Prompt, details, and actions are accessible from a single cohesive focus mode.
4. Lint/tests pass and documentation remains updated.

## Suggested Assignment Split

1. Engineer A: IFM-01, IFM-02
2. Engineer B: IFM-03, IFM-05
3. Engineer A + B: IFM-04 integration
4. QA pass jointly on IFM-06

