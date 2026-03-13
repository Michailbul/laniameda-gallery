# Product Design PRD: Gallery Homepage

Last updated: 2026-03-06
Status: Active (implementation in progress)
Owner: Michael (Product + Design)

---

## 1. Product Identity

**laniameda.gallery** is a personal AI creatorship vault — not a social feed, not a SaaS dashboard, not a stock photo site.

It is a **private creative library** where a single user (Michael) stores, organizes, and retrieves AI-generated imagery and prompts across four content pillars: Creators, Cars, Designs, and Dump.

The homepage is the **gallery view** — the single most important surface in the product. Everything else exists to serve it.

---

## 2. Design Philosophy

### The Feel

The gallery should feel like **walking into a private art studio with a filing cabinet that thinks**.

Not a social media timeline. Not a Dribbble grid. Not an admin panel.

It should feel:
- **Warm** — paper textures, editorial typography, amber light
- **Precise** — every control earns its pixels, nothing decorative
- **Fast** — zero friction between intent and result
- **Quiet** — the images are loud enough; the chrome whispers

### The Metaphor

Think of it as three layers stacked on glass:

```
┌─────────────────────────────────────────────┐
│  Layer 3: Control Instrument (filter island) │  ← floats above
│─────────────────────────────────────────────│
│  Layer 2: Detail Panel (right sidebar)       │  ← slides in on selection
│─────────────────────────────────────────────│
│  Layer 1: Creative Field (masonry grid)      │  ← the hero, always visible
└─────────────────────────────────────────────┘
```

Layer 1 (the masonry grid) is **always the dominant visual element**. Layers 2 and 3 are instruments that float above it, never replacing it.

---

## 3. Homepage Layout Spec

### 3.1 Desktop (1024px+)

```
┌──────┬──────────────────────────────────────────────┬──────────┐
│      │                                              │          │
│  S   │         ┌──────────────────┐                 │  Detail  │
│  I   │         │  Filter Island   │                 │  Panel   │
│  D   │         └──────────────────┘                 │          │
│  E   │         ┌── Tags ──────── ▸│                 │  400–    │
│  B   │                                              │  420px   │
│  A   │  ┌────┐ ┌────┐ ┌──────┐ ┌────┐              │          │
│  R   │  │    │ │    │ │      │ │    │              │ (hidden   │
│      │  │img │ │img │ │ img  │ │img │              │  until    │
│ 48–  │  │    │ │    │ │      │ │    │              │  image    │
│ 200  │  └────┘ │    │ │      │ └────┘              │  select)  │
│  px  │  ┌────┐ └────┘ └──────┘ ┌──────┐            │          │
│      │  │    │ ┌────┐ ┌────┐   │      │            │          │
│      │  │img │ │img │ │img │   │ img  │            │          │
│      │  └────┘ └────┘ └────┘   └──────┘            │          │
│      │                                              │          │
│      │                            ┌───┐             │          │
│      │                            │ + │ ← FAB       │          │
│      │                            └───┘             │          │
└──────┴──────────────────────────────────────────────┴──────────┘
```

**Sidebar** (left):
- Width: 48px collapsed / 200px expanded
- Contains: logo, nav links, model filter, folder filter, vault stats, auth
- Warm paper gradient background, subtle right border
- Collapse button: rounded pill floating on edge

**Filter Island** (top center, floating):
- Sticky `top: 12px`, centered `width: fit-content`
- Glass treatment: 92% opacity, 28px blur, inner white highlight, subtle multi-layer shadow
- Contains: scope toggle (Public/Mine) | pillar tabs (All/Creators/Cars/Designs/Dump) | sort dropdown
- Height: ~36px, **never changes**

**Tag Row** (below island):
- Horizontal scroll, single line, fade gradient at edges
- Tags button with search icon opens inline search input
- Selected tags pinned to front, clear count badge (coral pill)
- Tag chips: 9px mono uppercase, rounded-md, border, active = inverse fill
- **Never wraps to multiple lines** — scrolls horizontally

**Masonry Grid** (main area):
- CSS columns layout: 2–5 columns depending on viewport + detail panel state
- 12px column gap, 12px padding
- Cards: rounded-xl, subtle shadow at rest, pillar-ring shadow on hover
- Skeleton loading: shimmer animation matching pillar tint
- Infinite scroll via intersection observer (24-item batches)

**Detail Panel** (right, on image select):
- Width: 400px (xl: 420px), slides in from right
- Subtle left border, soft inward shadow
- Contains: image preview (rounded-2xl), metadata strip, 4-tab system, copy/download actions
- Tab bar: bottom-border indicator (2px coral line), not full-fill tabs

**Floating Add Button** (bottom right):
- 48x48px, rounded-2xl, coral→warm-accent gradient
- Pillar-aware glow shadow
- Hidden when detail panel is open

### 3.2 Mobile (<768px)

```
┌──────────────────────────┐
│    ┌──────────────┐      │
│    │ Filter Island │      │
│    └──────────────┘      │
│    ┌── Tags ─────── ▸│   │
│                          │
│  ┌──────┐  ┌──────┐     │
│  │      │  │      │     │
│  │ img  │  │ img  │     │
│  │      │  │      │     │
│  └──────┘  │      │     │
│  ┌──────┐  └──────┘     │
│  │      │  ┌──────┐     │
│  │ img  │  │ img  │     │
│  └──────┘  └──────┘     │
│                          │
│ ┌─Home─Search──+──Profile┐│
│ └────────────────────────┘│
└──────────────────────────┘
```

- Filter island: even more compact (8px font, shortened pillar labels)
- Filter sheet: opens from bottom for sort + full tag search
- Detail view: bottom sheet at 88dvh with drag handle
- Bottom nav: 4-item bar (Home, Search, Add, Profile) with safe-area inset
- Masonry: 2 columns, 12px gap

---

## 4. Component Design Specs

### 4.1 Filter Island

The island is a **control instrument**, not a page header.

**Visual Treatment:**
- Background: warm white at 92% opacity over 28px blur
- Inner highlights: 0.5px white ring + 1px top white glow (inset)
- Border: 1px ink at 7% opacity
- Corner radius: 12px
- Shadow: 4px/16px + 1px/3px (two-layer, warm undertone)
- Hover: shadow deepens to 8px/24px (subtle lift)

**Control Groups (separated by 16px vertical dividers):**

1. **Scope Toggle** — segmented control
   - Two buttons: "Public" (bg-inverse when active) / "Mine" (coral when active)
   - Rounded-lg container, 1px border
   - "Mine" disabled with 40% opacity when logged out

2. **Pillar Tabs** — horizontal button group
   - "All" + 4 pillars, horizontally scrollable on overflow
   - Active: coral fill, white text, font-bold
   - Inactive: transparent, ghost text, font-semibold
   - Press feedback: `active:scale-[0.97]`

3. **Sort Dropdown** — minimal trigger
   - Shows current sort label + down caret
   - Opens radix dropdown with 3 options: Featured, Newest, Popular
   - Ghost styling, no border

**Dividers:**
- 1px wide, 16px tall
- Gradient: transparent → ink-12% → transparent (vertical)
- Opacity: 0.8

### 4.2 Tag System

**Desktop Tag Row:**
- Positioned below filter island with 8px gap
- Horizontal scroll with CSS mask fade (transparent → black → transparent) at edges
- No wrapping — always single row

**Tags Button:**
- Leading element in tag row
- Search icon + "TAGS" label in 8px mono
- Click opens inline search input (128px wide)
- Escape or X button closes search

**Clear Badge:**
- Appears when tags are selected
- Coral background, white text, shows count
- X icon + count number

**Tag Chips:**
- 9px mono uppercase, letter-spacing 0.12em
- Inactive: transparent bg, border-default, text-secondary
- Active: bg-inverse, text-inverse, no visible border
- Hover (inactive): surface-2 bg, border-strong
- Press: `active:scale-[0.97]`
- Count suffix: 7px tabular-nums at 40% opacity (70% when active)

**Mobile Tag Row:**
- Same as desktop but more compact (8px font)
- Filter sheet for full tag browsing with search input

### 4.3 Masonry Image Cards

**At Rest:**
- Rounded-xl corners
- Shadow: 2px/8px warm + 1px ring at 4% opacity
- Prompt overlay hidden

**On Hover:**
- Shadow: 8px/28px + 2px/8px + 1px pillar ring at 15% opacity
- Image scales slightly via `group-hover:scale`
- Prompt overlay fades in (bottom gradient + 2-line text)
- Model badge + pillar badge visible (bottom-left)

**Selected:**
- 2px solid pillar ring at 35% opacity
- Elevated shadow with pillar tint
- Full opacity (other cards dim to 50%)

**Dimmed (when another card is selected):**
- 50% opacity
- Hover restores to 85%

**Loading Skeleton:**
- Predefined aspect ratios cycle through variations
- Shimmer: linear gradient sweep matching pillar tint at 4% opacity
- 1.5s infinite linear animation

### 4.4 Detail Panel

**Panel Container:**
- Paper background with very subtle pillar gradient
- Left border: 1px border-subtle
- Shadow: -8px inward, 24px spread, warm at 12% opacity
- Width: 400px default, 420px on xl+

**Image Preview:**
- Rounded-2xl corners
- Shadow: 1px pillar ring at 12% + 8px/24px warm
- Progressive loading: thumbnail → full-res crossfade (500ms)
- Natural aspect ratio

**Metadata Strip:**
- Model badge: rounded-md, pillar-tinted bg at 8%, pillar border at 15%, amber text
- Pillar label: 10px mono uppercase, tertiary color
- Relative date: 10px mono, ghost color

**Tab Bar:**
- 4 tabs: Prompt, Details, Actions, Agent
- Bottom-border indicator style (not full-fill)
- Active: text-primary + 2px coral underline (rounded-full)
- Inactive: text-ghost
- Font: 10px mono semibold uppercase

**Prompt Tab:**
- Left border accent: 3px solid, pillar color at 25%
- 14px display font, italic, line-height 1.75
- Expandable (5-line clamp → full with "Show more")
- Copy dropdown: prompt / URL / full package
- Download button

**Details Tab:**
- Label-value rows: 11px uppercase label → 13px value
- Tags as pillar-tinted rounded chips
- Folder management (select + create)

**Actions Tab:**
- Action buttons with hover inversion (bg-inverse, shadow lift)
- Curation controls (Publish, Featured) for admin users
- Delete with coral destructive styling

**Agent Tab:**
- Centered empty state with pillar-tinted icon container (rounded-2xl)
- "Open Agent" link button

**Toast Notification:**
- Dark inverse background, rounded-xl
- Coral check icon + label
- Strong shadow (8px/24px black at 20%)
- Enter/exit animations (200ms)

### 4.5 Empty States

**No Matches (filters active but no results):**
```
     ┌─────────┐
     │  🔍     │  ← pillar-tinted icon box (48x48, rounded-16)
     └─────────┘
    No matches found        ← 20px display italic
  Try adjusting your        ← 13px text-tertiary, max-width 320px
  filters or search terms.
     ┌─────┐ ┌─────┐       ← active filter chips
     │ cars│ │2 tags│
     └─────┘ └─────┘
   [ Clear all filters ]    ← btn-brutal-outline
```

**Empty Collection (no images at all):**
```
     ┌───────────┐
     │  ┌─────┐  │         ← stacked rotated frames
     │  │  +  │  │            with shadow, rounded-xl
     │  └─────┘  │
     └───────────┘
  Start your collection     ← 36px (mobile) / 48px (desktop)
                               display italic, tracking-tight
  Add your first reference  ← empty-state-description
  image to begin building
  your creative library.

    [ + Add image ]         ← btn-brutal, coral gradient
```

### 4.6 Sidebar

**Header:**
- Logo: 2x2px coral diamond (rotated 45deg) with pillar glow
- Name: 16px display font, "laniameda" regular + "Gallery" italic at 70% opacity
- Collapse: ChevronLeft/Right button at edge

**Navigation:**
- Active: left coral marker bar, filled icon box, bold mono label
- Hover: surface-2 background
- Icons: Lucide, 16px

**Vault Pulse Card (bottom):**
- Subtle VaultCard tone
- "Vault Pulse" in italic display font
- Live indicator: small pillar-tinted dot + "LIVE" label
- 2-column stat grid: Images count + Models count

**Auth Section:**
- Telegram login button when logged out
- User avatar + name when logged in

### 4.7 Mobile Bottom Nav

- Fixed bottom, safe-area-aware padding
- 4 items: Home, Search, Add (+), Profile
- Glass background: pillar-tinted gradient → near-black at 95%
- 24px blur, 180% saturation
- Add button: 44px circle, coral→warm-accent gradient, pillar glow shadow
- Active indicator: 3px amber dot below icon

---

## 5. Color System

All colors are CSS custom properties — no hardcoded values.

### Surfaces
| Token | Value | Use |
|-------|-------|-----|
| `--paper` | `#fffdf9` | Page background |
| `--surface-0` | `#faf6f1` | Body fill |
| `--surface-1` | `#f5f0ea` | Card backgrounds |
| `--surface-2` | `#eee8e0` | Hover fills |
| `--surface-3` | `#e6dfd6` | Selected states |

### Text
| Token | Use |
|-------|-----|
| `--text-primary` | Main text (near-black) |
| `--text-secondary` | Metadata, body |
| `--text-tertiary` | Labels, captions |
| `--text-ghost` | Hints, inactive |
| `--text-inverse` | White-on-dark |

### Accents
| Token | Use |
|-------|-----|
| `--coral` | Primary action (buttons, active states, indicators) |
| `--amber-9` | Pillar fallback accent |
| `--pillar-r/g/b` | Dynamic RGB for pillar tinting |

### Pillar Colors
| Pillar | Accent Direction |
|--------|-----------------|
| Creators | Coral / warm red |
| Cars | Amber / orange |
| Designs | Blue / cool |
| Dump | Neutral gray |

---

## 6. Typography

| Tier | Size | Weight | Font | Use |
|------|------|--------|------|-----|
| display | 32–48px | normal | Georgia italic | Hero text, empty states, Vault Pulse title |
| xl | 24px | normal | System sans | Page headings |
| lg | 18px | medium | System sans | Section headings |
| base | 15px | normal | System sans | Primary content |
| sm | 13px | normal/medium | System sans | Body, buttons, nav |
| xs | 11px | medium | Mono | Badges, timestamps |
| micro | 8–10px | semibold/bold | Mono uppercase | Chips, labels, tracking-wider |

**Rules:**
- Mono uppercase for all controls, labels, chips, badges
- Georgia italic for display/editorial text only
- No font size outside the 7-tier scale
- Letter-spacing: 0.12em–0.2em for uppercase micro text

---

## 7. Animation System

| Animation | Duration | Easing | Use |
|-----------|----------|--------|-----|
| `fade-in` | 200ms | ease-out | General element entry |
| `card-entrance` | 350ms | cubic-bezier | Staggered masonry card reveal (50ms delay per card) |
| `panel-slide-in` | 250ms | cubic-bezier | Detail panel enter |
| `sheet-slide-up` | 250ms | cubic-bezier | Mobile bottom sheet enter |
| `sheet-slide-down` | 200ms | ease-in | Bottom sheet dismiss |
| `tab-content-enter` | 150ms | ease-out | Tab switch content fade |
| `toast-enter` | 200ms | spring | Toast notification in |
| `toast-exit` | 200ms | ease-in | Toast notification out |
| `shimmer` | 1.5s | linear infinite | Skeleton loading pulse |

**Rules:**
- Micro-interactions: 150ms
- Panel transitions: 250ms
- `prefers-reduced-motion`: respect it
- No bouncy/spring animations — quiet confidence
- `active:scale-[0.97]` for press feedback on buttons/chips

---

## 8. Interaction Patterns

### Image Selection Flow
1. Click card → card gets pillar ring, others dim to 50%
2. Detail panel slides in from right (desktop) or bottom sheet (mobile)
3. Arrow keys navigate between images
4. Escape or X closes panel, cards restore to full opacity

### Filter Flow
1. Pillar tabs filter instantly (no loading state needed for fast queries)
2. Tag toggle adds/removes from selected set, results update reactively
3. Tag search narrows visible tags in the row (desktop) or sheet (mobile)
4. Clear badge resets all tags at once
5. Scope switch (Public ↔ Mine) resets all filter state

### Copy Flow
1. Click "Copy" → dropdown with 3 options (Prompt / URL / Package)
2. Selection copies to clipboard
3. Dark toast appears at bottom of panel (2s auto-dismiss)
4. ⌘C copies prompt when panel is focused and no text is selected

---

## 9. Responsive Breakpoints

| Breakpoint | Columns | Sidebar | Detail Panel | Filter Island |
|------------|---------|---------|-------------|---------------|
| <640px | 2 | hidden | bottom sheet | compact (8px font) |
| 640–767px | 2 | hidden | bottom sheet | compact |
| 768–1023px | 2–3 | visible (48px) | bottom sheet | full |
| 1024–1279px | 3–4 | visible | right panel 400px | full |
| 1280–1535px | 4 | visible | right panel 400px | full |
| 1536px+ | 4–5 | visible | right panel 420px | full |

When detail panel is open on desktop, masonry columns reduce by 1.

---

## 10. Success Criteria

The homepage design succeeds when:

1. **Content dominance** — Opening the gallery, 80%+ of visible area is imagery
2. **Control efficiency** — Any filter combination achievable in ≤2 clicks
3. **Visual stability** — Filter interactions cause zero layout shift above the fold
4. **Perceived performance** — Skeleton → content transition feels instant (<200ms perceived)
5. **Brand coherence** — Every pixel feels warm, editorial, and intentional — never generic SaaS
6. **Mobile parity** — Mobile experience is simplified but equally polished, not degraded

---

## 11. Anti-Patterns (What This Is NOT)

- Not a social feed with infinite scroll of equal-height cards
- Not a SaaS dashboard with data tables and charts
- Not a design tool with toolbars and floating menus
- Not a stock photo site with keyword search as primary nav
- Not a portfolio site — this is private-first, not public-first
- No neon glows, no glass morphism, no gradient mesh backgrounds
- No emoji as icons — always Lucide SVG
- No tooltips on every element — trust the user's visual literacy
- No loading spinners — skeletons or nothing
- No modal dialogs for browsing — panels and sheets only

---

## 12. Implementation Status

| Area | Status | Notes |
|------|--------|-------|
| Filter Island (glass, layout) | Done | Refined glass, inner highlights, hover elevation |
| Tag System (search, pinning) | Done | Inline desktop search, selected pinned to front |
| Masonry Grid (shadows, skeletons) | Done | Multi-layer shadows, pillar-aware selection ring |
| Detail Panel (tabs, preview) | Done | Bottom-border tab indicator, rounded-2xl preview |
| Empty States | Done | Editorial styling with icon containers |
| Sidebar | Done | Coral logo diamond, refined Vault Pulse |
| Mobile (island, sheet, nav) | Done | Compact island, filter sheet, gradient bottom nav |
| FAB (floating add) | Done | Gradient button with pillar glow |
| CSS Tokens (shadows, glass) | Done | Refined shadow system, better glass treatment |

---

*This PRD is the visual north star for the gallery homepage. All implementation decisions should be evaluated against it.*
