# 04 — Elevation, Shadows & Depth

## Philosophy

Depth is communicated through a **dual shadow system**: soft diffused shadows for editorial warmth, and sharp offset shadows for brutalist emphasis. The two coexist to create a "warm industrial" feel — like a printed catalogue displayed on a concrete gallery wall.

All shadows use the ink color (`rgba(32, 23, 16, ...)`) as their base, keeping them warm-toned rather than neutral gray.

---

## Shadow Scale (Soft / Editorial)

For standard UI depth — cards, dropdowns, modals.

| Token | Value | Use |
|-------|-------|-----|
| `--shadow-sm` | `0 1px 3px rgba(32,23,16,0.06), 0 1px 2px rgba(32,23,16,0.04)` | Cards at rest, badges, subtle elevation |
| `--shadow-md` | `0 4px 12px rgba(32,23,16,0.08), 0 2px 4px rgba(32,23,16,0.04)` | Hover states, dropdowns, tooltips |
| `--shadow-lg` | `0 12px 40px rgba(32,23,16,0.12), 0 4px 8px rgba(32,23,16,0.06)` | Modals, floating panels, expanded detail |
| `--shadow-sharp` | `0 4px 12px rgba(0,0,0,0.08)` | Image cards at rest (slightly sharper) |
| `--shadow-elevated` | `0 20px 40px -10px rgba(0,0,0,0.12)` | Card hover, elevated floating elements |

### Depth Hierarchy

```
Level 0: Page surface (--surface-0, no shadow)
Level 1: Cards at rest (--shadow-sharp or --shadow-sm)
Level 2: Hovered cards (--shadow-elevated + pillar glow ring)
Level 3: Floating panels, detail sidebar (--shadow-lg)
Level 4: Modals, overlay dialogs (--shadow-lg + backdrop blur)
```

---

## Shadow Scale (Brutalist / Industrial)

Sharp, unblurred offset shadows that create a **stamped/pressed** feel. Inspired by letterpress printing.

| Token | Value | Use |
|-------|-------|-----|
| `--shadow-brutal` | `4px 4px 0 0 var(--ink)` | Primary brutalist buttons on hover, CTA elements |
| `--shadow-brutal-sm` | `2px 2px 0 0 var(--ink)` | Outline button hover, smaller interactive elements |
| `--shadow-brutal-accent` | `4px 4px 0 0 rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.5)` | Primary action hover (pillar-tinted) |

### Brutalist Shadow Interaction Pattern

Brutalist buttons use a **press-and-release** offset pattern:

```
Rest:    transform: translate(0, 0);    box-shadow: none;
Hover:   transform: translate(-2px, -2px); box-shadow: var(--shadow-brutal);
Active:  transform: translate(0, 0);    box-shadow: none;
```

This creates the illusion of a physical button being lifted on hover, then pressed back down on click.

---

## Pillar Glow Shadow

A signature effect: a warm colored glow ring that responds to the active pillar's accent color.

| Token | Value | Use |
|-------|-------|-----|
| `--shadow-pillar-glow` | `0 0 0 1.5px rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.3), 0 0 20px rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.1)` | Selected card state, focus emphasis |

### Card Hover Shadow (Composite)

On hover, image cards combine the elevated shadow with a subtle pillar-tinted ring:

```css
box-shadow:
  var(--shadow-elevated),
  0 0 0 1px rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.18);
```

### Card Selected Shadow (Composite)

```css
box-shadow:
  var(--shadow-pillar-glow),
  0 0 24px rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.18);
```

---

## Glass Surface

A frosted glass effect used for floating elements that need to feel translucent and premium.

```css
.glass-surface {
  background: rgba(255, 250, 245, 0.82);   /* warm-tinted translucent paper */
  backdrop-filter: blur(20px) saturate(120%);
  -webkit-backdrop-filter: blur(20px) saturate(120%);
  border: 1px solid rgba(32, 23, 16, 0.09);
}
```

**Character**: Frosted volcanic glass — warm-toned, not cold blue/gray glass.

---

## Grain Texture

A subtle noise overlay that adds tactile quality to surfaces, evoking printed paper.

```css
.grain-overlay::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.018;
  mix-blend-mode: multiply;
  background-image: url("data:image/svg+xml,...");  /* fractalNoise SVG */
  background-repeat: repeat;
  background-size: 128px 128px;
}
```

**Important**: Extremely subtle (`opacity: 0.018`). Should be barely perceptible — felt more than seen.

---

## Body Background (Pillar-Aware Gradient)

The page background itself has a multi-layer gradient that responds to the active pillar:

```css
body {
  background:
    /* Top-left pillar glow */
    radial-gradient(ellipse 65% 50% at 8% 0%,
      rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.11) 0%, transparent 65%),
    /* Bottom-right warm pillar glow */
    radial-gradient(ellipse 75% 55% at 92% 100%,
      rgba(var(--pillar-warm-r), var(--pillar-warm-g), var(--pillar-warm-b), 0.12) 0%, transparent 65%),
    /* Base warm gradient */
    linear-gradient(180deg, #fffdf9 0%, var(--surface-0) 45%, #fff6ed 100%);
}
```

---

## Mobile Bottom Nav Depth

The mobile bottom navigation uses a dark gradient with heavy blur for depth separation:

```css
background: linear-gradient(180deg,
  rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.06) 0%,
  rgba(8, 4, 2, 0.95) 100%);
backdrop-filter: blur(24px) saturate(180%);
```

---

## Rules

- ❌ No inline `style={{ boxShadow: '...' }}` — use `--shadow-*` tokens
- ❌ No cold/gray shadows — all shadows use warm ink base (`32, 23, 16`)
- ✅ Cards use `card-base` CSS class for hover/selected shadow transitions
- ✅ Brutalist shadows always pair with a matching `translate` offset
- ✅ Glass surfaces always include both `-webkit-` and standard `backdrop-filter`
