# Frontend Implementation Sprint — TODO

Last updated: 2026-02-20
Source: `agent-docs/FRONTEND_DESIGN_PRD.md`

---

## Sprint Philosophy

Execute in visual layers. Each phase produces a visible, testable improvement. No phase depends on backend work that isn't already built. Ship each phase and validate before moving on.

---

## Phase 0: Foundation (Design Tokens + Typography)

Everything else builds on this. Get the visual DNA right first.

- [ ] **0.1** Install and configure fonts
  - Add `Instrument Serif` via `next/font/google`
  - Add `Geist` and `Geist Mono` via `next/font/local` (or `next/font/google` if available)
  - Update `layout.tsx` to apply font CSS variables
  - Remove Manrope/Sora/Inter from font stack in `globals.css`
  - Verify font rendering on dark backgrounds at small sizes (10px–13px)

- [ ] **0.2** Implement new color token system
  - Add surface depth layers (`--surface-0` through `--surface-4`) to `globals.css`
  - Add border spectrum tokens (`--border-subtle`, `--border-default`, `--border-strong`, `--border-accent`)
  - Add text hierarchy tokens (`--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-ghost`)
  - Add accent refinements (`--accent-subtle`, `--accent-glow`)
  - Add warm accent tokens (`--warm-accent`, `--warm-subtle`)
  - Add status tokens (`--status-running`, `--status-success`, `--status-error`, `--status-queued`)
  - Map new tokens to existing shadcn semantic vars (`--background`, `--foreground`, etc.)

- [ ] **0.3** Implement type scale
  - Define `--text-micro` through `--text-3xl` as CSS custom properties
  - Create utility classes or Tailwind extensions for each scale step
  - Document the micro-label pattern (`text-micro`, `uppercase`, `tracking-[0.4em]`, `font-medium`)

- [ ] **0.4** Implement motion tokens
  - Add timing tokens (`--duration-instant` through `--duration-glacial`) to `globals.css`
  - Add easing tokens (`--ease-out`, `--ease-in`, `--ease-spring`)
  - Add `@keyframes` for shimmer, tag-enter, tag-exit, overlay-enter, panel-slide
  - Add `@media (prefers-reduced-motion: reduce)` global rule

**Checkpoint**: Open the app. It should look different — new fonts, refined colors, same layout. No broken components.

---

## Phase 1: Application Shell (Top Bar + Tag Rail)

Replace the current header with the new persistent navigation + tag rail.

- [ ] **1.1** Build new `TopBar` component
  - Logo mark (left), nav links (center), `⌘K` badge + avatar (right)
  - Height: 48px, sticky, `--surface-1` at 85% opacity + `backdrop-blur-lg`
  - Active nav link: `--text-primary` + 2px bottom indicator in `--accent-primary`
  - Inactive: `--text-tertiary`, hover `--text-secondary`
  - Wire up nav links (Gallery / Library / Characters) — Library and Characters can be placeholder pages

- [ ] **1.2** Build `TagRail` component (the core filter UX)
  - Horizontal layout: category dropdowns (left) | divider | active tag pills (right, scrollable)
  - "All" reset button (leftmost)
  - Sticky at `top: 48px`, `--surface-0` background, `--border-subtle` bottom
  - Implement horizontal scroll for active tags zone (mouse wheel + touch drag)

- [ ] **1.3** Build `CategoryDropdown` sub-component
  - Click category label → floating panel appears below
  - Panel shows tag chips in a wrapping grid (max 3 rows visible, scroll if more)
  - Multi-select: clicking a tag toggles it, panel stays open
  - Close on click-outside or Escape
  - Show count badge on category label when tags in that category are active
  - Animate: `translateY(-4px)` + `opacity` → `0, 1`, 150ms

- [ ] **1.4** Build `TagPill` sub-component
  - States: default, hover, active (with `×` remove), animating-in, animating-out
  - Active: `--accent-subtle` bg, `--accent-primary` text, `×` on right
  - Enter animation: `scale(0.8), opacity(0) → 1, 1` with `--ease-spring`
  - Exit animation: `scale(1) → 0.8`, `opacity 1→0`, 100ms

- [ ] **1.5** Wire tag state to URL search params
  - Selected tags → `?tags=portrait,dark,moody` in URL
  - Parse URL on load to restore filter state
  - Gallery query reads from URL params, not just React state
  - Makes filtered views shareable/bookmarkable

- [ ] **1.6** Implement `/` keyboard shortcut for tag rail search
  - Small inline search input appears in the tag rail
  - Filters category dropdowns and suggests matching tags
  - Enter on suggestion activates the tag
  - Escape closes search and restores normal rail

- [ ] **1.7** Remove old `GalleryHeader` and `FilterSidebar` components
  - Delete `components/gallery-header.tsx`
  - Delete `components/filter-sidebar.tsx`
  - Update `GalleryDashboard` to use `TopBar` + `TagRail`
  - Remove all sidebar open/close state

**Checkpoint**: The header and filter experience is completely new. Tags are always visible. Category dropdowns work. URL reflects filter state.

---

## Phase 2: Grid Overhaul (Zero-Gap + Hover Overlays)

Make the grid feel like a professional creative tool.

- [ ] **2.1** Implement zero-gap masonry grid
  - Remove all padding from `MasonryGrid` container (`px-4 pb-8` → `p-0`)
  - Set `columnGap: 0` (already done) and ensure no margins on `ImageCard`
  - Grid touches viewport edges (no page-level horizontal padding in grid area)
  - Column count: 5/4/3/2 based on breakpoints (update from current 5/4/3/2)

- [ ] **2.2** Redesign `ImageCard` hover state
  - Remove current hover scale on the image itself
  - Add hover overlay: gradient from `transparent` to `rgba(0,0,0,0.7)` at bottom
  - Overlay content: 1-line prompt text (truncated) + 3 quick action icons
  - Overlay animation: `translateY(8px), opacity(0) → 0, 1`, 150ms
  - Quick action icons: Transfer Style / Transfer Pose / Replace Character
  - Icon hover: `--text-tertiary` → `--text-primary`
  - Outer hover: subtle `box-shadow: 0 0 0 2px var(--accent-primary)` glow + `scale(1.03)` on image

- [ ] **2.3** Add quick action click handlers on hover overlay
  - Clicking a quick action icon on hover → triggers the aha flow directly (opens character selector popover)
  - This bypasses the detail view for power users — 1 fewer click

- [ ] **2.4** Implement lazy-load entrance animation
  - Images fade in as they enter the viewport: `opacity(0) → 1`, 300ms
  - Use `IntersectionObserver` to trigger
  - First 12 images load eagerly (already implemented via `eager` prop)
  - Stagger first visible row: each image delays by `index * 30ms`

- [ ] **2.5** Implement grid crossfade on filter change
  - When active tags change, outgoing images fade out (100ms)
  - Incoming images stagger fade in (50ms per item)
  - Use `key` prop transitions or `AnimatePresence` equivalent

- [ ] **2.6** Improve skeleton loading
  - 12 skeleton placeholders with varied random heights (200px–400px)
  - Each skeleton: `--surface-1` bg + shimmer animation
  - Stagger shimmer by index for visual flow
  - Replace current skeleton with the new design

**Checkpoint**: Grid feels edge-to-edge cinematic. Hovering images reveals actions. Filtering feels fluid.

---

## Phase 3: Image Detail View (Full-Screen Immersive)

Replace the current modal with a full-screen experience.

- [ ] **3.1** Build new `ImageDetailView` component
  - Full-viewport overlay, `--surface-0` background
  - Image centered, `max-height: 70vh`, aspect ratio preserved
  - Back button (top-left), close button (top-right)
  - Bottom panel with prompt text, tags, metadata, action cards

- [ ] **3.2** Implement progressive image loading
  - Thumbnail (from grid) renders instantly
  - Full-res fades in on top: `opacity(0) → 1`, 500ms
  - No layout shift between thumb and full-res

- [ ] **3.3** Build action cards
  - Three cards: Transfer Style, Transfer Pose, Replace Character
  - `--surface-2` bg, `--border-default` border, `rounded-xl`
  - Hover: border → `--border-accent`, teal glow shadow
  - Arrow icon on right, moves right 4px on hover
  - Click opens character selector popover

- [ ] **3.4** Build secondary action buttons
  - Copy Prompt: copies text, button text → "Copied" with checkmark for 2s
  - Download: downloads full-res image
  - Add to Collection: dropdown with folder selection
  - Ghost button style

- [ ] **3.5** Add keyboard navigation
  - `←` / `→` for prev/next image (navigate gallery while in detail view)
  - `Escape` to close
  - `C` to copy prompt
  - `S` / `P` / `R` for style/pose/replace actions

- [ ] **3.6** Implement view transitions (image expand/contract)
  - Use View Transitions API where supported
  - Clicked image "expands" from its grid position to full-screen
  - On close, image "contracts" back to grid position
  - Fallback: `opacity` + `transform` transition for unsupported browsers

- [ ] **3.7** Add route support (`/image/[id]`)
  - Detail view is a route, not just a modal
  - Direct URL access loads the image detail view
  - Back button returns to gallery with scroll position preserved

**Checkpoint**: Clicking an image in the grid feels like opening a cinematic portal. Keyboard navigation works. View transitions are smooth.

---

## Phase 4: Few-Click Aha Flow

The signature interaction. This is what makes the product magical.

- [ ] **4.1** Build `CharacterSelector` popover
  - Floating popover anchored to action trigger
  - Shows saved character thumbnails as 56px circles
  - Selected state: `--accent-primary` border + `--accent-subtle` glow
  - "Use original" radio option
  - "Add new character" button (dashed border circle)
  - "Generate" primary button at bottom
  - Animation: `scale(0.95) → 1` + `opacity`, 150ms

- [ ] **4.2** Wire quick actions to character selector
  - From grid hover overlay: click action icon → popover appears near the image
  - From detail view: click action card → popover appears near the card
  - Selecting character + clicking "Generate" → triggers AI run

- [ ] **4.3** Redesign AI Workspace Panel
  - Width: 480px (≥1440px), 420px (≥1024px), full-width sheet (smaller)
  - Slide in from right, main content pushes left on large screens
  - Reference card at top (thumbnail + prompt of source image)
  - Status section with step-by-step progress indicators
  - Streaming output in `Geist Mono`
  - Copy Package / Download All buttons at bottom

- [ ] **4.4** Implement streaming UX refinements
  - Blinking teal cursor at end of streaming text
  - Status steps: `○` pending → `●` active (pulsing) → `✓` done (`--status-success`)
  - Error state: red-tinted card with left border + "Retry" button
  - Panel header flashes `--status-success` on completion

- [ ] **4.5** Add workspace panel memory
  - Closing and reopening the panel shows the last run's output
  - State persists in session (React state or sessionStorage)
  - Panel tab/badge shows notification when run completes while panel is closed

**Checkpoint**: The 3-click flow works end-to-end. Power users can go from grid hover → action → character → generate without ever opening the detail view.

---

## Phase 5: Command Palette + Power Features

The power-user layer that makes it feel like Linear/Arc.

- [ ] **5.1** Build `CommandPalette` component
  - `⌘K` to open. Centered overlay, max-width 560px
  - Search input at top, results grouped by category below
  - Categories: Quick Actions, Recent, Navigation
  - Keyboard navigation: arrow keys + enter to select
  - Type to filter results in real-time
  - Animation: `scale(0.98) → 1`, `opacity`, 120ms

- [ ] **5.2** Implement keyboard shortcuts system
  - Global keyboard listener for shortcuts (`⌘K`, `/`, `U`, `G+G`, `G+L`, `G+C`, `?`)
  - Context-aware shortcuts (detail view: `C`, `S`, `P`, `R`, `←`, `→`)
  - Build `KeyboardShortcutHelp` overlay (triggered by `?`)

- [ ] **5.3** Implement right-click context menu on grid images
  - Custom context menu replacing browser default
  - Actions: Transfer Style, Transfer Pose, Replace Character, Copy Prompt, Download, View Details, Edit Tags, Delete
  - `--surface-3` bg, keyboard shortcut hints right-aligned

- [ ] **5.4** Implement toast notification system
  - Bottom-center, slides up from below
  - Success (green check), error (red), info (neutral)
  - Auto-dismiss after 3s, stack if multiple
  - Pill shape, compact

- [ ] **5.5** First-use keyboard hint bar
  - Bottom bar on first visit: "Press ⌘K for quick actions / to search tags ? for all shortcuts"
  - Fades after 10 seconds
  - Store "seen" flag in localStorage, never show again

**Checkpoint**: Power users have a keyboard-driven workflow. Command palette provides instant access to everything.

---

## Phase 6: Upload Experience + Drag & Drop

Refined ingest experience.

- [ ] **6.1** Redesign Upload Modal
  - Centered, max-width 520px
  - Headline: `Instrument Serif` display text
  - Dropzone: dashed `--border-default`, `--surface-1` bg
  - Drag-over state: `--accent-primary` dashed border, `--accent-subtle` bg
  - Sections separated by `─── or ───` dividers
  - Inline tag creation (type + enter → pill appears)
  - Folder selector dropdown with "Create new" option

- [ ] **6.2** Implement full-page dropzone
  - Dragging any file over the page → full-viewport overlay appears
  - Overlay: `--surface-0` at 90% opacity, centered "Drop to add to library" in `Instrument Serif`
  - Teal dashed border around viewport edges, breathing pulse animation
  - Drop → opens upload modal pre-populated with the file

- [ ] **6.3** Add copy-prompt button with confirmation animation
  - On copy: prompt text highlights with teal sweep (left → right, 300ms)
  - Toast confirms "Prompt copied to clipboard"
  - Button text changes to "Copied" with check icon for 2s

**Checkpoint**: Upload feels premium. Drag-and-drop works anywhere. Copy has satisfying feedback.

---

## Phase 7: Empty States + Polish

The details that separate good from unforgettable.

- [ ] **7.1** Design and implement empty states
  - Gallery empty: line-art illustration + "No images yet" headline in `Instrument Serif` + CTA
  - Filtered empty: active tag pills floating/drifting + "Nothing here yet. Try loosening your filters."
  - Characters empty: illustration + "Create your first character" + CTA
  - All empty states vertically centered

- [ ] **7.2** Implement grid page-load sequence
  - Top bar: fade in (0ms)
  - Tag rail: slide down from top (50ms delay)
  - First row of images: stagger from bottom (100ms delay, 30ms per image)
  - Remaining images: natural lazy-load as they enter viewport

- [ ] **7.3** Accessibility pass
  - Audit all interactive elements for focus rings (`:focus-visible` only)
  - Add `aria-label` to all icon buttons
  - Add `role="dialog"` + `aria-labelledby` to modals
  - Add screen reader announcements for filter changes ("Filtered to N images with tags: X, Y, Z")
  - Test keyboard-only navigation flow: top bar → tag rail → grid → detail view → actions
  - Verify `@media (prefers-reduced-motion: reduce)` disables all animations

- [ ] **7.4** Responsive refinements
  - Test at all breakpoints: 1440+, 1024+, 768+, 480+
  - Tag rail → "Filters" button + bottom sheet at ≤480px
  - Top bar → hamburger + logo at ≤480px
  - Workspace panel → full-width sheet at ≤1024px
  - Detail view → full-screen at all sizes (already)

- [ ] **7.5** Performance audit
  - Verify lazy loading works (no full-res images loaded offscreen)
  - Check font loading (no FOUT/FOIT with new fonts)
  - Audit bundle size impact of new components
  - Verify smooth 60fps animations (Chrome DevTools Performance panel)
  - Test grid with 120+ images: no jank on scroll or filter change

**Checkpoint**: The app feels complete, polished, accessible. Every state is designed. Performance is solid.

---

## Phase 8: Library + Characters Pages (Scaffolding)

Placeholder pages to complete the navigation architecture.

- [ ] **8.1** Build Library page (`/library`)
  - Table/list view of all assets
  - Columns: thumbnail, name/prompt, tags, folder, source, date
  - Sortable columns
  - Same tag rail filtering as gallery
  - Basic functionality — full design iteration later

- [ ] **8.2** Build Characters page (`/characters`)
  - Grid of character profile cards
  - Each card: thumbnail, name, description, usage count
  - "Create character" CTA
  - Basic character creation form

- [ ] **8.3** Wire navigation in TopBar
  - Gallery / Library / Characters links navigate to real pages
  - Active state based on current route

**Checkpoint**: Full navigation works. All three main sections exist. The app feels like a complete product.

---

## Phase 9: Color Palette Creator

Dedicated workspace for defining project-level color palettes that constrain AI generation for visual consistency.

- [ ] **9.1** Define Convex schema for palettes
  - Add `palettes` table to schema: `name`, `swatches` (array of swatch objects), `isActive`, `sourceAssetIds`, `userId`, `createdAt`, `updatedAt`
  - Swatch object shape: `id`, `hex`, `name`, `role` (union: background/accent/skin/clothing/lighting/environment/custom), `opacity`, `notes`, `order`
  - Add `by_user` index on `userId`
  - Write queries: `listByUser`, `getById`, `getActive`
  - Write mutations: `create`, `update`, `setActive` (deactivates others), `delete`, `addSwatch`, `updateSwatch`, `removeSwatch`, `reorderSwatches`

- [ ] **9.2** Build Palette List page (`/palettes`)
  - Grid of palette cards (3-col desktop, 2-col tablet, 1-col mobile)
  - Each card: horizontal color bar (swatches flush), name, swatch count, "Active" badge
  - Card hover: `translateY(-2px)` + `--border-default`
  - "+ New Palette" button top-right (primary style)
  - Click card → navigates to `/palettes/[id]` editor
  - Empty state: color wheel icon + "Define your visual language" in Instrument Serif + CTA

- [ ] **9.3** Build Palette Editor page (`/palettes/[id]`)
  - Two-column split layout: swatch editor (left) + palette agent panel (right)
  - Header: back button, palette name (editable inline), "Set Active" toggle button
  - Bottom preview section: 4 recent gallery images with palette color overlay

- [ ] **9.4** Build Swatch Editor (left column)
  - Large swatch grid at top: all colors as rectangles side by side, click to select
  - Swatch list below: color preview (48px), name (editable inline), hex code (Geist Mono, click-to-copy), role tag pill, delete icon (hover-only)
  - "+ Add Color" button: opens color picker popover
  - Color picker: native color input + hex input + eyedropper (if supported)
  - Drag to reorder swatches (changes `order` field)

- [ ] **9.5** Build Palette Agent Panel (right column)
  - Chat-style interface for the dedicated Palette Agent
  - Three starting modes: Extract from images / Build from scratch / Adapt existing
  - Image dropzone (dashed border) for reference images
  - "Generate Palette →" primary button triggers agent run
  - Streaming UX: blinking teal cursor + status steps (same as AI workspace)
  - Agent output renders as interactive swatch proposal cards (accept/modify/skip)

- [ ] **9.6** Build Agent Swatch Proposal Card
  - 40px color swatch + name + hex + role + agent notes
  - Accept: adds swatch to palette with `animate-tag-enter`
  - Modify: opens color picker pre-filled with proposed hex
  - Skip: dismisses card with fade-out
  - `--surface-2` bg, `--border-default` border

- [ ] **9.7** Define Palette Agent (Agent SDK)
  - Separate agent definition with its own system prompt
  - Tools: `analyze_image_colors`, `suggest_harmonious_colors`, `name_color`, `assign_role`, `save_palette`, `update_swatch`
  - Uses vision model for image analysis
  - Runs via Agent SDK worker (same infra as prompt construction agent)

- [ ] **9.8** Wire palette into prompt construction
  - When active palette exists, prompt construction agent receives palette as structured context
  - Agent injects `COLOR PALETTE CONSTRAINT` block into output prompt package
  - Palette colors visible in workspace panel output (highlighted or labeled)

- [ ] **9.9** Update TopBar navigation
  - Add "Palettes" as fourth nav item: Gallery | Library | Characters | Palettes
  - Active state on `/palettes` and `/palettes/[id]` routes

- [ ] **9.10** Keyboard shortcuts (Palette Editor)
  - `N` — add new swatch
  - `Delete` — remove selected swatch
  - `A` — set palette as active
  - `⌘Enter` — trigger agent generation
  - `Escape` — close color picker / back to list

**Checkpoint**: Users can create, manage, and activate color palettes. The palette agent extracts colors from images and suggests harmonious sets. Active palette is injected into every prompt package.

---

## Dependency Map

```
Phase 0 (Foundation)
  ↓
Phase 1 (Shell + Tag Rail)  ───────────────────────────────────┐
  ↓                                                            │
Phase 2 (Grid Overhaul)                                        │
  ↓                                                            │
Phase 3 (Detail View)                                          │
  ↓                                                            │
Phase 4 (Aha Flow)  ←── depends on Phase 3 (detail view) ─────┘
  ↓                     + Phase 1 (tag rail active)
Phase 5 (Command Palette) ── can start after Phase 1
  ↓
Phase 6 (Upload) ── can start after Phase 0
  ↓
Phase 7 (Polish) ── must be last
  ↓
Phase 8 (Library/Characters) ── can start after Phase 1

Phase 9 (Palette Creator)  ── can start after Phase 1
  └── 9.7 (Palette Agent) depends on Convex agent infra
  └── 9.8 (Prompt integration) depends on Phase 4 (Aha Flow)
  └── 9.9 (TopBar nav) depends on Phase 1
```

**Parallelizable work**:
- Phase 5 (Command Palette) can run in parallel with Phase 3/4
- Phase 6 (Upload) can run in parallel with Phase 2/3
- Phase 8 (Library/Characters) can run in parallel with Phase 3/4/5
- Phase 9 (Palette Creator) can run in parallel with Phase 3/4/5 — only 9.8 (prompt integration) must wait for Phase 4

---

## Files to Create (New)

| File | Purpose |
|------|---------|
| `components/top-bar.tsx` | Application top bar |
| `components/tag-rail.tsx` | Horizontal filter tag rail |
| `components/category-dropdown.tsx` | Tag category floating panel |
| `components/tag-pill.tsx` | Reusable tag pill component |
| `components/image-detail-view.tsx` | Full-screen image detail |
| `components/character-selector.tsx` | Character selection popover |
| `components/command-palette.tsx` | `⌘K` command palette |
| `components/context-menu.tsx` | Custom right-click menu |
| `components/toast.tsx` | Toast notification system |
| `components/keyboard-hint.tsx` | First-use keyboard shortcuts bar |
| `app/image/[id]/page.tsx` | Image detail route |
| `app/library/page.tsx` | Library page |
| `app/characters/page.tsx` | Characters page |
| `lib/hooks/use-keyboard-shortcuts.ts` | Global keyboard shortcut system |
| `lib/hooks/use-filter-params.ts` | URL-synced filter state |
| `app/palettes/page.tsx` | Palette list page |
| `app/palettes/[id]/page.tsx` | Palette editor page |
| `components/palette-card.tsx` | Palette card for list view |
| `components/swatch-editor.tsx` | Swatch list + color picker in editor |
| `components/palette-agent-panel.tsx` | Chat panel for dedicated Palette Agent |
| `components/swatch-proposal-card.tsx` | Interactive accept/modify/skip card for agent proposals |
| `convex/palettes.ts` | Convex queries + mutations for palettes table |

## Files to Modify (Existing)

| File | Changes |
|------|---------|
| `app/globals.css` | New tokens, type scale, animation keyframes |
| `app/layout.tsx` | New font configuration, remove old fonts |
| `app/page.tsx` | Update to use new shell components |
| `components/gallery-dashboard.tsx` | Replace header/sidebar with top-bar/tag-rail, wire new interactions |
| `components/masonry-grid.tsx` | Zero-gap layout, entrance animations |
| `components/image-card.tsx` | New hover overlay with quick actions |
| `components/image-modal.tsx` | Replace with `image-detail-view.tsx` (then delete) |
| `components/ai-workspace-panel.tsx` | Redesign with reference card, status steps, streaming cursor |
| `components/upload-panel.tsx` / `upload-modal.tsx` | Redesign with new upload experience |

## Files to Delete

| File | Reason |
|------|--------|
| `components/gallery-header.tsx` | Replaced by `top-bar.tsx` + `tag-rail.tsx` |
| `components/filter-sidebar.tsx` | Replaced by `tag-rail.tsx` + `category-dropdown.tsx` |
| `components/mode-switcher.tsx` | Replaced by top-bar navigation |
| `components/image-modal.tsx` | Replaced by `image-detail-view.tsx` |
