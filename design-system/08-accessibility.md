# 08 — Accessibility

## Philosophy

Accessibility is built into the design system at the token level, not bolted on afterward. Every interactive element has a visible focus state, every animation respects user preferences, and color contrast meets WCAG standards against the warm paper surfaces.

---

## Focus States

All focusable elements use a consistent coral focus ring:

```css
:focus-visible {
  outline: 2px solid var(--coral);
  outline-offset: 2px;
}
```

- **Color**: `--coral` (`#ff7a64`) — the primary accent, ensuring focus rings are always visible on paper backgrounds
- **Width**: 2px — thick enough to see clearly
- **Offset**: 2px — creates breathing room between element and ring
- **Trigger**: `:focus-visible` only — no focus ring on mouse click, only keyboard navigation

### Component-Specific Focus

- **Buttons**: Ring color from `--ring` token (coral), with `ring-ring/50` opacity variant for secondary focus
- **Inputs**: Border highlight via `focus-visible:border-ring`
- **Invalid states**: `aria-invalid:ring-destructive/20` and `aria-invalid:border-destructive`

---

## Reduced Motion

All animations and transitions are disabled for users who prefer reduced motion:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

This is a global rule that applies to **all** elements. Individual components don't need to handle this themselves.

---

## Color Contrast

### Text on Paper Backgrounds

| Pair | Foreground | Background | Approx Ratio | WCAG |
|------|-----------|------------|-------------|------|
| Primary text on paper | `#201710` | `#fffaf5` | ~16:1 | AAA ✅ |
| Secondary text on paper | `#4c3a2d` | `#fffaf5` | ~8:1 | AAA ✅ |
| Tertiary text on paper | `#7d6755` | `#fffaf5` | ~4.5:1 | AA ✅ |
| Ghost text on paper | `#ab9381` | `#fffaf5` | ~3:1 | AA Large ⚠️ |
| Coral on paper | `#ff7a64` | `#fffaf5` | ~3.2:1 | AA Large ⚠️ |
| White on coral | `#ffffff` | `#ff7a64` | ~3.1:1 | AA Large ⚠️ |

### Notes on Contrast

- `--text-ghost` is intentionally low contrast — used only for placeholder/hint text, never for essential information
- Coral accent on white backgrounds meets AA for large text (18px+) — fine for buttons and badges
- All essential text (body, labels, navigation) meets WCAG AA or better
- On dark surfaces (bottom nav, hover overlays), white text at 0.85+ opacity provides sufficient contrast

---

## Keyboard Navigation

### Tab Order

Components maintain logical tab order through semantic HTML:
- Sidebar nav items are `<Link>` or `<button>` elements
- Cards are `<div>` with `onClick` — consider adding `tabIndex={0}` and `onKeyDown` for keyboard users
- Modal/sheet close buttons are always accessible via keyboard

### ARIA Attributes

- `aria-label` on icon-only buttons (collapse sidebar, close panel, mobile add button)
- `aria-hidden="true"` on decorative backdrop overlays
- `data-slot="button"` / `data-slot="badge"` for component identification
- `data-variant` and `data-size` for variant state tracking

---

## Custom Scrollbar

A minimal custom scrollbar that doesn't distract from content:

```css
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--surface-3); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--coral); }
```

- Width: 4px — ultra-thin, nearly invisible at rest
- Track: Transparent — doesn't add visual weight
- Thumb: `--surface-3` at rest, `--coral` on hover — subtle but discoverable
- Only styled in WebKit browsers — Firefox/others get native scrollbar

---

## Text Selection

Selection color is pillar-aware, providing brand-consistent highlighting:

```css
::selection {
  background: rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.22);
  color: var(--text-primary);
}
```

---

## Touch Targets

- Minimum touch target: 44×44px for mobile (the Add FAB button is exactly `h-11 w-11`)
- Mobile nav items: Full `px-3 py-1` padding around icons
- Bottom sheet drag handle: Full-width hit area despite visual 40px handle
- Safe area inset: `env(safe-area-inset-bottom)` on mobile nav and sheets

---

## Interactive State Visibility

All interactive elements have clear visual distinction between states:

| State | Visual Indicator |
|-------|-----------------|
| **Default** | Standard styling |
| **Hover** | Background color change, border emphasis, or shadow lift |
| **Active/Pressed** | `scale(0.98)` press-down, shadow removed |
| **Focus** | Coral outline ring (2px, 2px offset) |
| **Selected** | Pillar glow shadow, full opacity (others dim) |
| **Disabled** | `opacity: 0.5`, `pointer-events: none` |

---

## Rules

- ✅ Every interactive element must have a visible `:focus-visible` state
- ✅ Every icon-only button must have `aria-label`
- ✅ All animations must be covered by `prefers-reduced-motion`
- ✅ Essential text must meet WCAG AA contrast (4.5:1 for normal, 3:1 for large)
- ✅ Mobile touch targets must be at least 44×44px
- ❌ Never remove focus outlines without providing an alternative
- ❌ Never convey information through color alone — always pair with text or icon
