# Feature Ticket: Masonry Filter Redesign Handoff

Status: Ready for implementation
Owner: Frontend + Design
Date: 2026-03-06

## Summary

Implement a new gallery filter experience for the masonry view. The target is a compact floating island at the top of the page, with a dynamic but disciplined tag system and stronger UX prioritization around which controls belong in the island.

This is a handoff task for another agent. Start from the restored pre-redesign baseline, not from the experimental dynamic island work.

## Scope

1. Redesign the gallery’s top controls into a compact floating island.
2. Keep the island visually stable in height during ordinary interaction.
3. Build a dynamic tag system that is searchable and efficient.
4. Prevent the tag system from causing the island container to resize unpredictably.
5. Remove non-essential controls from the island and relocate them if needed.
6. Ensure the masonry content remains visually dominant and can scroll naturally beneath the overlay.

## Product Intent

1. The gallery is a retrieval surface first.
2. The island should feel efficient, modern, and precise.
3. The UI should be fast to scan and low-friction to use.
4. The controls should support browsing without becoming the main event.

## Design Intent

1. Modern floating island with strong elevation and clean grouping.
2. Warm editorial brand language, not generic SaaS chrome.
3. Compact controls and micro-scale tags.
4. Stable visual composition with no awkward growth/shrink behavior.

## Requirements

### Layout

- [ ] Top controls are rebuilt as a compact floating island.
- [ ] The island is materially smaller than the previous large toolbar/header treatment.
- [ ] The island overlays the masonry view cleanly.
- [ ] The island does not expand vertically during normal tag interaction.

### Tags

- [ ] Tags are searchable.
- [ ] Selected tags are clearly visible.
- [ ] The default tag presentation is compact.
- [ ] Browsing more tags is possible without breaking the island layout.
- [ ] Tag interaction works on desktop and mobile.

### Control Prioritization

- [ ] Remove controls from the island that do not need constant top-level presence.
- [ ] Keep only the controls that support the primary retrieval loop.
- [ ] Structural or secondary controls may move to sidebar, sheet, or secondary UI if that improves clarity.

### Mobile

- [ ] Mobile keeps the same UX principles as desktop.
- [ ] Complex filtering may move into a dedicated sheet or secondary panel.
- [ ] Mobile controls remain light and do not overwhelm the viewport.

## Constraints

1. Do not change backend schema or query contracts.
2. Reuse the existing gallery state contract where possible.
3. Do not reintroduce unstable resizing behavior in the top filter container.
4. Prefer production-quality implementation over experimental styling churn.

## Suggested Implementation Approach

1. Audit the current stable baseline in the masonry gallery.
2. Decide what belongs in the island versus elsewhere.
3. Build the island shell first.
4. Implement the tag system as a controlled interaction model rather than a freeform expanding chip wall.
5. Verify behavior in-browser on desktop and mobile before polishing visuals.

## Acceptance Criteria

1. The default gallery view feels cleaner and more efficient than before.
2. The island feels like a floating control instrument, not a bulky page header.
3. Tag interactions feel stable and intentional.
4. The island does not resize unpredictably during tag exploration.
5. The final result is strong both UX-wise and visually.

## Verification

- [ ] `bun run lint`
- [ ] `bun test`
- [ ] Desktop visual pass in-browser
- [ ] Mobile visual pass in-browser

## Notes for the Next Agent

1. Do not continue from the broken dynamic-island/tagging experiments.
2. Start from the restored baseline and build a cleaner solution from first principles.
3. Favor stability, hierarchy, and restraint over feature packing.
