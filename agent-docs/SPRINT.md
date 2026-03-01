# SPRINT: Dashboard Polish — From Prototype to Studio-Grade

Last updated: 2026-02-27
Status: Ready for execution
Owner: Frontend

---

## Sprint Vision

Transform laniameda.gallery from a "works well" prototype into a **polished, tactile creative tool** that feels like a studio console. Every surface, transition, and interaction should communicate quiet confidence and editorial precision.

**North star**: A photographer opens the gallery, selects an image, copies the prompt, and triggers an action — all in under 4 seconds, on any device, and every step *feels* intentional.

---

## Current State Assessment

| Area | Score | Key Gap |
|------|-------|---------|
| Visual consistency | 7/10 | Inline styles everywhere, no shadow system, buttons unstyled |
| Interaction quality | 6/10 | Hover handlers are JS, not CSS; tab switches instant (no animation) |
| Mobile parity | 6/10 | Detail sheet exists but drag handle is decorative, swipe not wired |
| Accessibility | 7/10 | Good baseline but FilterTab lacks hover states, no skip links |
| Typography | 6/10 | Scale defined but inconsistently applied; hardcoded px sizes |
| Animation system | 8/10 | Keyframes excellent, application inconsistent |
| Performance | 8/10 | Incremental rendering works, good lazy loading |

---

## Success Metrics

### Interaction Speed
- **Prompt copy**: <= 1 click from detail panel open (currently 1 — maintain)
- **Action trigger**: <= 2 clicks from image selection (select → Actions tab → click)
- **Image navigation**: < 200ms perceived latency between prev/next

### Visual Polish
- **Zero hardcoded inline hover handlers**: All hover states via CSS `:hover` or Tailwind `hover:` classes
- **Consistent elevation vocabulary**: 3 named shadow levels applied everywhere
- **Typography audit passes**: No more than 6 distinct font-size values used across the app

### Mobile
- **Swipe-to-dismiss**: Mobile detail sheet dismissible via swipe-down
- **Swipe navigation**: Left/right swipe navigates images on mobile detail
- **Touch feedback**: All tappable elements have `active:scale-95` or equivalent

### Accessibility
- **Tab navigation complete**: Every interactive element reachable via keyboard
- **ARIA audit clean**: All roles, labels, and states correctly declared
- **Contrast minimum**: All text meets WCAG AA (4.5:1 for body, 3:1 for large text)

---

## Agent Instructions

### Before Starting

1. Read `AGENTS.md` for project context and conventions
2. Read `agent-docs/DESIGN.md` for the visual direction (note: it describes the **original** dark theme; the current implementation uses a **warm paper** light theme — follow the *implemented* aesthetic, not the doc's dark-mode description)
3. Run `bun run lint && bun test` to confirm clean baseline
4. **Use these skills** when implementing visual changes:
   - `/frontend-design` — for production-grade interface patterns
   - `/superdesign` — for UI/UX design intelligence before implementing screens
   - `/web-design-guidelines` — to review UI code for compliance
   - `/react-dev` — for React component patterns with TypeScript
   - `/design-system-starter` — when creating new design tokens or component variants

### Design Principles (Follow These)

1. **Warm editorial tone** — paper backgrounds, ink text, serif display accents. This is a creative vault, not a SaaS dashboard.
2. **Pillar-aware everything** — the pillar accent color (`--coral` / `--amber-9`) should tint interactive elements contextually. Use `rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), ...)` for dynamic tinting.
3. **Content is hero** — images dominate; chrome should recede. Sidebar, filters, and panels serve the gallery, not the other way around.
4. **Quiet confidence** — no loud hover effects, no neon glows, no bouncy animations. Smooth, fast, controlled.
5. **CSS-first interactions** — prefer Tailwind `hover:`, `active:`, `focus:` over `onMouseEnter`/`onMouseLeave` JS handlers wherever possible.
6. **Progressive disclosure** — show essential info first (image + prompt), details on demand (tabs), power features behind menus.

### Implementation Rules

1. **Never add new inline `style={{ }}` for hover/active states** — use CSS classes or Tailwind
2. **Use existing CSS variables** — `var(--text-primary)`, `var(--surface-2)`, `var(--duration-fast)`, etc. Don't hardcode colors or timings
3. **Use existing animation classes** — `animate-fade-in`, `animate-panel-slide-in`, `animate-card-entrance`, etc.
4. **Test at 3 breakpoints**: mobile (375px), tablet (768px), desktop (1440px)
5. **Run `bun run lint && bun test`** after every task
6. **Preserve pillar theming** — verify accent colors shift correctly when switching pillars

### Typography Rules

Use **only** these size tiers (map to existing CSS vars):

| Tier | Size | Use for |
|------|------|---------|
| `micro` | 10px | Section labels, tracking-wide uppercase mono |
| `xs` | 11px | Badges, counts, timestamps, metadata |
| `sm` | 13px | Body text, button labels, nav items |
| `base` | 15px | Primary content text |
| `lg` | 18px | Section headings |
| `xl` | 24px | Page headings |
| `display` | 32-48px | Hero text, empty states (Georgia italic) |

### Shadow / Elevation System (Create This)

Define 3 named levels in `globals.css`:

| Level | Token | Use for |
|-------|-------|---------|
| `--shadow-sm` | `0 1px 3px rgba(32,23,16,0.06), 0 1px 2px rgba(32,23,16,0.04)` | Cards at rest, badges |
| `--shadow-md` | `0 4px 12px rgba(32,23,16,0.08), 0 2px 4px rgba(32,23,16,0.04)` | Hover states, dropdowns |
| `--shadow-lg` | `0 12px 40px rgba(32,23,16,0.12), 0 4px 8px rgba(32,23,16,0.06)` | Modals, floating panels |

---

## Tickets

### SP-01 — Replace Inline Hover Handlers with CSS Classes
- **Priority**: P0
- **Effort**: 3-4 hours
- **Files**: `image-card.tsx`, `app-sidebar.tsx`, `top-filter-bar.tsx`, `expanded-detail.tsx`, `mobile-bottom-nav.tsx`

#### Problem
Nearly every interactive element uses `onMouseEnter` / `onMouseLeave` with `e.currentTarget.style.X = Y` mutations. This is:
- Hard to audit and maintain
- Causes unnecessary DOM mutations
- Not declarative
- Doesn't work with keyboard focus states

#### Implementation
1. Create reusable CSS utility classes in `globals.css` for common hover patterns:
   ```css
   .interactive-ghost { /* transparent → surface-2 on hover, text color shift */ }
   .interactive-surface { /* surface-2 → surface-3 on hover */ }
   .interactive-primary { /* coral → coral-hover on hover */ }
   ```
2. Replace all `onMouseEnter`/`onMouseLeave` pairs in each file with appropriate Tailwind `hover:` classes or the new utility classes
3. Ensure `:focus-visible` states mirror hover states for keyboard users
4. Verify pillar accent colors still shift correctly (test with `data-pillar="designs"`)

#### Success Criteria
- Zero `onMouseEnter` / `onMouseLeave` handlers remaining for basic hover styling
- All interactive elements have visible hover AND focus-visible states
- No visual regression in any component

#### Design Notes
- Hover transitions should use `transition-colors` with `duration-[80ms]` (instant feel)
- Active states: `active:scale-[0.98]` for buttons, no scale for nav items
- Ghost buttons: `hover:bg-[var(--surface-2)]` + `hover:text-[var(--text-primary)]`

---

### SP-02 — Add Shadow/Elevation System
- **Priority**: P0
- **Effort**: 1 hour
- **Files**: `app/globals.css`, then apply across `image-card.tsx`, `expanded-detail.tsx`, `top-filter-bar.tsx`

#### Implementation
1. Add `--shadow-sm`, `--shadow-md`, `--shadow-lg` tokens to `:root` in globals.css
2. Add pillar-aware shadow variants: `--shadow-pillar-glow` using `rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), ...)`
3. Replace all hardcoded `boxShadow` strings with the appropriate token
4. Add Tailwind theme extension if needed for `shadow-sm`/`shadow-md`/`shadow-lg`

#### Success Criteria
- All shadows reference tokens, no hardcoded rgba shadow strings
- Cards, dropdowns, modals each use the correct elevation level

---

### SP-03 — Wire Swipe Gestures to Mobile Detail Sheet
- **Priority**: P0
- **Effort**: 2 hours
- **Files**: `gallery-dashboard.tsx`, `lib/use-swipe-gesture.ts`

#### Problem
`use-swipe-gesture.ts` hook exists but is not yet connected to the mobile detail sheet. The drag handle at top of the sheet is visual-only.

#### Implementation
1. Import `useSwipeGesture` in `gallery-dashboard.tsx`
2. Wire to the mobile detail `ref`:
   - **Swipe down** → `closeSelectedImage()`
   - **Swipe left** → `goToNext()`
   - **Swipe right** → `goToPrev()`
3. Add visual feedback during swipe: translate the sheet Y-position during touch-move (not just touch-end)
4. Add spring-back animation if swipe doesn't cross threshold

#### Success Criteria
- Swipe down on mobile detail dismisses the sheet
- Swipe left/right navigates between images
- Sheet has visible movement during swipe gesture (not just on release)
- No conflict with scrolling within the detail content

---

### SP-04 — Tab Content Transition Animation
- **Priority**: P1
- **Effort**: 1.5 hours
- **Files**: `expanded-detail.tsx`, `app/globals.css`

#### Problem
Switching tabs in the detail panel causes content to appear/disappear instantly. No crossfade or slide animation.

#### Implementation
1. Add a `@keyframes tab-content-enter` animation (fade-in + subtle translateY):
   ```css
   @keyframes tab-content-enter {
     from { opacity: 0; transform: translateY(4px); }
     to { opacity: 1; transform: translateY(0); }
   }
   ```
2. Apply `.animate-tab-content-enter` class to each tab content wrapper
3. Key each tab content on `activeTab` so React remounts with animation
4. Duration: `var(--duration-fast)` (150ms) — should feel instant but smooth

#### Success Criteria
- Tab content fades in smoothly when switching
- No layout shift during transition
- Reduced motion users see no animation

---

### SP-05 — Polish FilterTab and TagButton Components
- **Priority**: P1
- **Effort**: 2 hours
- **Files**: `top-filter-bar.tsx`

#### Problem
- `FilterTab` (pillar/folder selectors) has weak active state — just color change
- `TagButton` lacks visual affordance for interactivity
- No smooth transitions between selected/unselected states

#### Implementation
1. **FilterTab active state**: Add subtle background fill + bottom indicator line for active tab
2. **FilterTab hover**: Background fill on hover (`var(--surface-2)`), smooth transition
3. **TagButton hover**: Border color shift + slight background change on hover
4. **TagButton selected**: Add animated dot indicator or check icon for selected state
5. **ModelChip hover**: Background opacity increase on hover
6. All transitions via CSS, not JS handlers
7. Add `active:scale-[0.97]` for tactile press feedback

#### Design Specifications
- Active FilterTab: `background: var(--coral)`, `color: #fff`, `font-weight: 600` (already done)
- Hover FilterTab (inactive): `background: var(--surface-2)`, `color: var(--text-primary)`
- Active TagButton: `background: var(--ink)`, `color: #fff` (already done)
- Hover TagButton (inactive): `background: var(--surface-3)`, `border-color: var(--border-default)`

#### Success Criteria
- All filter/tag elements have visible hover feedback via CSS
- Active state clearly distinguishable at a glance
- Smooth 80ms transitions on all state changes
- Pillar colors correctly tint active states

---

### SP-06 — Image Card Hover Refinement
- **Priority**: P1
- **Effort**: 2 hours
- **Files**: `image-card.tsx`, `app/globals.css`

#### Problem
Image card hover overlay uses 15+ inline style mutations. The overlay gradient, glow ring, and inner shadow are all applied via JS.

#### Implementation
1. Convert all card hover styling to CSS classes:
   - `.card-overlay` base state (invisible)
   - `.group-hover .card-overlay` visible state
   - `.card-glow-ring` for the gradient border effect
   - `.card-inner-glow` for the bottom warm shadow
2. Move the prompt text overlay to pure CSS positioning
3. Ensure the "view details" `Maximize2` icon appears smoothly
4. Maintain the staggered entrance animation (`animationDelay`)
5. Focus dimming: selected card `opacity: 1` + `scale(1.02)`, others `opacity: 0.65` — do via CSS using a parent data attribute

#### Design Specifications
- Hover lift: `translateY(-4px) scale(1.01)` over `250ms`
- Shadow on hover: `var(--shadow-lg)` + pillar glow ring
- Prompt text: max 2 lines, `text-shadow` for readability over image
- View details icon: 7x7 rounded-lg, glass background, appears at bottom-right

#### Success Criteria
- Zero inline style mutations in image-card hover logic
- Hover feels smooth and premium (no jank, no flicker)
- Selected/dimmed states work correctly
- Card hover works identically across all pillars

---

### SP-07 — Sidebar Visual Polish
- **Priority**: P1
- **Effort**: 2 hours
- **Files**: `app-sidebar.tsx`

#### Problem
- Collapsed state: generic `User` icon for unauthenticated users could use settings gear for logged-in users
- Model list: "Show more" button is plain text
- Nav items still have some inline style remnants

#### Implementation
1. Convert NavItem hover/active styles to CSS classes
2. Convert TagRow hover/active styles to CSS classes
3. Add settings gear icon next to username (non-functional, future-ready)
4. Style "Show more/less" button as a subtle chip with chevron icon
5. Ensure collapsed sidebar shows tooltips (either native `title` attr or a simple CSS tooltip)
6. Vault Stats card: add subtle pulse animation on first load, then settle
7. Polish the collapse/expand animation:
   - Content should fade during transition, not just clip
   - Logo text should fade out before sidebar narrows

#### Design Specifications
- NavItem active: left marker (7px coral square) + filled icon box + bold mono label
- NavItem hover: `background: rgba(255,255,255,0.42)`, `color: var(--text-primary)`
- TagRow active: filled indicator square with check, bold mono label, pillar-tinted border
- Collapsed tooltip: `title` attribute is sufficient for MVP, proper `Tooltip` component for v2

#### Success Criteria
- All sidebar hover states via CSS
- Collapse animation feels smooth (no content clipping)
- Settings gear visible next to username
- "Show more" is a proper styled control

---

### SP-08 — Detail Panel Copy Feedback Enhancement
- **Priority**: P1
- **Effort**: 1.5 hours
- **Files**: `expanded-detail.tsx`, `app/globals.css`

#### Problem
Copy feedback is a color change ("Copied!") that lasts 1.5s. Easy to miss. The copy dropdown menu lacks visual hierarchy.

#### Implementation
1. Add a mini toast notification at the bottom of the detail panel:
   - Appears with `animate-toast-enter` (already defined)
   - Shows "Prompt copied" / "URL copied" / "Package copied" with pillar-tinted background
   - Auto-dismisses after 2s with `animate-toast-exit`
2. Style the copy dropdown menu:
   - Add subtle separator between items
   - Add keyboard shortcut hint next to "Copy Prompt" (`⌘C`)
   - Highlight primary action (Copy Prompt) with slightly bolder weight
3. Close dropdown on click outside (add `useEffect` with click-outside listener)

#### Design Specifications
- Toast: `background: rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.12)`, `border: 1px solid rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.25)`, `color: var(--text-primary)`
- Toast position: fixed to bottom of detail panel, centered, `z-index: 10`
- Dropdown: `background: var(--paper)`, `border: 1px solid var(--border-default)`, `shadow: var(--shadow-md)`

#### Success Criteria
- Copy action produces visible, unmissable feedback
- Dropdown closes on outside click
- Toast is pillar-tinted and matches the editorial tone
- Keyboard shortcut hint visible

---

### SP-09 — Empty State & Loading Polish
- **Priority**: P2
- **Effort**: 1.5 hours
- **Files**: `gallery-dashboard.tsx`, `masonry-grid.tsx`, `app/globals.css`

#### Problem
- "Start your collection" and "No matches" states are functional but could be more editorial
- Loading skeleton aspect ratios are hardcoded
- No transition between loading → content states

#### Implementation
1. Add a crossfade transition from skeleton → real content:
   - Skeleton uses `animate-fade-in` on mount
   - Real grid uses `animate-fade-in` on mount
   - No jarring layout shift
2. Randomize skeleton aspect ratios slightly per render (use seeded random from image count)
3. Polish "Start your collection" empty state:
   - Larger display text (48px Georgia italic)
   - Add a subtle illustration or icon composition (stacked image frames)
   - CTA button with pillar-tinted shadow
4. Polish "No matches" state:
   - Editorial tone: "Nothing here yet" instead of "No matches"
   - "Clear filters" button should match ghost button styling
   - Add filter summary showing what's active: "Filtering by: Cars + flux-dev"
5. Add `aria-live="polite"` region so screen readers announce state changes

#### Success Criteria
- Empty states feel editorial and encouraging
- Loading → content transition is smooth
- Filter summary visible in no-matches state
- Screen reader announces grid content changes

---

### SP-10 — Mobile Detail Sheet Full Polish
- **Priority**: P2
- **Effort**: 2.5 hours
- **Files**: `gallery-dashboard.tsx`, `expanded-detail.tsx`, `app/globals.css`

#### Problem
Mobile detail sheet has basic structure but needs:
- Proper drag-to-dismiss physics
- Visual parity with desktop detail panel
- Better backdrop interaction
- Safe area handling for notched phones

#### Implementation
1. Drag handle: style as 4px × 40px rounded capsule, `background: rgba(255,255,255,0.3)`
2. Sheet corners: `rounded-t-3xl` for premium feel
3. Add `padding-bottom: env(safe-area-inset-bottom)` to sheet content
4. Backdrop: add `animate-fade-in` to the blur overlay
5. Sheet entrance: `animate-sheet-slide-up` already exists — verify timing feels right (250ms)
6. Add exit animation: sheet slides down before unmounting
7. Ensure image in detail panel respects mobile aspect ratios (don't crop too aggressively)
8. Navigation strip (prev/next) should be touch-friendly: min 44px tap targets

#### Design Specifications
- Sheet background: match current dark gradient (rgba(17,10,6,0.98))
- Sheet max-height: `88dvh` (already set)
- Drag handle: centered, 4px height, 40px width, 2px border-radius
- Navigation arrows: 44×44px touch targets minimum
- Safe area: bottom padding for iPhone home indicator

#### Success Criteria
- Sheet feels premium on iPhone and Android
- Drag handle is visible and functional
- No content hidden behind safe areas
- Exit animation exists (not just instant unmount)
- All tabs accessible and scrollable on mobile

---

### SP-11 — Keyboard Navigation Audit & Polish
- **Priority**: P2
- **Effort**: 1.5 hours
- **Files**: `expanded-detail.tsx`, `top-filter-bar.tsx`, `gallery-dashboard.tsx`, `app-sidebar.tsx`

#### Problem
Keyboard navigation exists (Escape, ArrowLeft/Right for images, ArrowLeft/Right for tabs) but needs:
- Tab order audit across all interactive elements
- Focus indicator consistency
- Skip link for sidebar → main content

#### Implementation
1. Add skip link: `<a href="#main-content" class="sr-only focus:not-sr-only">Skip to gallery</a>`
2. Audit `tabIndex` values — remove any `tabIndex={-1}` that blocks keyboard access
3. Ensure all pillar tabs, folder tabs, tag buttons, sort options are keyboard-accessible
4. Add `aria-current="page"` to active nav items in sidebar
5. Detail panel: ensure tab focus stays within panel when open (desktop)
6. Verify `Cmd+C` copy shortcut works correctly (only when no text selected)

#### Success Criteria
- User can navigate entire app via keyboard only
- Focus ring (2px coral outline) visible on every focused element
- Skip link works for screen reader users
- No focus traps except modal/sheet overlays

---

### SP-12 — Responsive Breakpoint Audit
- **Priority**: P2
- **Effort**: 1.5 hours
- **Files**: All component files

#### Problem
App designed primarily for desktop; tablet and small desktop need verification.

#### Implementation
1. Test at these breakpoints: 375px (iPhone SE), 390px (iPhone 14), 768px (iPad), 1024px (iPad landscape), 1280px (laptop), 1440px (desktop)
2. Fix issues found at each breakpoint:
   - Filter bar: ensure horizontal scroll works without page scroll blocking
   - Masonry grid: verify column count transitions don't cause layout shift
   - Detail panel: 380px fixed width may be too wide on 1024px screens with sidebar
   - Sidebar: verify collapse trigger at correct breakpoint
3. Add `container` query or breakpoint for detail panel width on smaller desktops
4. Ensure mobile bottom nav doesn't overlap with sheet overlay

#### Success Criteria
- No horizontal overflow at any breakpoint
- No overlapping elements at any breakpoint
- Grid looks good at all column counts
- Detail panel width adjusts for small desktops

---

### SP-13 — Performance: Reduce Re-renders
- **Priority**: P3
- **Effort**: 2 hours
- **Files**: `gallery-dashboard.tsx`, `image-card.tsx`, `masonry-grid.tsx`

#### Problem
- Selecting an image causes `compactColumns` change → entire grid re-renders
- Each image card creates closure for hover handlers (if any remain after SP-01)
- Tag deduplication runs on every query update

#### Implementation
1. Memoize `ImageCard` with `React.memo` + stable prop references
2. Extract the mobile detail sheet into its own component to reduce re-renders in the main tree
3. Use `useDeferredValue` for `compactColumns` to avoid blocking grid render during panel open
4. Verify IntersectionObserver sentinel doesn't cause unnecessary callbacks

#### Success Criteria
- Grid re-renders only affected cards on selection change
- No jank when opening/closing detail panel
- Lighthouse Performance score >= 90

---

## Execution Order

| Priority | Tickets | Total Effort |
|----------|---------|-------------|
| **P0 — Do First** | SP-01 (hover→CSS), SP-02 (shadows), SP-03 (swipe) | ~6 hours |
| **P1 — Core Polish** | SP-04 (tab animation), SP-05 (filter polish), SP-06 (card hover), SP-07 (sidebar), SP-08 (copy feedback) | ~9 hours |
| **P2 — Full Polish** | SP-09 (empty states), SP-10 (mobile sheet), SP-11 (keyboard), SP-12 (breakpoints) | ~7 hours |
| **P3 — Optimize** | SP-13 (re-renders) | ~2 hours |

---

## Verification Checklist

After completing all tickets, verify:

- [ ] `bun run lint` — clean
- [ ] `bun test` — all tests pass
- [ ] Manual: Open gallery → select image → all 3 tabs work → copy prompt → download image → navigate prev/next
- [ ] Manual: Collapse sidebar → tooltips visible → expand sidebar
- [ ] Manual: Switch pillars → accent colors shift everywhere (cards, detail panel, sidebar stats, mobile nav, filter tabs)
- [ ] Manual: Apply filters → "no matches" state with active filter summary + "clear" button
- [ ] Manual: Mobile (375px) → select image → sheet slides up → swipe to dismiss → swipe left/right to navigate
- [ ] Manual: Keyboard only → Tab through all elements → Escape closes panels → Arrow keys navigate images and tabs
- [ ] Manual: All hover states visible and smooth (no flicker, no delay)
- [ ] Visual: No hardcoded inline `style={{ }}` for hover/active states
- [ ] Visual: All shadows use tokens (`--shadow-sm`, `--shadow-md`, `--shadow-lg`)
- [ ] Visual: Typography uses only the 7 defined tiers (micro/xs/sm/base/lg/xl/display)

---

## Files Modified (Expected)

| File | Changes |
|------|---------|
| `app/globals.css` | Shadow tokens, tab-content animation, interactive utility classes, reduced motion updates |
| `components/image-card.tsx` | CSS-only hover states, memo wrapper, elevation tokens |
| `components/expanded-detail.tsx` | Tab animation, copy toast, click-outside for dropdown, keyboard shortcut hints |
| `components/app-sidebar.tsx` | CSS hover states, settings icon, tooltip attrs, show-more styling, collapse animation |
| `components/top-filter-bar.tsx` | CSS hover states, FilterTab/TagButton/ModelChip polish |
| `components/gallery-dashboard.tsx` | Swipe gesture wiring, mobile sheet exit animation, skip link, empty state polish |
| `components/masonry-grid.tsx` | Skeleton crossfade, memo optimization |
| `components/mobile-bottom-nav.tsx` | CSS hover states, pillar theming verification |
| `lib/use-swipe-gesture.ts` | Add touch-move tracking for drag feedback |

---

## Design Quality Gates

Before marking a ticket complete, verify against these gates:

1. **The 3-Second Test**: Look at the component for 3 seconds. Does anything feel "off"? If yes, fix it.
2. **The Squint Test**: Squint at the screen. Can you still tell what's active/selected/hovered? If not, increase contrast.
3. **The Dark Room Test**: Reduce screen brightness to 30%. Is everything still readable?
4. **The Speed Test**: Interact with the element 10 times rapidly. Does it ever flicker, jank, or lag?
5. **The Pillar Test**: Switch to each of the 4 pillars. Does the accent color tint correctly everywhere?

---

## Definition of Done

1. All P0 and P1 tickets complete
2. All verification checklist items pass
3. Zero lint errors, all tests pass
4. Mobile and desktop feel equally polished
5. No inline hover handlers remain (CSS-only)
6. Shadow system implemented and applied consistently
7. Swipe gestures working on mobile detail sheet

---

## Backlog — Future Features

### 🤖 Agent: Image → Prompt Generator
**Added:** 2026-02-27
**Priority:** Backlog
**Description:**
Add functionality where an AI agent looks at an existing image in the gallery and generates a reverse-engineered prompt for it. 

**Use case:** User uploads or views an image with no prompt attached → clicks "Generate Prompt" → agent analyzes the image visually → outputs a production-ready prompt in the gallery's format.

**Acceptance criteria:**
- Works on images with no `promptText` attached
- Agent uses vision model to analyze: subject, style, lighting, composition, color palette, camera specs
- Output is a structured prompt in Nano Banana / image-gen format
- Prompt is saved back to the record (editable before saving)
- UI: "Generate Prompt" button visible on images without a prompt

**Notes:**
- Can use Claude vision or Gemini vision model
- Should follow the cinematic prompt structure from the NB skill (STYLE / SUBJECT / SETTING / LIGHTING / CAMERA / DETAILS)
- Consider: let user choose output format (NB Pro style, NB2 style, Midjourney style)
