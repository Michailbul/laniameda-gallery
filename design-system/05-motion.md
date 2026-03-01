# 05 — Motion & Animation

## Philosophy

Motion is **restrained and purposeful**. Animations guide attention and confirm interactions — they never entertain or distract. The overall feel is a slow, confident reveal, like turning pages in a premium art book.

**No bouncy, no playful, no attention-grabbing.** Every animation should feel like it could belong in a Tesla or Apple interface — smooth, inevitable, and barely noticed.

---

## Timing Tokens

| Token | Duration | Use |
|-------|----------|-----|
| `--duration-instant` | `80ms` | Micro-interactions: color shifts, border changes, ghost button hover |
| `--duration-fast` | `150ms` | Tab switches, dropdown enter, tag animations, hover transitions |
| `--duration-normal` | `250ms` | Panel open/close, card entrance, toast enter, sheet slide |
| `--duration-slow` | `400ms` | Success flash, card entrance (staggered), emphasis reveals |
| `--duration-glacial` | `600ms` | Reserved for dramatic reveals (rare) |

### Timing Guidelines

- **Hover states**: Always `--duration-instant` (80ms) — snappy, no perceived delay
- **Content transitions**: `--duration-fast` (150ms) — quick but perceptible
- **Layout changes**: `--duration-normal` (250ms) — smooth enough to follow
- **Decorative/ambient**: 3–20 seconds — slow, unobtrusive background motion

---

## Easing Curves

| Token | Value | Character | Use |
|-------|-------|-----------|-----|
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Swift start, gentle landing | **Default for enters** — panels, cards, toasts, sheets |
| `--ease-in` | `cubic-bezier(0.55, 0, 1, 0.45)` | Gentle start, swift exit | **Default for exits** — panel close, toast dismiss, sheet dismiss |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Subtle overshoot | Tag enter animation only — very sparingly used |

### Easing Guidelines

- **Entering elements**: `--ease-out` — elements arrive quickly and settle gently
- **Exiting elements**: `--ease-in` — elements accelerate out of view
- **Ambient motion**: `ease-in-out` — standard CSS keyword for looping decorative effects
- **Pillar transitions**: `ease` — standard CSS for color/background shifts

---

## Animation Utility Classes

All defined in `@layer components` in `globals.css`.

### Entrance Animations

| Class | Keyframe | Duration | Easing | Use |
|-------|----------|----------|--------|-----|
| `.animate-fade-in` | `fade-in` | 300ms | `--ease-out` | General fade-in for any element |
| `.animate-fade-in-up` | `fade-in-up` | `--duration-normal` | `--ease-out` | Fade in + slide up 12px |
| `.animate-card-entrance` | `card-entrance` | 400ms | `--ease-out` | Masonry card staggered entrance (opacity + translateY + scale) |
| `.animate-panel-slide-in` | `panel-slide-in` | `--duration-normal` | `--ease-out` | Detail panel enters from right edge |
| `.animate-sheet-slide-up` | `sheet-slide-up` | `--duration-normal` | `--ease-out` | Mobile bottom sheet enters from bottom |
| `.animate-sidebar-slide-in` | `sidebar-slide-in` | `--duration-normal` | `--ease-out` | Sidebar enters from left |
| `.animate-bottom-nav-slide-up` | `bottom-nav-slide-up` | `--duration-normal` | `--ease-out` | Mobile bottom nav enters |
| `.animate-modal-enter` | `modal-enter` | `--duration-normal` | `--ease-out` | Modal scale-up from 0.96 |
| `.animate-dropdown-enter` | `dropdown-enter` | `--duration-fast` | `--ease-out` | Dropdown slides down 4px |
| `.animate-overlay-enter` | `overlay-enter` | `--duration-fast` | `--ease-out` | Overlay content slides up 8px |
| `.animate-toast-enter` | `toast-enter` | `--duration-normal` | `--ease-out` | Toast notification slides up 16px |
| `.animate-tab-content-enter` | `tab-content-enter` | `--duration-fast` | `--ease-out` | Tab content switch (opacity + translateY 4px) |
| `.animate-tag-enter` | `tag-enter` | 120ms | `--ease-spring` | Tag pill appears (scale 0.8 → 1) |

### Exit Animations

| Class | Keyframe | Duration | Easing | Use |
|-------|----------|----------|--------|-----|
| `.animate-fade-out` | `fade-out` | 200ms | `--ease-in` | General fade-out |
| `.animate-panel-slide-out` | `panel-slide-out` | 200ms | `--ease-in` | Detail panel exits to right |
| `.animate-sheet-slide-down` | `sheet-slide-down` | 200ms | `--ease-in` | Bottom sheet exits downward |
| `.animate-toast-exit` | `toast-exit` | 200ms | `--ease-in` | Toast slides down and fades |
| `.animate-tag-exit` | `tag-exit` | 100ms | `--ease-in` | Tag pill disappears (scale 1 → 0.8) |

### Ambient / Decorative Animations

| Class | Keyframe | Duration | Use |
|-------|----------|----------|-----|
| `.animate-glow-pulse` | `glow-pulse` | 3s infinite | Pillar-tinted pulsing glow on selected cards |
| `.animate-float-gentle` | `float-gentle` | 8s infinite | Gentle floating for decorative elements |
| `.animate-ember-breathe` | `ember-breathe` | 6s infinite | Slow opacity + blur pulse for background embers |
| `.animate-ember-drift` | `ember-drift` | 20s infinite | Slow positional drift for background elements |

### Feedback Animations

| Class | Keyframe | Duration | Use |
|-------|----------|----------|-----|
| `.animate-success-flash` | `success-flash` | `--duration-slow` | Background flash from accent-subtle to transparent |
| `.animate-blink-cursor` | `blink-cursor` | 1s infinite step-end | AI typing indicator cursor blink |

---

## Staggered Card Entrance

Image cards use staggered `animation-delay` based on their index in the grid:

```css
animation-delay: ${index < 12 ? `${index * 30}ms` : "0ms"};
animation-fill-mode: backwards;
```

- First 12 cards get 30ms incremental delays (0ms, 30ms, 60ms, ... 330ms)
- Cards beyond index 12 enter immediately (no delay)
- `animation-fill-mode: backwards` ensures cards are invisible before their delay

---

## CSS Transition Patterns

### Interactive Ghost (Fastest)
```css
transition: background-color var(--duration-instant),
            color var(--duration-instant),
            border-color var(--duration-instant);
```

### Interactive Surface
```css
transition: background-color var(--duration-instant),
            color var(--duration-instant),
            border-color var(--duration-instant),
            box-shadow var(--duration-instant);
```

### Interactive Primary (Brutalist)
```css
transition: background-color var(--duration-instant),
            color var(--duration-instant),
            box-shadow var(--duration-instant),
            transform var(--duration-instant);
```

### Card Base
```css
transition: box-shadow var(--duration-normal) var(--ease-out),
            opacity var(--duration-normal);
```

### Image Hover Zoom
```css
transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
transform: scale(1.03);  /* on group-hover */
```

### Pillar Color Transition
```css
transition: color 300ms ease,
            background-color 300ms ease,
            border-color 300ms ease,
            box-shadow 300ms ease;
```

---

## Shimmer (Loading Skeleton)

```css
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Applied with pillar-tinted gradient */
background: linear-gradient(90deg,
  transparent 0%,
  rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.03) 50%,
  transparent 100%);
background-size: 200% 100%;
animation: shimmer 1.5s infinite linear;
```

---

## Reduced Motion

All animations are disabled for users who prefer reduced motion:

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

---

## Rules

- ❌ No bouncy/springy animations except tag-enter (which uses subtle overshoot)
- ❌ No animations longer than 600ms for UI elements
- ❌ No `transition: all` — always specify individual properties
- ✅ Hover states always use `--duration-instant` (80ms)
- ✅ Enter animations use `--ease-out`, exit animations use `--ease-in`
- ✅ Always include `animation-fill-mode: forwards` (or `backwards` for staggered)
- ✅ Always respect `prefers-reduced-motion`
