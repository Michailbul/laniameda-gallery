# 06 — Component Patterns

## Philosophy

Components follow a **warm brutalist-editorial hybrid**: soft paper surfaces and pill shapes meet industrial monospace labels and sharp offset shadows. Every component uses CSS custom properties for colors — never hardcoded values.

Components use **CVA (class-variance-authority)** for variant management and **Radix UI** primitives for accessibility where needed.

---

## Buttons

### Variants (CVA-based)

| Variant | Fill | Text | Border | Hover | Use |
|---------|------|------|--------|-------|-----|
| **default** | `--primary` (coral) | `--primary-foreground` (white) | Transparent | `primary/90` | Primary CTAs, save, submit |
| **outline** | `--background/40` | `--foreground` | `--border/70` | `--muted` fill | Secondary actions, cancel |
| **secondary** | `--secondary` | `--secondary-foreground` | Transparent | `secondary/80` | Tertiary actions |
| **ghost** | Transparent | Inherited | None | `--muted` fill | Toolbar actions, icon buttons |
| **destructive** | `--destructive/10` | `--destructive` | Transparent | `destructive/20` | Delete, remove |
| **link** | Transparent | `--primary` | None | Underline | Inline text links |

### Sizes

| Size | Height | Padding | Icon Size | Use |
|------|--------|---------|-----------|-----|
| **xs** | 24px (`h-6`) | `px-2` | 12px | Compact toolbars, inline actions |
| **sm** | 28px (`h-7`) | `px-2.5` | 14px | Secondary controls |
| **default** | 32px (`h-8`) | `px-3` | 16px | Standard buttons |
| **lg** | 36px (`h-9`) | `px-4` | 16px | Primary CTAs, prominent actions |
| **icon** | 32×32px | — | 16px | Icon-only buttons |
| **icon-xs** | 24×24px | — | 12px | Compact icon buttons |
| **icon-sm** | 28×28px | — | 14px | Small icon buttons |
| **icon-lg** | 36×36px | — | 16px | Large icon buttons |

### Shape

All buttons use `rounded-full` (pill shape). This is non-negotiable for brand consistency.

### Active State

All interactive buttons: `active:scale-[0.98]` — a micro press-down feedback.

---

## Brutalist Buttons

Custom CSS classes for industrial-styled CTAs, used alongside (not replacing) the CVA button system.

### `.btn-brutal` — Primary Brutalist

```
Rest:   bg: --bg-inverse (#18181b), text: --text-inverse, mono uppercase 11px, tracking 0.12em
Hover:  bg: --coral, border: --coral, text: white, shadow: --shadow-brutal, translate(-2px, -2px)
Active: shadow: none, translate(0, 0)
```

### `.btn-brutal-outline` — Outline Brutalist

```
Rest:   bg: transparent, border: --border-strong, text: --text-primary, mono uppercase 10px
Hover:  bg: --bg-inverse, text: --text-inverse, border: --bg-inverse, shadow: --shadow-brutal-sm, translate(-1px, -1px)
Active: shadow: none, translate(0, 0)
```

### Key Properties

- Font: `var(--font-mono)`, 10–11px, `font-weight: 500`
- Text: `uppercase`, `letter-spacing: 0.12em`
- Padding: `0.625rem 1.25rem` (primary) / `0.5rem 1rem` (outline)
- Transition: `var(--duration-instant)` for all properties

---

## Badges

Pill-shaped status/label indicators. Same CVA variant structure as buttons.

| Variant | Style |
|---------|-------|
| **default** | Coral fill, white text |
| **secondary** | Surface-2 fill, secondary text |
| **destructive** | Destructive/10 fill, destructive text |
| **outline** | Bordered, foreground text |
| **ghost** | Transparent, muted text on hover |

- Shape: `rounded-full`
- Height: `h-6` (24px)
- Font: `text-xs`, `font-medium`
- Icon size: 12px (`[&>svg]:size-3`)

---

## Brutalist Pills

### `.pill-brutal` — Toggle Chip

Small sharp-cornered toggle chips for filters and controls.

```
Rest:   border: --border-default, bg: transparent, text: --text-secondary
        mono 10px uppercase, tracking 0.1em
Hover:  bg: --surface-2, border: --border-strong, text: --text-primary
Active: (`.pill-active`) bg: --bg-inverse, border: --bg-inverse, text: --text-inverse
```

---

## Tag Pills

Interactive rounded tags for filtering content. Pill-shaped (`rounded-full`).

| State | Background | Border | Text Color |
|-------|-----------|--------|------------|
| **Inactive** | Transparent | `--border-default` | `--text-secondary` |
| **Inactive:hover** | `--surface-2` | `--border-strong` | `--text-primary` |
| **Active** | `--accent-subtle` | `rgba(255, 140, 66, 0.35)` | `--amber-9` |
| **Active:hover** | `--accent-glow` | (same) | `--amber-9` |

- Font: 13px, `font-medium`
- Padding: `px-3 py-1`
- Enter animation: `.animate-tag-enter` (scale 0.8 → 1, 120ms spring)
- Removable variant includes an `X` icon (12px) that highlights to `--amber-9` on hover

---

## Image Cards

The primary content element in the masonry grid.

### Structure

```
┌────────────────────────┐
│                        │
│      <Image>           │  ← Aspect ratio from source, object-cover
│      (hover: scale     │
│       1.03)            │
│                        │
│  ┌─────────┬─────────┐ │
│  │ MODEL   │ PILLAR  │ │  ← Bottom-left badges (always visible)
│  └─────────┴─────────┘ │
│                        │
│  ┌────────────────┬──┐ │
│  │ Prompt text... │⤢ │ │  ← Hover overlay (gradient + prompt + expand icon)
│  └────────────────┴──┘ │
└────────────────────────┘
```

### Visual States (via `.card-base`)

| State | Shadow | Opacity |
|-------|--------|---------|
| **Rest** | `--shadow-sharp` | 1.0 |
| **Hover** | `--shadow-elevated` + pillar ring | 1.0 |
| **Selected** | `--shadow-pillar-glow` + extended glow | 1.0 |
| **Dimmed** (unselected when another is selected) | `--shadow-sharp` | 0.55 |
| **Dimmed:hover** | Same | 1.0 (restored) |

### Model Badge

```css
background-color: rgba(0, 0, 0, 0.7);
color: rgba(255, 255, 255, 0.9);
backdrop-filter: blur(8px);
border: 1px solid rgba(255, 255, 255, 0.1);
font: 9px mono uppercase, wider tracking;
```

### Pillar Badge

Same as model badge, but text color matches pillar accent color. Includes a small colored dot indicator (6px circle).

### Hover Overlay

```css
background: linear-gradient(to top,
  rgba(8,4,2,0.92) 0%,
  rgba(17,10,6,0.5) 25%,
  rgba(8,4,2,0.1) 50%,
  transparent 100%);
```

- Prompt: max 2 lines (`-webkit-line-clamp: 2`), 10px mono, white with text-shadow
- Expand icon: 28×28px square, frosted glass background

### Card Entrance

- Class: `.animate-card-entrance`
- Stagger: `index * 30ms` for first 12 cards
- Fill mode: `backwards` (invisible until animation starts)

---

## Detail Panel (Expanded Detail)

A fixed-width side panel for viewing image details.

| Property | Value |
|----------|-------|
| Width | 380px fixed (desktop) |
| Enter | `.animate-panel-slide-in` (from right) |
| Exit | `.animate-panel-slide-out` (to right) |
| Tabs | Prompt (default), Details, Actions |
| Tab transition | `.animate-tab-content-enter` |
| Copy feedback | Toast notification |

---

## Mobile Bottom Sheet

A slide-up panel for mobile detail views and profile/login.

| Property | Value |
|----------|-------|
| Shape | `rounded-t-3xl` |
| Max height | `88dvh` |
| Drag handle | `h-1 w-10 rounded-full`, 30% white opacity |
| Background | Dark gradient (`rgba(17,10,6,0.98)` → `rgba(8,4,2,0.99)`) |
| Safe area | `padding-bottom: env(safe-area-inset-bottom)` |
| Enter | `.animate-sheet-slide-up` |
| Exit | `.animate-sheet-slide-down` |
| Backdrop | `bg-black/55 backdrop-blur-sm` |

---

## Sidebar Navigation

### NavItem

| State | Background | Border | Text | Indicator |
|-------|-----------|--------|------|-----------|
| **Inactive** | Transparent | Transparent | `--text-secondary` | Hidden |
| **Inactive:hover** | `white/42` | Transparent | `--text-primary` | Hidden |
| **Active** | `white/52` | Pillar-tinted (0.3) | `--text-primary` | Coral diamond (7×7px) |

- Icon container: 26×26px, `rounded-[6px]`, bordered
- Active icon container: pillar-tinted background (0.09) + pillar border (0.35)
- Label: mono 11px uppercase, tracking widens from 0.08em → 0.1em when active

### Sidebar Collapse

| State | Width | Content |
|-------|-------|---------|
| Expanded | `--sidebar-width` (240px) | Full nav + labels + categories + stats |
| Collapsed | `--sidebar-collapsed-width` (64px) | Icons only, centered |

Transition: `width var(--duration-normal) cubic-bezier(0.16, 1, 0.3, 1)`

### Expand/Collapse Button

When collapsed, a floating circular button appears at `-right-3 top-[64px]`:
- Size: 24×24px, `rounded-full`
- Background: `--surface-1`, border: `--border-default`
- Hover: `--surface-2` bg, `--border-strong` border

---

## Mobile Bottom Nav

A dark floating navigation bar for mobile viewports.

| Property | Value |
|----------|-------|
| Height | `--mobile-bottom-nav-height` (56px) |
| Background | Dark pillar-tinted gradient + 24px blur |
| Items | Home, Search, Add (FAB), Profile |
| Active indicator | 3px colored dot below icon with pillar glow |
| Add button | 44×44px circle, gradient fill (`--amber-9` → `--warm-accent`), pillar glow shadow |

---

## Interactive Utility Classes

Reusable CSS classes for common interaction patterns:

| Class | Hover Effect | Use |
|-------|-------------|-----|
| `.interactive-ghost` | `--surface-2` bg, `--text-primary` color | Ghost buttons, toolbar items |
| `.interactive-surface` | `--surface-3` bg, `--text-primary` color | Surface-level interactive elements |
| `.interactive-primary` | `--coral-hover` bg, `--shadow-brutal-accent`, translate(-1px, -1px) | Primary action buttons |

---

## Selection Color

Text selection uses pillar-tinted highlight:

```css
::selection {
  background: rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.22);
  color: var(--text-primary);
}
```

---

## Rules

- ❌ No `onMouseEnter`/`onMouseLeave` for hover styling — use CSS classes or Tailwind `hover:` utilities
- ❌ No inline `style={{ boxShadow }}` — use token-based shadow classes
- ❌ No custom border-radius that doesn't match the scale — buttons are always pill, cards are always xl
- ✅ All interactive elements have visible focus states (coral ring, 2px offset)
- ✅ All buttons include `active:scale-[0.98]` press feedback
- ✅ Brutalist elements always pair shadow with transform offset
