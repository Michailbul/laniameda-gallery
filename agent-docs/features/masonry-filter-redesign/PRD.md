# PRD: Masonry Gallery Filter Redesign

Last updated: 2026-03-06
Status: Proposed
Owner: Product + Design + Frontend

## 1) Context

`laniameda.gallery` is a personal AI creatorship vault. The masonry gallery is the main retrieval surface, so the filter controls need to support fast scanning, low-friction narrowing, and strong visual clarity without competing with the content itself.

The current baseline works functionally, but it does not yet express the intended product direction:
1. The top control area should feel like a modern floating instrument panel, not a bulky header.
2. The tag system should support dynamic browsing without breaking layout stability.
3. The control surface should expose only high-value actions and remove anything that creates noise or steals visual real estate from the gallery.

## 2) Problem Statement

The gallery filter experience is not yet aligned with the product we want:
1. The filter container can become too visually heavy.
2. The tag system can feel crowded or unstable when many tags are shown.
3. Too many controls compete for the same limited top area.
4. The gallery should remain the hero, while controls should feel efficient, precise, and easy to understand.

## 3) Product Vision

The gallery should feel like an editorial creative vault with a precise control system layered above it.

Product qualities:
1. Fast to understand.
2. Efficient to operate.
3. Stable while filtering.
4. Focused on content retrieval, not chrome.

Design qualities:
1. A compact floating island anchored at the top of the masonry view.
2. A modern but warm control surface aligned with the existing laniameda brand language.
3. Clear hierarchy between content and controls.
4. Stronger UX discipline around what belongs in the island and what belongs elsewhere.

## 4) Goals

1. Create a compact floating filter island that feels modern and intentional.
2. Keep the island height visually stable during normal filter interaction.
3. Redesign tags so they are dynamic, useful, and space-efficient.
4. Remove non-essential controls from the island.
5. Preserve a strong sense of speed and control in the masonry browsing workflow.
6. Keep the masonry content visible and visually dominant.

## 5) Non-Goals

1. No backend or Convex schema changes.
2. No changes to ingestion or gallery query contracts.
3. No redesign of the masonry cards themselves in this phase.
4. No new information architecture for the entire app beyond the gallery control system.

## 6) Target User Experience

Primary user story:
1. Michael opens the gallery and immediately sees the content, not a wall of controls.
2. He can quickly switch scope, adjust sort/model filters, and narrow by tags without the UI becoming noisy.
3. He can browse more tags when needed, but the island does not jump in size or dominate the screen.
4. The interaction feels premium, efficient, and calm.

UX principles:
1. The island is a control surface, not a page header.
2. Default state should be compact.
3. Expanded tag browsing should be deliberate.
4. The height of the island should remain stable in ordinary use.
5. The gallery content should continue behind and beneath the island in a polished way.

## 7) Functional Requirements

### 7.1 Top Floating Island

1. The island must remain compact in its default state.
2. It should contain only core controls that deserve top-level visibility.
3. It should feel like a floating layer over the masonry canvas, not a full-width toolbar slab.
4. It should not visibly resize as the user toggles tags or interacts with common controls.

### 7.2 Tag System

1. Tags must be dynamic and searchable.
2. The default visible tag treatment must be compact and predictable.
3. Selected tags should stay visible and easy to understand.
4. Browsing additional tags must not cause the island container to grow unpredictably.
5. Tag interaction should feel fast and reliable on both desktop and mobile.

### 7.3 Control Prioritization

1. Only controls with strong day-to-day value should remain in the island.
2. Structural filters that do not need prime placement should move elsewhere.
3. The island should not become the place where every filter lives by default.

### 7.4 Mobile

1. Mobile must keep the same product principles as desktop.
2. Complex filter exploration may live in a sheet or secondary layer.
3. Mobile controls must remain lightweight and easy to dismiss.

## 8) Design Direction

The target aesthetic is modern editorial efficiency.

Key design traits:
1. Floating island with clear elevation and crisp layering.
2. Warm paper-based surfaces, not generic SaaS glass.
3. Strong but restrained accents from the laniameda palette.
4. High legibility and clean control grouping.
5. Compact chips and controls with clear active states.

The gallery background and content should remain visually rich, but the island should not compete with the imagery. It should read like a precise navigation instrument sitting above a creative field.

## 9) Interaction Model

1. Default island state is compact and stable.
2. Tag search is immediate.
3. Additional tags are revealed in a controlled way that does not reflow the island height unpredictably.
4. Selected filters remain visible and understandable.
5. Reset behavior remains clear and global across relevant gallery filters.

## 10) Success Criteria

1. The top of the gallery feels materially less bulky than the current redesign attempts.
2. The island height remains stable during normal tag interactions.
3. Tag filtering feels reliable and does not appear broken or crowded.
4. The masonry content remains the dominant visual element.
5. The controls feel faster and more deliberate than the prior versions.

## 11) Risks and Mitigations

1. Risk: over-compressing controls hurts discoverability.
   - Mitigation: keep a clear hierarchy and preserve obvious search/reset affordances.
2. Risk: dynamic tag browsing still causes layout instability.
   - Mitigation: use a bounded tag browsing region or separate controlled reveal pattern.
3. Risk: floating treatment becomes visually fashionable but functionally weak.
   - Mitigation: evaluate every element by retrieval speed and clarity, not novelty.

## 12) Rollout

1. Revert to the stable pre-redesign baseline.
2. Implement the new floating-island system behind the current gallery state contract.
3. Validate in-browser on desktop and mobile.
4. Keep scope limited to the gallery filter experience in this phase.
