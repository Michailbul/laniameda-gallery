# Design System

Last updated: 2026-03-01

> ⚠️ **Note:** An older version of this doc described a dark teal/monochrome theme. That was the original direction.
> The **current implementation** uses a **warm paper light theme**. Follow this doc.

---

## Theme Identity

- **Mode**: Light only (warm paper aesthetic)
- **Audience**: Creative professionals — visually literate, content-first
- **Tone**: Warm editorial, studio console — quiet confidence, not SaaS
- **Palette**: Warm whites (`--paper`), ink blacks (`--ink`), coral/amber accents (`--coral`, `--amber-9`)
- **Shape**: Rounded cards, soft geometry, no sharp edges

---

## Design Principles

1. **Content is hero** — images dominate; chrome recedes
2. **Warm editorial** — paper backgrounds, ink text, serif display accents (Georgia italic for display text)
3. **Pillar-aware** — accent color shifts with active pillar using `rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), ...)`
4. **Quiet confidence** — no loud hover effects, no neon glows, no bouncy animations
5. **CSS-first** — Tailwind `hover:` / `active:` / `focus:` over JS `onMouseEnter` handlers
6. **Progressive disclosure** — essential info first, details on demand

---

## CSS Variables (Source of Truth)

Defined in `app/globals.css`. Key tokens:

### Surface & Text
| Token | Use |
|-------|-----|
| `--paper` | Page background (warm off-white) |
| `--ink` | Primary text (near-black) |
| `--text-primary` | Main body text |
| `--text-secondary` | Metadata, captions |
| `--surface-2` | Card backgrounds, hover fills |
| `--surface-3` | Deeper fills, selected states |
| `--border-default` | Dividers, card outlines |

### Accents
| Token | Use |
|-------|-----|
| `--coral` | Primary action color (warm red-orange) |
| `--amber-9` | Pillar accent fallback |
| `--pillar-r/g/b` | Dynamic pillar RGB values for tinting |

### Timing
| Token | Use |
|-------|-----|
| `--duration-fast` | 150ms — tab/hover transitions |
| `--duration-normal` | 250ms — panel open/close |

### Elevation (Shadow system)
| Token | Use |
|-------|-----|
| `--shadow-sm` | Cards at rest, badges |
| `--shadow-md` | Hover states, dropdowns |
| `--shadow-lg` | Modals, floating panels |
| `--shadow-pillar-glow` | Pillar-tinted card glow on hover |

---

## Typography Scale

Use **only** these tiers — no hardcoded `px` sizes:

| Tier | Size | Use |
|------|------|-----|
| `micro` | 10px | Section labels, uppercase mono |
| `xs` | 11px | Badges, timestamps, metadata |
| `sm` | 13px | Body text, button labels, nav |
| `base` | 15px | Primary content text |
| `lg` | 18px | Section headings |
| `xl` | 24px | Page headings |
| `display` | 32–48px | Hero text, empty states (Georgia italic) |

---

## Animation Classes

Defined in `app/globals.css`:

| Class | Use |
|-------|-----|
| `animate-fade-in` | General fade-in |
| `animate-panel-slide-in` | Side panel enter |
| `animate-card-entrance` | Masonry card stagger |
| `animate-sheet-slide-up` | Mobile bottom sheet enter |
| `animate-toast-enter/exit` | Copy feedback toast |
| `animate-tab-content-enter` | Tab content switch |

---

## Component Rules

### Buttons
- Primary: `--coral` fill, white text, `--shadow-sm`
- Ghost: transparent → `--surface-2` on hover, `transition-colors`
- Active state: `active:scale-[0.98]`
- No inline `onMouseEnter` handlers — use Tailwind `hover:` classes

### Cards (ImageCard)
- Hover lift: `translateY(-4px) scale(1.01)` over 250ms
- Hover shadow: `--shadow-lg` + pillar glow ring
- Prompt overlay: max 2 lines, CSS `text-shadow` for readability
- Selection dimming: unselected cards `opacity: 0.65` via parent `data-has-selection` attribute

### Detail Panel (ExpandedDetail)
- 3 tabs: Prompt (default), Details, Actions
- Tab switch uses `animate-tab-content-enter`
- Copy feedback: toast notification (not just button color change)
- Width: 380px fixed on desktop

### Mobile Bottom Sheet
- `rounded-t-3xl`, `88dvh` max
- Drag handle: 4px × 40px rounded capsule
- `padding-bottom: env(safe-area-inset-bottom)`
- Exit animation: slide down before unmount

### Sidebar
- NavItem active: left coral marker + filled icon box + bold mono label
- NavItem hover: `rgba(255,255,255,0.42)` background via CSS
- Collapse animation: content fades, then sidebar narrows

---

## Pillar Theming

Each of the 3 pillars sets CSS vars on the root:

| Pillar | Accent |
|--------|--------|
| `creators` | Coral / warm red |
| `designs` | Blue / cool |
| `dump` | Neutral gray |

Interactive elements use `rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.12)` for tinted backgrounds and borders. Verify pillar theming works after every UI change by switching all 3 pillars.

---

## Tech Stack

- **Tailwind CSS v4** — utility classes + token system
- **CSS variables** — design tokens in `:root` (no hardcoding)
- **No shadcn/ui** in active use — custom components only
- **Lucide React** — icons
- **Georgia italic** — display/hero text accent

---

## What NOT to Do

- ❌ No hardcoded `rgba(...)` color strings — use tokens
- ❌ No `onMouseEnter`/`onMouseLeave` for hover styling — use CSS
- ❌ No inline `style={{ boxShadow: '...' }}` — use `--shadow-*` tokens
- ❌ No font sizes outside the 7-tier scale
- ❌ No `px` values for color opacity — use CSS vars
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --spacing: 0.25rem;
  --font-sans: var(--font-geist-sans), system-ui, -apple-system, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, monospace;
  --font-display: var(--font-display), Georgia, "Times New Roman", serif;
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);

  /* Surface depth tokens */
  --color-surface-0: var(--surface-0);
  --color-surface-1: var(--surface-1);
  --color-surface-2: var(--surface-2);
  --color-surface-3: var(--surface-3);
  --color-surface-4: var(--surface-4);

  /* Text hierarchy tokens */
  --color-text-primary: var(--text-primary);
  --color-text-secondary: var(--text-secondary);
  --color-text-tertiary: var(--text-tertiary);
  --color-text-ghost: var(--text-ghost);

  /* Accent tokens */
  --color-accent-subtle: var(--accent-subtle);
  --color-accent-glow: var(--accent-glow);
  --color-warm-accent: var(--warm-accent);
  --color-warm-subtle: var(--warm-subtle);

  /* Status tokens */
  --color-status-running: var(--status-running);
  --color-status-success: var(--status-success);
  --color-status-error: var(--status-error);
  --color-status-queued: var(--status-queued);

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --radius-2xl: calc(var(--radius) + 8px);
  --radius-3xl: calc(var(--radius) + 12px);
  --radius-4xl: calc(var(--radius) + 16px);
}

:root {
  --paper: #fffaf5;
  --paper-muted: #f5eee7;
  --ink: #201710;

  --surface-0: var(--paper);
  --surface-1: #fff4ea;
  --surface-2: #f7ede2;
  --surface-3: #efe2d4;
  --surface-4: #e4d4c4;

  --border-subtle: rgba(32, 23, 16, 0.08);
  --border-default: rgba(32, 23, 16, 0.16);
  --border-strong: rgba(32, 23, 16, 0.24);
  --border-accent: rgba(255, 122, 100, 0.35);

  --text-primary: #201710;
  --text-secondary: #4c3a2d;
  --text-tertiary: #7d6755;
  --text-ghost: #ab9381;

  --amber-1: #fff7f3;
  --amber-2: #ffece4;
  --amber-3: #ffe2d8;
  --amber-4: #ffd6ca;
  --amber-5: #ffc9ba;
  --amber-6: #ffbaa9;
  --amber-7: #ffa791;
  --amber-8: #f2977b;
  --amber-9: #ff7a64;
  --amber-10: #ff917d;
  --amber-11: #ffb7a8;
  --amber-12: #ffe0d6;
  --amber-contrast: #ffffff;
  --amber-surface: rgba(255, 122, 100, 0.12);
  --amber-indicator: var(--amber-9);
  --amber-track: var(--amber-9);
  --amber-subtle: rgba(255, 122, 100, 0.10);
  --amber-glow: rgba(255, 122, 100, 0.18);

  --coral: var(--amber-9);
  --coral-hover: var(--amber-10);
  --accent-subtle: rgba(255, 122, 100, 0.10);
  --accent-glow: rgba(255, 122, 100, 0.18);
  --warm-accent: #e8614f;
  --warm-subtle: rgba(232, 97, 79, 0.12);

  --pillar-r: 255;
  --pillar-g: 122;
  --pillar-b: 100;
  --pillar-warm-r: 232;
  --pillar-warm-g: 97;
  --pillar-warm-b: 79;

  --status-running: var(--coral);
  --status-success: #16a34a;
  --status-error: #dc2626;
  --status-queued: var(--text-tertiary);

  --background: var(--surface-0);
  --foreground: var(--text-primary);
  --card: var(--paper);
  --card-foreground: var(--text-primary);
  --popover: #fffaf7;
  --popover-foreground: var(--text-primary);
  --primary: var(--coral);
  --primary-foreground: #ffffff;
  --secondary: var(--surface-2);
  --secondary-foreground: var(--text-secondary);
  --muted: var(--surface-2);
  --muted-foreground: var(--text-secondary);
  --accent: var(--surface-3);
  --accent-foreground: var(--text-primary);
  --destructive: oklch(0.62 0.2 27);
  --destructive-foreground: oklch(0.98 0 0);
  --border: var(--border-default);
  --input: #ffffff;
  --ring: var(--coral);
  --chart-1: var(--coral);
  --chart-2: var(--amber-8);
  --chart-3: #6d7bff;
  --chart-4: #3db7b0;
  --chart-5: #d55b53;
  --radius: 1.25rem;
  --sidebar: var(--paper);
  --sidebar-foreground: var(--text-primary);
  --sidebar-primary: var(--coral);
  --sidebar-primary-foreground: #ffffff;
  --sidebar-accent: var(--surface-2);
  --sidebar-accent-foreground: var(--text-secondary);
  --sidebar-border: var(--border-default);
  --sidebar-ring: var(--coral);

  --text-micro: 10px;
  --text-size-xs: 11px;
  --text-size-sm: 13px;
  --text-size-base: 15px;
  --text-size-lg: 18px;
  --text-size-xl: 24px;
  --text-size-2xl: 32px;
  --text-size-3xl: 48px;

  --sidebar-width: 240px;
  --sidebar-collapsed-width: 64px;
  --mobile-bottom-nav-height: 56px;

  --duration-instant: 80ms;
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 400ms;
  --duration-glacial: 600ms;

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.55, 0, 1, 0.45);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

  /* Shadow / Elevation System — brutalist sharp + soft variants */
  --shadow-sm: 0 1px 3px rgba(32,23,16,0.06), 0 1px 2px rgba(32,23,16,0.04);
  --shadow-md: 0 4px 12px rgba(32,23,16,0.08), 0 2px 4px rgba(32,23,16,0.04);
  --shadow-lg: 0 12px 40px rgba(32,23,16,0.12), 0 4px 8px rgba(32,23,16,0.06);
  --shadow-sharp: 0 4px 12px rgba(0,0,0,0.08);
  --shadow-elevated: 0 20px 40px -10px rgba(0,0,0,0.12);
  --shadow-brutal: 4px 4px 0 0 var(--ink);
  --shadow-brutal-sm: 2px 2px 0 0 var(--ink);
  --shadow-brutal-accent: 4px 4px 0 0 rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.5);
  --shadow-pillar-glow: 0 0 0 1.5px rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.3), 0 0 20px rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.1);

  /* Brutalist inverse surfaces — Tesla/SpaceX dark panels */
  --bg-inverse: #18181b;
  --text-inverse: #fafafa;
}


/* ===== PER-PILLAR ACCENT OVERRIDES ===== */

/* Creators — warm amber/gold (default, no overrides needed) */
[data-pillar="creators"] {
  /* Inherits :root amber — editorial warmth */
}

/* Designs — electric indigo/blue: clean, digital, UI precision */
[data-pillar="designs"] {
  --amber-8: #6b79ff;
  --amber-9: #5d6bfa;
  --amber-10: #7b86ff;
  --amber-11: #a2adff;
  --amber-12: #d4d9ff;
  --amber-contrast: #ffffff;
  --amber-surface: rgba(93, 107, 250, 0.12);
  --amber-indicator: var(--amber-9);
  --amber-track: var(--amber-9);
  --amber-subtle: rgba(93, 107, 250, 0.10);
  --amber-glow: rgba(93, 107, 250, 0.18);
  --accent-glow: rgba(93, 107, 250, 0.18);
  --accent-subtle: rgba(93, 107, 250, 0.10);
  --warm-accent: #4b58e8;
  --coral: var(--amber-9);
  --coral-hover: var(--amber-10);

  --pillar-r: 93;
  --pillar-g: 107;
  --pillar-b: 250;
  --pillar-warm-r: 75;
  --pillar-warm-g: 88;
  --pillar-warm-b: 232;
}

/* Dump — muted slate/teal: neutral catch-all with cool teal accent */
[data-pillar="dump"] {
  --amber-8: #42b9b3;
  --amber-9: #2eb8b4;
  --amber-10: #56cbc7;
  --amber-11: #89dbd8;
  --amber-12: #c3efed;
  --amber-contrast: #ffffff;
  --amber-surface: rgba(46, 184, 180, 0.12);
  --amber-indicator: var(--amber-9);
  --amber-track: var(--amber-9);
  --amber-subtle: rgba(46, 184, 180, 0.10);
  --amber-glow: rgba(46, 184, 180, 0.18);
  --accent-glow: rgba(46, 184, 180, 0.18);
  --accent-subtle: rgba(46, 184, 180, 0.10);
  --warm-accent: #25a39f;
  --coral: var(--amber-9);
  --coral-hover: var(--amber-10);

  --pillar-r: 46;
  --pillar-g: 184;
  --pillar-b: 180;
  --pillar-warm-r: 37;
  --pillar-warm-g: 163;
  --pillar-warm-b: 159;
}

/* Pillar transition class — smooth accent color shifts */
[data-pillar] {
  transition: color 300ms ease, background-color 300ms ease, border-color 300ms ease, box-shadow 300ms ease;
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
    font-family: var(--font-sans);
    background:
      radial-gradient(ellipse 65% 50% at 8% 0%, rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.11) 0%, transparent 65%),
      radial-gradient(ellipse 75% 55% at 92% 100%, rgba(var(--pillar-warm-r), var(--pillar-warm-g), var(--pillar-warm-b), 0.12) 0%, transparent 65%),
      linear-gradient(180deg, #fffdf9 0%, var(--surface-0) 45%, #fff6ed 100%);
  }

  /* ── Custom scrollbar ── */
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--surface-3); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--coral); }

  /* ── Focus rings ── */
  :focus-visible {
    outline: 2px solid var(--coral);
    outline-offset: 2px;
  }

  /* ── Selection color ── */
  ::selection {
    background: rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.22);
    color: var(--text-primary);
  }
}

/* ===== ANIMATION KEYFRAMES ===== */

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

@keyframes tag-enter {
  from {
    opacity: 0;
    transform: scale(0.8);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes tag-exit {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(0.8);
  }
}

@keyframes overlay-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes panel-slide-in {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}

@keyframes panel-slide-out {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(100%);
  }
}

@keyframes modal-enter {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes dropdown-enter {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes fade-in-up {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes success-flash {
  0% { background-color: var(--accent-subtle); }
  100% { background-color: transparent; }
}

@keyframes blink-cursor {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

@keyframes toast-enter {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes toast-exit {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(16px);
  }
}

@keyframes sidebar-slide-in {
  from {
    transform: translateX(-100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@keyframes sheet-slide-up {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}

@keyframes bottom-nav-slide-up {
  from {
    transform: translateY(100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

@keyframes glow-pulse {
  0%, 100% { box-shadow: 0 8px 30px -8px rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.28), 0 2px 10px rgba(32, 23, 16, 0.14); }
  50% { box-shadow: 0 10px 36px -6px rgba(var(--pillar-warm-r), var(--pillar-warm-g), var(--pillar-warm-b), 0.34), 0 4px 14px rgba(32, 23, 16, 0.18); }
}

@keyframes float-gentle {
  0%, 100% { transform: translateY(0) rotate(0deg); opacity: 0.4; }
  50% { transform: translateY(-10px) rotate(2deg); opacity: 0.6; }
}

@keyframes card-entrance {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes ember-breathe {
  0%, 100% { opacity: 0.3; filter: blur(60px); }
  50% { opacity: 0.5; filter: blur(80px); }
}

@keyframes ember-drift {
  0% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(30px, -20px) scale(1.1); }
  66% { transform: translate(-15px, 15px) scale(0.95); }
  100% { transform: translate(0, 0) scale(1); }
}

@keyframes gradient-shift {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

@keyframes border-glow-rotate {
  0% { --border-angle: 0deg; }
  100% { --border-angle: 360deg; }
}

@keyframes tab-content-enter {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes sheet-slide-down {
  from { transform: translateY(0); }
  to { transform: translateY(100%); }
}

@keyframes fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}

/* ===== REDUCED MOTION ===== */

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* ===== UTILITY CLASSES ===== */

@layer components {
  .text-micro {
    font-size: var(--text-micro);
    line-height: 1.4;
    text-transform: uppercase;
    letter-spacing: 0.4em;
    font-weight: 500;
  }

  .font-display {
    font-family: var(--font-display);
  }

  .animate-tag-enter {
    animation: tag-enter 120ms var(--ease-spring) forwards;
  }

  .animate-tag-exit {
    animation: tag-exit 100ms var(--ease-in) forwards;
  }

  .animate-overlay-enter {
    animation: overlay-enter var(--duration-fast) var(--ease-out) forwards;
  }

  .animate-panel-slide-in {
    animation: panel-slide-in var(--duration-normal) var(--ease-out) forwards;
  }

  .animate-panel-slide-out {
    animation: panel-slide-out 200ms var(--ease-in) forwards;
  }

  .animate-modal-enter {
    animation: modal-enter var(--duration-normal) var(--ease-out) forwards;
  }

  .animate-dropdown-enter {
    animation: dropdown-enter var(--duration-fast) var(--ease-out) forwards;
  }

  .animate-fade-in {
    animation: fade-in 300ms var(--ease-out) forwards;
  }

  .animate-card-entrance {
    animation: card-entrance 400ms var(--ease-out) forwards;
  }

  .animate-glow-pulse {
    animation: glow-pulse 3s ease-in-out infinite;
  }

  .animate-float-gentle {
    animation: float-gentle 8s ease-in-out infinite;
  }

  .animate-fade-in-up {
    animation: fade-in-up var(--duration-normal) var(--ease-out) forwards;
  }

  .animate-toast-enter {
    animation: toast-enter var(--duration-normal) var(--ease-out) forwards;
  }

  .animate-toast-exit {
    animation: toast-exit 200ms var(--ease-in) forwards;
  }

  .animate-success-flash {
    animation: success-flash var(--duration-slow) ease-out forwards;
  }

  .animate-blink-cursor {
    animation: blink-cursor 1s step-end infinite;
  }

  .animate-sidebar-slide-in {
    animation: sidebar-slide-in var(--duration-normal) var(--ease-out) forwards;
  }

  .animate-bottom-nav-slide-up {
    animation: bottom-nav-slide-up var(--duration-normal) var(--ease-out) forwards;
  }

  .animate-sheet-slide-up {
    animation: sheet-slide-up var(--duration-normal) var(--ease-out) forwards;
  }

  .animate-sheet-slide-down {
    animation: sheet-slide-down 200ms var(--ease-in) forwards;
  }

  .animate-tab-content-enter {
    animation: tab-content-enter var(--duration-fast) var(--ease-out) forwards;
  }

  .animate-ember-drift {
    animation: ember-drift 20s ease-in-out infinite;
  }

  .animate-ember-breathe {
    animation: ember-breathe 6s ease-in-out infinite;
  }

  /* Grain texture overlay — adds luxury feel to surfaces */
  .grain-overlay::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0.018;
    mix-blend-mode: multiply;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-repeat: repeat;
    background-size: 128px 128px;
  }

  /* ── Interactive utility classes — brutalist-informed ── */
  .interactive-ghost {
    transition: background-color var(--duration-instant), color var(--duration-instant), border-color var(--duration-instant);
  }
  .interactive-ghost:hover {
    background-color: var(--surface-2);
    color: var(--text-primary);
  }
  .interactive-ghost:focus-visible {
    background-color: var(--surface-2);
    color: var(--text-primary);
  }

  .interactive-surface {
    transition: background-color var(--duration-instant), color var(--duration-instant), border-color var(--duration-instant), box-shadow var(--duration-instant);
  }
  .interactive-surface:hover {
    background-color: var(--surface-3);
    color: var(--text-primary);
  }
  .interactive-surface:focus-visible {
    background-color: var(--surface-3);
    color: var(--text-primary);
  }

  .interactive-primary {
    transition: background-color var(--duration-instant), color var(--duration-instant), box-shadow var(--duration-instant), transform var(--duration-instant);
  }
  .interactive-primary:hover {
    background-color: var(--coral-hover);
    box-shadow: var(--shadow-brutal-accent);
    transform: translate(-1px, -1px);
  }
  .interactive-primary:active {
    box-shadow: none;
    transform: translate(0, 0);
  }
  .interactive-primary:focus-visible {
    background-color: var(--coral-hover);
  }

  /* Brutalist button — Tesla/SpaceX industrial: dark bg, mono uppercase, sharp edges */
  .btn-brutal {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.625rem 1.25rem;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-inverse);
    background-color: var(--bg-inverse);
    border: 1px solid var(--bg-inverse);
    transition: background-color var(--duration-instant), box-shadow var(--duration-instant), transform var(--duration-instant), color var(--duration-instant);
  }
  .btn-brutal:hover {
    background-color: var(--coral);
    border-color: var(--coral);
    color: #ffffff;
    box-shadow: var(--shadow-brutal);
    transform: translate(-2px, -2px);
  }
  .btn-brutal:active {
    box-shadow: none;
    transform: translate(0, 0);
  }

  /* Brutalist button — outline variant */
  .btn-brutal-outline {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-primary);
    background-color: transparent;
    border: 1px solid var(--border-strong);
    transition: background-color var(--duration-instant), box-shadow var(--duration-instant), transform var(--duration-instant), border-color var(--duration-instant);
  }
  .btn-brutal-outline:hover {
    background-color: var(--bg-inverse);
    color: var(--text-inverse);
    border-color: var(--bg-inverse);
    box-shadow: var(--shadow-brutal-sm);
    transform: translate(-1px, -1px);
  }
  .btn-brutal-outline:active {
    box-shadow: none;
    transform: translate(0, 0);
  }

  /* Brutalist pill — small toggle/chip with sharp corners */
  .pill-brutal {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.75rem;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    border: 1px solid var(--border-default);
    background-color: transparent;
    color: var(--text-secondary);
    transition: all var(--duration-instant);
  }
  .pill-brutal:hover {
    background-color: var(--surface-2);
    border-color: var(--border-strong);
    color: var(--text-primary);
  }
  .pill-brutal.pill-active {
    background-color: var(--bg-inverse);
    border-color: var(--bg-inverse);
    color: var(--text-inverse);
  }

  /* ── Image card CSS-only hover system ── */
  /* No transforms on column items — they break CSS multi-column distribution.
     Hover effect is box-shadow + opacity only. Image zoom is handled by
     the group-hover:scale on the <Image> element inside. */
  .card-base {
    transition: box-shadow var(--duration-normal) var(--ease-out), opacity var(--duration-normal);
    box-shadow: var(--shadow-sharp);
  }
  .card-base:hover {
    box-shadow: var(--shadow-elevated), 0 0 0 1px rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.18);
    opacity: 1;
  }
  .card-base.card-selected {
    box-shadow: var(--shadow-pillar-glow), 0 0 24px rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.18);
    opacity: 1;
  }
  .card-base.card-dimmed {
    opacity: 0.55;
  }
  .card-base.card-dimmed:hover {
    opacity: 1;
  }

  /* Empty state CTA hover — brutal offset shadow */
  .empty-state-cta:hover {
    background: var(--coral-hover) !important;
    box-shadow: var(--shadow-brutal) !important;
    transform: translate(-2px, -2px);
  }
  .empty-state-cta:active {
    box-shadow: none !important;
    transform: translate(0, 0);
  }

  /* Fade-out utility */
  .animate-fade-out {
    animation: fade-out 200ms var(--ease-in) forwards;
  }

  /* Glass surface — frosted volcanic glass */
  .glass-surface {
    background: rgba(255, 250, 245, 0.82);
    backdrop-filter: blur(20px) saturate(120%);
    -webkit-backdrop-filter: blur(20px) saturate(120%);
    border: 1px solid rgba(32, 23, 16, 0.09);
  }
}

/* ── Mobile: zero sidebar offset ── */
@media (max-width: 767px) {
  .md-sidebar-offset {
    margin-left: 0 !important;
  }
}
const colorTokens = {
  background: "#080402",
  foreground: "#f0ebe8",
  card: "#110a06",
  "card-foreground": "#f0ebe8",
  popover: "#1c120b",
  "popover-foreground": "#f0ebe8",
  primary: "#FF8C42",
  "primary-foreground": "#1a0d02",
  secondary: "#1c120b",
  "secondary-foreground": "#b8afa9",
  muted: "#1c120b",
  "muted-foreground": "#b8afa9",
  accent: "#FFa862",
  "accent-foreground": "#1a0d02",
  destructive: "oklch(0.62 0.2 27)",
  "destructive-foreground": "#f0ebe8",
  border: "#3d3735",
  input: "#2a2624",
  ring: "#FF8C42",
  "chart-1": "#FF8C42",
  "chart-2": "#c47424",
  "chart-3": "#b86834",
  "chart-4": "#807774",
  "chart-5": "#b8afa9",
  sidebar: "#110a06",
  "sidebar-foreground": "#f0ebe8",
  "sidebar-primary": "#FF8C42",
  "sidebar-primary-foreground": "#1a0d02",
  "sidebar-accent": "#1c120b",
  "sidebar-accent-foreground": "#b8afa9",
  "sidebar-border": "#3d3735",
  "sidebar-ring": "#FF8C42",
};

const spacingTokens = {
  px: "1px",
  0: "0px",
  0.5: "0.125rem",
  1: "0.25rem",
  1.5: "0.375rem",
  2: "0.5rem",
  2.5: "0.625rem",
  3: "0.75rem",
  3.5: "0.875rem",
  4: "1rem",
  5: "1.25rem",
  6: "1.5rem",
  7: "1.75rem",
  8: "2rem",
  9: "2.25rem",
  10: "2.5rem",
  11: "2.75rem",
  12: "3rem",
  14: "3.5rem",
  16: "4rem",
  20: "5rem",
  24: "6rem",
  28: "7rem",
  32: "8rem",
  36: "9rem",
  40: "10rem",
  44: "11rem",
  48: "12rem",
  52: "13rem",
  56: "14rem",
  60: "15rem",
  64: "16rem",
  72: "18rem",
  80: "20rem",
  96: "24rem",
};

const radiusTokens = {
  none: "0px",
  sm: "0.5rem",
  md: "0.75rem",
  lg: "1rem",
  xl: "1.25rem",
  "2xl": "1.75rem",
  "3xl": "2.25rem",
  "4xl": "3rem",
  full: "9999px",
};

const config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./tests/**/*.{ts,tsx}",
  ],
  theme: {
    tokens: {
      colors: colorTokens,
      spacing: spacingTokens,
      radius: radiusTokens,
    },
  },
};

export default config;
