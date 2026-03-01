# 01 — Color Palette & Roles

## Philosophy

Colors are drawn from **natural warm materials** — sun-bleached paper, aged ink, terracotta, volcanic ember. Pure white and pure black are never used. Every surface has warmth baked in.

All colors are defined as CSS custom properties in `:root`. **Never hardcode hex/rgba values** in components — always reference tokens.

---

## Core Palette

### Surfaces (Paper Stack)

A 5-tier depth system from lightest background to deepest interactive fill.

| Token | Hex | Description | Use |
|-------|-----|-------------|-----|
| `--paper` | `#fffaf5` | Warm Parchment | Page background, the lightest canvas |
| `--paper-muted` | `#f5eee7` | Aged Linen | Subtle background variation |
| `--surface-0` | `#fffaf5` | = `--paper` | Base surface (alias) |
| `--surface-1` | `#fff4ea` | Sunlit Cream | Sidebar fills, stat panels, secondary areas |
| `--surface-2` | `#f7ede2` | Warm Sand | Card backgrounds, hover fills, muted zones |
| `--surface-3` | `#efe2d4` | Desert Clay | Deeper fills, selected states, scrollbar thumb |
| `--surface-4` | `#e4d4c4` | Weathered Stone | Deepest non-accent surface, heavy emphasis |

### Text Hierarchy (Ink Scale)

| Token | Hex | Description | Use |
|-------|-----|-------------|-----|
| `--ink` | `#201710` | Deep Volcanic Ink | Brand mark, absolute darkest |
| `--text-primary` | `#201710` | = `--ink` | Headlines, body text, primary labels |
| `--text-secondary` | `#4c3a2d` | Aged Walnut | Metadata, secondary labels, descriptions |
| `--text-tertiary` | `#7d6755` | Warm Driftwood | Section labels, tertiary info, counters |
| `--text-ghost` | `#ab9381` | Faded Sandstone | Placeholder text, disabled states, hints |

### Borders

| Token | Value | Description | Use |
|-------|-------|-------------|-----|
| `--border-subtle` | `rgba(32, 23, 16, 0.08)` | Whisper Border | Dividers, section separators |
| `--border-default` | `rgba(32, 23, 16, 0.16)` | Standard Border | Card outlines, input borders, list dividers |
| `--border-strong` | `rgba(32, 23, 16, 0.24)` | Emphasized Border | Hover state borders, active outlines |
| `--border-accent` | `rgba(255, 122, 100, 0.35)` | Coral Accent Border | Active tag pills, selected item borders |

---

## Accent Palette (Amber–Coral Ramp)

The primary accent is a warm coral/amber that evokes volcanic embers. A full 12-step ramp is provided for flexibility.

| Token | Hex | Description |
|-------|-----|-------------|
| `--amber-1` | `#fff7f3` | Barely-there blush tint |
| `--amber-2` | `#ffece4` | Lightest accent background |
| `--amber-3` | `#ffe2d8` | Soft accent wash |
| `--amber-4` | `#ffd6ca` | Light accent fill |
| `--amber-5` | `#ffc9ba` | Medium-light accent |
| `--amber-6` | `#ffbaa9` | Approaching mid-tone |
| `--amber-7` | `#ffa791` | Warm mid-tone |
| `--amber-8` | `#f2977b` | Rich warm tone |
| `--amber-9` | `#ff7a64` | **Primary Accent — Ember Coral** |
| `--amber-10` | `#ff917d` | Hover variant of primary |
| `--amber-11` | `#ffb7a8` | Light text-on-dark accent |
| `--amber-12` | `#ffe0d6` | Lightest accent text |

### Accent Aliases

| Token | Resolves to | Use |
|-------|-------------|-----|
| `--coral` | `--amber-9` (`#ff7a64`) | Primary action color, CTA fills, active indicators |
| `--coral-hover` | `--amber-10` (`#ff917d`) | Hover state for primary actions |
| `--warm-accent` | `#e8614f` | Deeper warm accent for emphasis |
| `--accent-subtle` | `rgba(255, 122, 100, 0.10)` | Active tag background, subtle accent tint |
| `--accent-glow` | `rgba(255, 122, 100, 0.18)` | Glow effect around accent elements |
| `--warm-subtle` | `rgba(232, 97, 79, 0.12)` | Warm accent tint for backgrounds |

---

## Semantic Mappings (shadcn-compatible)

These map design tokens to the semantic slots used by component variants.

| Semantic Token | Resolves to | Purpose |
|----------------|-------------|---------|
| `--background` | `--surface-0` | Page background |
| `--foreground` | `--text-primary` | Default text color |
| `--card` | `--paper` | Card surface |
| `--card-foreground` | `--text-primary` | Card text |
| `--popover` | `#fffaf7` | Popover/dropdown surface |
| `--popover-foreground` | `--text-primary` | Popover text |
| `--primary` | `--coral` | Primary action fills |
| `--primary-foreground` | `#ffffff` | Text on primary fills |
| `--secondary` | `--surface-2` | Secondary fills |
| `--secondary-foreground` | `--text-secondary` | Text on secondary fills |
| `--muted` | `--surface-2` | Muted backgrounds |
| `--muted-foreground` | `--text-secondary` | Muted text |
| `--accent` | `--surface-3` | Accent backgrounds |
| `--accent-foreground` | `--text-primary` | Accent text |
| `--destructive` | `oklch(0.62 0.2 27)` | Error/danger fills |
| `--destructive-foreground` | `oklch(0.98 0 0)` | Text on destructive |
| `--border` | `--border-default` | Default borders |
| `--input` | `#ffffff` | Input field background |
| `--ring` | `--coral` | Focus ring color |

### Sidebar-specific Tokens

| Token | Value | Purpose |
|-------|-------|---------|
| `--sidebar` | `--paper` | Sidebar background |
| `--sidebar-foreground` | `--text-primary` | Sidebar text |
| `--sidebar-primary` | `--coral` | Sidebar active accent |
| `--sidebar-primary-foreground` | `#ffffff` | Text on sidebar accent |
| `--sidebar-accent` | `--surface-2` | Sidebar hover fills |
| `--sidebar-accent-foreground` | `--text-secondary` | Sidebar muted text |
| `--sidebar-border` | `--border-default` | Sidebar borders |
| `--sidebar-ring` | `--coral` | Sidebar focus rings |

---

## Status Colors

| Token | Value | Use |
|-------|-------|-----|
| `--status-running` | `--coral` | Active/in-progress indicators |
| `--status-success` | `#16a34a` | Success states, completion |
| `--status-error` | `#dc2626` | Error states, failures |
| `--status-queued` | `--text-tertiary` | Pending/queued states |

### Chart Colors

| Token | Value |
|-------|-------|
| `--chart-1` | `--coral` |
| `--chart-2` | `--amber-8` |
| `--chart-3` | `#6d7bff` (cool indigo) |
| `--chart-4` | `#3db7b0` (teal) |
| `--chart-5` | `#d55b53` (deep red) |

---

## Inverse / Dark Panels

For occasional dark UI elements (brutalist buttons, mobile bottom nav overlays):

| Token | Value | Use |
|-------|-------|-----|
| `--bg-inverse` | `#18181b` | Dark panel backgrounds, brutalist button fills |
| `--text-inverse` | `#fafafa` | Text on dark panels |

---

## Pillar Theming

The gallery organizes content into 4 **pillars**, each with its own accent color that dynamically overrides the amber ramp via CSS `[data-pillar]` attribute selectors.

### Pillar Accent Map

| Pillar | Accent Name | `--amber-9` | `--pillar-r,g,b` | Emotional Quality |
|--------|-------------|-------------|-------------------|-------------------|
| **creators** | Ember Coral | `#ff7a64` | `255, 122, 100` | Warm, editorial, fashion-forward |
| **cars** | Crimson Heat | `#e5534b` | `232, 84, 74` | Speed, fire, mechanical energy |
| **designs** | Electric Indigo | `#5d6bfa` | `93, 107, 250` | Clean, digital, UI precision |
| **dump** | Teal Catch-all | `#2eb8b4` | `46, 184, 180` | Neutral, cool, relaxed utility |

### How Pillar Theming Works

1. A `data-pillar` attribute is set on a parent element (typically `<html>` or a layout wrapper)
2. CSS `[data-pillar="cars"]` selectors override `--amber-*`, `--coral`, `--pillar-r/g/b`, `--accent-*`, and `--warm-accent`
3. All interactive elements automatically pick up the new accent via existing token references
4. Transitions between pillars use `transition: color 300ms ease, background-color 300ms ease, border-color 300ms ease, box-shadow 300ms ease`

### Dynamic Pillar Usage in CSS

Components reference pillar colors via the RGB triplet tokens:

```css
/* Tinted background */
background: rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.12);

/* Tinted border */
border-color: rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.3);

/* Glow shadow */
box-shadow: 0 0 20px rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.1);

/* Body background gradient (pillar-aware) */
background:
  radial-gradient(ellipse 65% 50% at 8% 0%, rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.11) 0%, transparent 65%),
  radial-gradient(ellipse 75% 55% at 92% 100%, rgba(var(--pillar-warm-r), var(--pillar-warm-g), var(--pillar-warm-b), 0.12) 0%, transparent 65%),
  linear-gradient(180deg, #fffdf9 0%, var(--surface-0) 45%, #fff6ed 100%);
```

### Pillar Warm Variants

Each pillar also has a "warm" RGB variant for secondary gradients:

| Pillar | `--pillar-warm-r,g,b` |
|--------|-----------------------|
| creators | `232, 97, 79` |
| cars | `200, 66, 59` |
| designs | `75, 88, 232` |
| dump | `37, 163, 159` |

---

## Rules

- ❌ **Never hardcode** `rgba(...)` color strings in components — always use token references
- ❌ **Never use pure white** (`#ffffff`) as a background — use `--paper` or `--surface-*`
- ❌ **Never use pure black** (`#000000`) for text — use `--ink` or `--text-*`
- ✅ **Always verify** pillar theming works after UI changes by switching through all 4 pillars
- ✅ **Always use** semantic tokens (`--primary`, `--muted`, etc.) in component variants for shadcn compatibility
