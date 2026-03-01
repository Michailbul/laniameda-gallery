# PRD: Image Focus Mode (Selection + Prompt + Side Panel UX)

Last updated: 2026-02-26  
Status: Draft  
Owner: Product + Frontend

## 1) Context

### Product vision alignment
`laniameda.gallery` is a personal AI creatorship vault. The core loop is:
1. save inspiration/prompts/assets,
2. retrieve them quickly,
3. reuse them for new generation workflows.

The gallery experience is the highest-traffic surface for this loop. Image selection is the key interaction that bridges browsing and action.

### Why now
Current implementation supports image selection and a desktop detail panel, but the interaction is not yet cohesive across prompt reading, action-taking, and cross-device behavior. This creates friction in the exact moment where users should transition from discovery to execution.

## 2) Problem Statement

When a user selects an image, the system should enter a clear "focus mode" that helps them:
1. inspect the reference,
2. understand and copy prompt context,
3. trigger actions quickly.

Current behavior has three UX gaps:
1. The selected state changes grid layout (`compactColumns`) and visual density abruptly, which can feel jumpy.
2. Prompt and metadata in the detail panel are functional but not structured for fast scanning and reuse.
3. On mobile, selection state exists but the right-side detail surface is hidden (`md:block`), so the user does not get an equivalent detail experience.

## 3) Goals and Success Metrics

### Goals
1. Make image selection feel intentional and stable (clear focus mode).
2. Improve prompt consumption and reuse speed.
3. Make side panel interactions actionable and consistent across desktop/mobile.
4. Preserve the current editorial, premium visual language from `agent-docs/DESIGN.md`.

### Success metrics (first release)
1. Increase prompt copy action rate per selected image by +25%.
2. Increase action-start rate (`Transfer Style`, `Transfer Pose`, `Replace Character`) per selected image by +20%.
3. Reduce "select then immediately deselect" behavior by -20%.
4. Achieve behavior parity on mobile (selection always opens a usable detail surface).

## 4) Non-Goals

1. No redesign of ingestion flow.
2. No change to core Convex schema for this release.
3. No full sidebar/navigation rewrite.
4. No expansion to non-image media behaviors (video/audio specific UX can be separate).

## 5) Target Users

1. Creator-curator: browses saved references and reuses prompts frequently.
2. Prompt operator: quickly copies/adapts prompts into AI workflows.
3. Mobile-first collector: reviews and triages references on phone.

## 6) Proposed Experience

### A) Focus mode entry/exit
1. Selecting an image enters Focus Mode.
2. Focus Mode keeps selected image visually anchored and highlights it without over-dimming the rest of the gallery.
3. Focus Mode can be exited by:
   - close button,
   - `Esc` key,
   - selecting a different image (switches focus target).

### B) Detail surface behavior
1. Desktop: right-side panel remains primary detail surface.
2. Mobile/tablet: detail surface opens as bottom sheet or full-screen overlay (not hidden).
3. Selection must never result in a state where detail content is inaccessible.

### C) Side panel information architecture
Panel uses 3 tabs:
1. `Prompt` (default)
   - full prompt text with improved readability,
   - copy prompt,
   - expand/collapse for long prompts.
2. `Details`
   - model,
   - pillar,
   - tags,
   - source URL (if available),
   - created date/time.
3. `Actions`
   - `Transfer Style`,
   - `Transfer Pose`,
   - `Replace Character`,
   - clear run status CTA linking to workspace panel when active.

### D) Prompt UX improvements
1. Better line-height and max width for readability.
2. "Copy Prompt" feedback should be immediate and persistent enough to notice.
3. Long prompt controls should use explicit labels (`Show more` / `Show less`) and preserve scroll position.

### E) Side tab and keyboard efficiency
1. Keyboard:
   - `Esc` closes focus mode,
   - `Cmd/Ctrl + C` copies prompt when panel is focused,
   - Arrow up/down optionally navigates to previous/next image (phase 2).
2. Tab order must be predictable and accessible.

## 7) Functional Requirements

### FR-1: Selection state model
1. `selectedImage` must include all fields needed by panel tabs (prompt, model, pillar, tags, source, createdAt, dimensions, URLs).
2. Data should come from existing `listGalleryAssets` result to avoid extra round trips for initial panel render.

### FR-2: Responsive detail surface parity
1. Desktop uses right panel.
2. Mobile uses sheet/overlay detail.
3. No dead-end selected states on any viewport.

### FR-3: Panel tab system
1. Add tab switcher in `ExpandedDetail`.
2. Keep default on `Prompt`.
3. Preserve tab state while switching selected images in same session (optional for v1, required for v2).

### FR-4: Action continuity
1. Starting an action from panel must open/update `AiWorkspacePanel`.
2. Action status must remain visible even if user changes selected image.

### FR-5: Accessibility
1. Focus trap in mobile overlay detail.
2. Keyboard-close and screen-reader labels for tab controls and action buttons.
3. Minimum contrast compliance with existing theme tokens.

## 8) Data and Backend Requirements

1. No Convex schema changes required.
2. Use existing `assets.listGalleryAssets` fields (`promptText`, `tagNames`, `modelName`, `pillar`, `createdAt`, `sourceUrl`, `url`, `thumbUrl`).
3. Frontend mapping should pass richer selected payload from `GalleryDashboard` -> `MasonryGrid` -> `ExpandedDetail`.

## 9) UX and Visual Requirements

1. Keep current monochrome editorial + premium tone.
2. Avoid noisy effects in focus mode; use subtle emphasis over high-saturation highlights.
3. Panel spacing and typographic rhythm should match `agent-docs/DESIGN.md` component rules.
4. Preserve quick scanning of gallery while in focus mode.

## 10) Implementation Plan (Task Breakdown)

### Phase 1: Foundation (MVP)
1. Define Focus Mode interaction spec (desktop + mobile parity).
2. Extend selected image payload/types for panel tabs.
3. Build tabbed `ExpandedDetail` structure (`Prompt`, `Details`, `Actions`).
4. Implement mobile detail sheet/overlay.
5. Add keyboard close + accessibility labels.
6. QA across breakpoints and ensure no inaccessible selected state.

### Phase 2: Polish and efficiency
1. Improve visual transitions between grid and focus mode.
2. Add optional next/previous image keyboard navigation.
3. Add richer prompt formatting (line breaks, optional code-block style).
4. Add low-friction telemetry hooks for selection/copy/action funnel.

### Phase 3: Optimization
1. Improve preloading strategy for selected full-res assets.
2. Tune compact grid behavior to reduce layout shift.
3. Add contextual recommendations (related tags/prompts) in side panel.

## 11) Acceptance Criteria

1. Selecting an image always opens a usable detail surface on desktop and mobile.
2. Prompt can be read fully and copied in <= 2 clicks/taps.
3. User can trigger any of the three AI actions from Actions tab with visible status.
4. Focus mode can be exited reliably with close control and `Esc` (desktop).
5. No regressions in existing filters (pillar, tags, folder, model) while focus mode is active.

## 12) Risks and Mitigations

1. Risk: scope creep into full gallery redesign.
   - Mitigation: confine scope to selection/prompt/panel flows and parity.
2. Risk: mobile overlay conflicts with bottom nav and upload modal.
   - Mitigation: define z-index and modal stack order explicitly.
3. Risk: interaction regressions with workspace panel.
   - Mitigation: add integration tests for action-start from selected image.

## 13) Open Questions

1. Should focus mode preserve grid scroll position when closing detail on mobile?
2. Should tab choice persist globally or per session only?
3. Do we want "Details" tab to show prompt provenance/source history in v1 or v2?
4. Should selecting image from recent updates in sidebar also open focus mode directly?

