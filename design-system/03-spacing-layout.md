# 03 — Spacing, Layout & Dimensions

## Spacing Philosophy

Spacing uses a **4px base unit** (`--spacing: 0.25rem`). All spacing values are multiples of this base, creating a consistent rhythm across all surfaces. The editorial aesthetic demands generous whitespace — never cram elements together.

---

## Spacing Scale

Tailwind spacing utilities map to these values:

| Token | Value | Pixels | Common Use |
|-------|-------|--------|-----------|
| `0.5` | `0.125rem` | 2px | Micro gaps, indicator offsets |
| `1` | `0.25rem` | 4px | Tightest content gaps |
| `1.5` | `0.375rem` | 6px | Badge padding, tag inner gaps |
| `2` | `0.5rem` | 8px | Button padding, card inner padding |
| `2.5` | `0.625rem` | 10px | Button horizontal padding |
| `3` | `0.75rem` | 12px | Card padding, section gaps, masonry gutter |
| `4` | `1rem` | 16px | Standard section padding |
| `5` | `1.25rem` | 20px | Button horizontal padding (lg) |
| `6` | `1.5rem` | 24px | Section vertical spacing |
| `8` | `2rem` | 32px | Major section gaps |
| `10` | `2.5rem` | 40px | Large vertical spacing |
| `12` | `3rem` | 48px | Page-level vertical rhythm |
| `16` | `4rem` | 64px | Major layout gaps |
| `20` | `5rem` | 80px | Hero section padding |
| `24` | `6rem` | 96px | Maximum spacing token |

---

## Border Radius Scale

Generous rounding is a signature of the warm editorial aesthetic. The base radius is `1.25rem` (20px).

| Token | Value | Pixels | Description | Use |
|-------|-------|--------|-------------|-----|
| `--radius-sm` | `calc(var(--radius) - 4px)` | ~16px | Gently rounded | Input fields, small cards |
| `--radius-md` | `calc(var(--radius) - 2px)` | ~18px | Standard rounded | Buttons, badges |
| `--radius-lg` | `var(--radius)` | 20px | Base radius | Cards, containers |
| `--radius-xl` | `calc(var(--radius) + 4px)` | 24px | Generously rounded | Modals, large panels |
| `--radius-2xl` | `calc(var(--radius) + 8px)` | 28px | Very rounded | Bottom sheets |
| `--radius-3xl` | `calc(var(--radius) + 12px)` | 32px | Nearly pill-shaped | Mobile bottom sheet (`rounded-t-3xl`) |
| `--radius-4xl` | `calc(var(--radius) + 16px)` | 36px | Maximum rounding | Special cases |
| `full` | `9999px` | — | Pill-shaped | Buttons, badges, avatars, tag pills |

### Component-Specific Radii

| Component | Radius | Notes |
|-----------|--------|-------|
| Buttons (default) | `rounded-full` (pill) | All button variants use pill shape |
| Badges | `rounded-full` (pill) | Consistent with buttons |
| Image cards | `rounded-xl` (~24px) | Generous rounding on masonry cards |
| Tag pills | `rounded-full` (pill) | Pill-shaped interactive tags |
| Nav items | `rounded-[6px]` | Subtle square-ish rounding |
| Checkboxes | `rounded-[2px]` | Nearly square, brutalist feel |
| Sidebar | No rounding | Full-height flush against edge |
| Mobile bottom sheet | `rounded-t-3xl` | Rounded top corners only |
| Drag handle | `rounded-full` | 4px × 40px capsule |
| Scrollbar thumb | `4px` | Subtle rounding |

---

## Layout Dimensions

### Fixed Dimensions

| Token | Value | Use |
|-------|-------|-----|
| `--sidebar-width` | `240px` | Desktop sidebar expanded width |
| `--sidebar-collapsed-width` | `64px` | Desktop sidebar collapsed width |
| `--mobile-bottom-nav-height` | `56px` | Mobile bottom navigation bar height |

### Detail Panel

| Property | Value |
|----------|-------|
| Width | `380px` fixed on desktop |
| Animation | Slides in from right (`panel-slide-in`) |

### Sidebar Header

| Property | Value |
|----------|-------|
| Height | `52px` |
| Padding | `0 12px` |

---

## Grid & Layout Patterns

### Masonry Grid

The primary content layout is a **CSS multi-column masonry grid**:

| Breakpoint | Columns | Gutter |
|------------|---------|--------|
| `< 640px` | 2 columns | 12px |
| `640–1024px` | 3 columns | 12px |
| `1024–1280px` | 4 columns | 12px |
| `> 1280px` | 5 columns | 12px |

Cards within the masonry use `break-inside: avoid-column` and a fixed `margin-bottom: 12px`.

**Important**: No CSS transforms (translateY, scale) on column items — they break multi-column distribution. Hover effects use `box-shadow` and `opacity` only.

### Sidebar + Content Layout

```
┌──────────┬───────────────────────────────┐
│          │                               │
│ Sidebar  │         Main Content          │
│  240px   │    (margin-left: sidebar)     │
│          │                               │
│          │                               │
└──────────┴───────────────────────────────┘
```

- Desktop: Fixed sidebar, content uses `margin-left` offset
- Mobile (`< 768px`): No sidebar, full-width content, bottom nav instead

### Content Area Padding

| Context | Padding |
|---------|---------|
| Desktop main | `px-4` to `px-6` |
| Mobile main | `px-3` |
| Sidebar sections | `px-2` to `px-3` |
| Card internal padding | `p-3` |

---

## Responsive Breakpoints

| Breakpoint | Width | Layout Changes |
|------------|-------|----------------|
| **Mobile** | `< 640px` | 2-col masonry, bottom nav, no sidebar |
| **Tablet** | `640–767px` | 3-col masonry, bottom nav, no sidebar |
| **Desktop** | `768px+` | Sidebar visible, top filter bar |
| **Wide** | `1024px+` | 4-col masonry |
| **Ultra-wide** | `1280px+` | 5-col masonry |

### Mobile-specific

- Sidebar offset zeroed: `.md-sidebar-offset { margin-left: 0 !important; }`
- Bottom sheet max height: `88dvh`
- Safe area inset: `padding-bottom: env(safe-area-inset-bottom)`

---

## Rules

- ❌ No spacing values outside the scale — use Tailwind tokens
- ❌ No CSS transforms on masonry column items
- ✅ Always use generous whitespace — editorial layouts breathe
- ✅ Mobile layouts always account for `safe-area-inset-bottom`
- ✅ Sidebar transition uses `--duration-normal` with `--ease-out` curve
