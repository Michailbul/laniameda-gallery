# 07 — Iconography

## Icon Library

**Lucide React** — a clean, consistent, open-source icon set with 1px stroke weight. Chosen for its neutrality and geometric precision, which complements both the editorial warmth and brutalist sharpness of the design system.

- **Package**: `lucide-react`
- **Style**: Outlined (stroke), not filled
- **Stroke width**: Default 1px (Lucide standard)

---

## Icon Sizing Scale

Icons follow a strict sizing scale tied to component context:

| Size | Pixels | Tailwind | Use |
|------|--------|----------|-----|
| **3xs** | 10px | `h-[10px] w-[10px]` | Checkbox check mark inside 14px container |
| **2xs** | 12px | `h-3 w-3` | Badge icons, button xs icons, removable tag X, expand toggle |
| **xs** | 14px | `h-3.5 w-3.5` | Nav item icons (inside 26px container), sidebar controls |
| **sm** | 16px | `h-4 w-4` | Standard button icons, sidebar collapse/expand, close buttons |
| **md** | 20px | `h-5 w-5` | Mobile nav icons, standalone action icons |
| **lg** | 24px | `h-6 w-6` | Loading state placeholder, large standalone icons |

---

## Icon Color Patterns

Icons inherit text color from their parent context. Common patterns:

| Context | Color Token |
|---------|-------------|
| Active nav item | `--text-primary` (inherited) |
| Inactive nav item | `--text-secondary` (inherited) |
| Ghost/muted icon | `--text-ghost` |
| On-dark overlay | `rgba(255, 255, 255, 0.85)` |
| Primary action | `--coral` or `--primary-foreground` (on coral bg) |
| Destructive | `--destructive` |
| Mobile nav active | `--amber-9` |
| Mobile nav inactive | `--text-ghost` |

---

## Commonly Used Icons

From the codebase analysis, these Lucide icons form the core icon vocabulary:

### Navigation
- `Home` — Gallery home / main view
- `Search` — Search/filter trigger
- `Plus` — Add/upload action
- `User` — Profile/account
- `ChevronLeft` / `ChevronRight` — Sidebar collapse/expand, pagination
- `ChevronUp` / `ChevronDown` — Expand/collapse sections

### Actions
- `Copy` — Copy to clipboard
- `Download` — Download asset
- `X` — Close panel/sheet/tag, dismiss
- `Check` — Confirmation, checkbox active state
- `LogOut` — Sign out
- `Maximize2` — Expand/view details (on card hover)
- `Link` — External link / source URL

### Content
- `ImageIcon` — Image placeholder, loading state
- `Hash` — Category/model section indicator
- `Package` — Asset/bundle indicator

### AI Actions
- `Paintbrush` — Transfer style
- `Move` — Transfer pose
- `UserRound` — Replace character
- `ArrowRight` — Proceed/submit

---

## Icon Containers

Icons in navigation items sit inside bordered containers:

```css
/* Nav icon container */
width: 26px;
height: 26px;
border-radius: 6px;
border: 1px solid;
display: flex;
align-items: center;
justify-content: center;

/* Active state */
border-color: rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.35);
background-color: rgba(var(--pillar-r), var(--pillar-g), var(--pillar-b), 0.09);

/* Inactive state */
border-color: rgba(32, 23, 16, 0.14);
background-color: rgba(255, 255, 255, 0.34);
```

---

## Icon in Buttons (CVA Integration)

The button component automatically sizes icons:

```css
[&_svg:not([class*='size-'])]:size-4    /* default: 16px */
[&_svg:not([class*='size-'])]:size-3    /* xs: 12px */
[&_svg:not([class*='size-'])]:size-3.5  /* sm: 14px */
```

Buttons with leading/trailing icons adjust padding:
- `has-data-[icon=inline-start]:pl-2.5` — reduced left padding for leading icon
- `has-data-[icon=inline-end]:pr-2.5` — reduced right padding for trailing icon

---

## Rules

- ✅ Always use Lucide React — no mixing icon libraries
- ✅ Icons are always outlined/stroked, never filled
- ✅ Icon colors come from parent text color inheritance — avoid setting icon color directly unless necessary
- ✅ Use the sizing scale — don't use arbitrary icon sizes
- ❌ No emoji as icons
- ❌ No custom SVG icons unless Lucide doesn't have an equivalent
