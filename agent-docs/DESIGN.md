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

Each of the 4 pillars sets CSS vars on the root:

| Pillar | Accent |
|--------|--------|
| `creators` | Coral / warm red |
| `cars` | Amber / orange |
| `designs` | Blue / cool |
| `dump` | Neutral gray |

Interactive elements use `rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.12)` for tinted backgrounds and borders. Verify pillar theming works after every UI change by switching all 4 pillars.

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
