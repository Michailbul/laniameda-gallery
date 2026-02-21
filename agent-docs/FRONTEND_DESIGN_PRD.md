# Frontend Design PRD — Laniameda AI UGC

Last updated: 2026-02-20

---

## 1) Design Vision

**One sentence**: A cinematic creative console where images are sacred, filtering is invisible, and every click feels like wielding a precision instrument.

**Design identity**: Neo-editorial darkroom. Not a dashboard — a creative weapon. The UI disappears so the work can breathe. Every surface is a stage for imagery. Every control is a scalpel, not a hammer.

**What makes it unforgettable**: The tag/filter system is not a sidebar checkbox list — it is the *spatial language of the entire interface*. Tags are everywhere: floating above the grid, woven into cards, composable with gestures. The user never "opens filters" — they *think in filters* because the system anticipates their intent.

**Reference DNA** (not to copy, but to channel):
- **Apple Photos** — spatial memory, progressive revelation, zero-chrome viewing
- **Arc Browser** — bold color use, spatial tabs, command palette as primary navigation
- **Linear** — keyboard-first power, extreme density without claustrophobia
- **Cosmos (creative tool)** — dark canvas energy, floating panels, cinematic composition
- **Loewe / Celine lookbooks** — editorial restraint, typographic confidence, monochrome drama

**Non-negotiable principles**:
1. **The image is the interface.** Chrome exists to serve imagery, never to compete with it.
2. **Zero redundant actions.** If the user has to click twice for something that could be one click, we failed.
3. **Spatial consistency.** Every element has a home. The user builds muscle memory in the first session.
4. **Progressive power.** Simple on first glance. Devastatingly powerful on second.
5. **Eccentric restraint.** Bold choices executed with surgical precision. Never loud for the sake of loud.

---

## 2) Typography System

### Font Stack Evolution

Move from the current `Manrope / Sora / Inter` stack to a more distinctive pairing:

| Role | Font | Weight | Usage |
|------|------|--------|-------|
| **Display / Headlines** | `Instrument Serif` | 400 | Modal titles, empty states, hero moments |
| **UI / Labels** | `Geist` | 400–600 | All interface text, navigation, buttons, metadata |
| **Mono / Code** | `Geist Mono` | 400 | Prompt text, run output, technical metadata |

**Why this pairing**: Instrument Serif is unexpected in a dark creative tool — it brings editorial gravitas without feeling dated. Geist is the precision counterpart: engineered for UI at small sizes, with excellent legibility on dark backgrounds. Together they create a "luxury creative tool" feel — like a fashion magazine built a dev tool.

### Type Scale

```
--text-micro:  10px / 1.4  (uppercase labels, tracking 0.4em)
--text-xs:     11px / 1.45 (metadata, timestamps, secondary info)
--text-sm:     13px / 1.5  (body text, descriptions, tag labels)
--text-base:   15px / 1.55 (primary UI text, input values)
--text-lg:     18px / 1.4  (section headers, panel titles)
--text-xl:     24px / 1.3  (modal titles, feature headlines)
--text-2xl:    32px / 1.2  (display — hero moments, empty states)
--text-3xl:    48px / 1.1  (display — landing, onboarding)
```

### Type Rules

- **Uppercase micro-labels**: Always `--text-micro` with `tracking-[0.4em]` and `font-weight: 500`. Used for category headings, section labels, status indicators.
- **Never bold body text.** Use weight 500 (medium) as maximum for UI. Reserve 600 (semibold) for active states and navigation emphasis only.
- **Prompt/content text**: Always in `Geist Mono` at `--text-sm`, with `leading-relaxed`. Prompt text is sacred — it needs room to breathe and be readable.
- **Numbers in metadata**: Use tabular figures (`font-variant-numeric: tabular-nums`) so columns align.
- **Truncation**: Single-line truncation with ellipsis. Never wrap card-level text — the image is the label.

---

## 3) Color System

### Palette Architecture

Keep the core black + teal identity but add depth layers and a secondary accent:

```css
/* === DEPTH LAYERS (black-on-black refinement) === */
--surface-0:    #000000;           /* True black — canvas */
--surface-1:    #080808;           /* Barely visible — card rest */
--surface-2:    #111111;           /* Card hover / active panels */
--surface-3:    #1a1a1a;           /* Elevated surfaces — modals, popovers */
--surface-4:    #222222;           /* Input backgrounds, interactive zones */

/* === BORDERS (the subtlety spectrum) === */
--border-subtle:  rgba(255,255,255,0.06);  /* Card edges, section dividers */
--border-default: rgba(255,255,255,0.10);  /* Input borders, panel edges */
--border-strong:  rgba(255,255,255,0.16);  /* Focus rings, active selections */
--border-accent:  rgba(0,255,251,0.25);    /* Teal-tinted borders for primary zones */

/* === TEXT HIERARCHY === */
--text-primary:   #eeeeee;         /* Headings, primary labels */
--text-secondary: #999999;         /* Body text, descriptions */
--text-tertiary:  #666666;         /* Metadata, timestamps, placeholders */
--text-ghost:     #444444;         /* Disabled, decorative text */

/* === ACCENT — Teal (kept, refined) === */
--accent-primary:   #00fffb;       /* CTA, active filters, focus rings */
--accent-muted:     #00dad7;       /* Hover states, secondary emphasis */
--accent-subtle:    rgba(0,255,251,0.08);  /* Tint backgrounds for active tags */
--accent-glow:      rgba(0,255,251,0.15);  /* Glow effects behind active elements */

/* === SEMANTIC ACCENT — Warm (new) === */
--warm-accent:      #ff6b35;       /* Destructive/attention: errors, unsaved, hot tags */
--warm-subtle:      rgba(255,107,53,0.08); /* Warning backgrounds */

/* === STATUS === */
--status-running:   #00fffb;       /* Active AI run */
--status-success:   #34d399;       /* Completed */
--status-error:     #ef4444;       /* Failed */
--status-queued:    #666666;       /* Waiting */
```

### Color Rules

- **Never use white backgrounds.** Even the lightest surface is `--surface-4` (#222).
- **Teal is earned.** Only active/primary states get `--accent-primary`. Overuse kills the signal.
- **Warm accent is rare.** Reserved for moments that need immediate attention — errors, unsaved work, hot/trending indicators.
- **Borders create depth, not boxes.** Use `--border-subtle` on most elements. Strong borders are reserved for focus and active states.
- **Images have no border.** Gallery images sit directly on `--surface-0` with zero border, zero radius, zero gap (Pinterest-style). The grid *is* the layout.

---

## 4) Layout Architecture

### 4.1 Application Shell

```
+---------------------------------------------------------------------+
|  [Logo]  [◉ Gallery] [◉ Library] [◉ Characters]    [⌘K]  [Avatar]  |  ← Top bar (48px, sticky)
+---------------------------------------------------------------------+
|                                                                     |
|  [Tag Bar — horizontal scrollable filter chips]                     |  ← Tag rail (44px, sticky below top bar)
|                                                                     |
+---------------------------------------------------------------------+
|                                                                     |
|                                                                     |
|                     M A S O N R Y   G R I D                         |  ← Main content (full bleed)
|                     (zero-gap, edge-to-edge)                        |
|                                                                     |
|                                                                     |
+---------------------------------------------------------------------+
```

**Key architectural change**: Remove the current `GalleryHeader` tab bar + filter button pattern. Replace with:

1. **Top bar** — Persistent, minimal. Logo left, nav center, command palette trigger + avatar right. Height 48px. Background `--surface-1` with `--border-subtle` bottom.

2. **Tag rail** — Horizontal scrollable row of filter chips directly below the top bar. Always visible. This replaces the hidden filter sidebar as the *primary* filter interaction. Sticky at `top: 48px`.

3. **Grid** — Full-bleed masonry with zero gap. Images touch each other and the viewport edges. No padding. The content IS the page.

### 4.2 Top Bar Specification

```
┌─────────────────────────────────────────────────────────────────┐
│  ◆ Laniameda    Gallery  Library  Characters     ⌘K    [•] MK  │
└─────────────────────────────────────────────────────────────────┘
```

- **Logo**: Custom mark (small, 20px), no wordmark at this size. On hover, subtle teal glow.
- **Navigation**: Three text links. Active state: `--text-primary` + subtle bottom indicator (2px, `--accent-primary`). Inactive: `--text-tertiary`. Transition: 150ms color change.
- **Command palette trigger**: `⌘K` badge in a pill container. Opens command palette (see section 6.4).
- **Avatar**: 28px circle, border `--border-default`. Dropdown on click for settings/sign-out.
- **Background**: `--surface-1` at 85% opacity with `backdrop-blur-lg`. Merges with content on scroll.

### 4.3 Tag Rail (Core Feature — The Heart of the UX)

This is the single most important UI element. It replaces the sidebar filter pattern with an always-visible, horizontally scrollable, composable tag system.

```
┌─────────────────────────────────────────────────────────────────────┐
│  All ·  Style ▾  Subject ▾  Mood ▾  Color ▾  │  Portrait  Dark    │
│                                               │  Moody  Fashion    │
│  [category dropdowns]                         │  [active tag pills] │
└─────────────────────────────────────────────────────────────────────┘
```

**Structure**:
- **Left zone**: Category dropdown triggers (`Style`, `Subject`, `Mood`, `Color`). Each opens a floating panel below with the category's tags.
- **Divider**: Thin vertical line `--border-default`.
- **Right zone**: Horizontal scroll area showing active filter tag pills. Each pill has an `×` to remove. Scroll with mouse wheel (horizontal) or touch drag.
- **"All" button**: Resets all filters. Visually distinct — outline style when filters are active.
- **Background**: `--surface-0` (true black) with `--border-subtle` bottom edge. It should feel like it's part of the canvas, not a separate toolbar.

**Category dropdown behavior**:
- Click a category → floating panel appears below with tag chips in a wrapping grid (max 3 rows).
- Each tag chip: pill shape, `--text-secondary` default, `--accent-primary` text + `--accent-subtle` background when active.
- Click a tag → it activates and appears in the active zone on the right. Panel stays open for multi-select.
- Click outside or press Escape → panel closes.
- Dropdown trigger shows count badge when tags in that category are active.

**Active tag pills**:
- Pill shape with `--accent-subtle` background, `--accent-primary` text.
- `×` button on right side of pill. Click removes the filter.
- Hover: background intensifies to `--accent-glow`.
- Enter/exit animation: scale from 0.8 + fade in (120ms, ease-out).

**Keyboard shortcuts**:
- `/` focuses the tag rail search (inline search within the rail).
- `Backspace` when tag rail is focused removes the last active tag.
- Arrow keys navigate between active tags.

### 4.4 Masonry Grid (Zero-Gap Architecture)

```
+--------+-----------+------+---------+
|        |           |      |         |
|  img   |   img     | img  |  img    |
|        |           |      |         |
+--------+     img   +------+         |
|        |           |      +---------+
|  img   |           | img  |         |
|        +-----------+      |  img    |
+--------+           +------+         |
|        |   img     |      +---------+
|  img   |           | img  |         |
|        |           |      |  img    |
+--------+-----------+------+---------+
```

**Grid rules**:
- **Zero gap** between images. No padding, no margin, no border. Images are flush.
- **Zero page padding** — grid touches viewport edges on left and right.
- **Column count**: 5 cols at `≥1440px`, 4 at `≥1024px`, 3 at `≥768px`, 2 at `≥480px`.
- **Aspect ratios preserved** — each image renders at its natural aspect ratio via CSS `columns` layout.
- **No card wrapper** — images are raw, directly placed. The grid itself is the design.
- **Hover state**: Image scales to `1.03` with `transition: 200ms ease-out`. Neighboring images do NOT shift — the scaling is purely visual (`transform: scale`, no layout reflow). A subtle teal border glow appears (`box-shadow: 0 0 0 2px var(--accent-primary)`).

**Image overlay on hover** (appears from bottom):
```
┌────────────────────┐
│                    │
│      [image]       │
│                    │
│ ▼ fade-in overlay  │
│ "Editorial dark"   │  ← prompt text (1 line, truncated)
│ ◎ Style  ◎ Pose    │  ← quick action icons
└────────────────────┘
```
- Overlay: gradient from transparent → `rgba(0,0,0,0.7)` at bottom.
- Prompt text: `--text-micro` size, `--text-primary`, 1 line, ellipsis overflow.
- Quick action icons: small (16px), `--text-tertiary` default, `--text-primary` on hover. Three icons for Transfer Style, Transfer Pose, Replace Character. Click triggers action directly — no modal needed for the action trigger.
- Overlay animation: `translateY(8px)` → `translateY(0)` with `opacity 0→1`, 150ms ease-out.

### 4.5 Image Detail View (Full-screen takeover)

Replace the current modal with a full-screen immersive view:

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back                                              ✕ Close   │
│                                                                 │
│                                                                 │
│                                                                 │
│                    [ FULL RES IMAGE ]                            │
│                   (centered, max-height)                        │
│                                                                 │
│                                                                 │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  "A dark editorial portrait with dramatic lighting..."          │
│                                                                 │
│  Tags:  Portrait · Dark · Moody · Fashion                       │
│  Source: Telegram  ·  2026-02-19  ·  1920×1080                  │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ Transfer      │  │ Transfer     │  │ Replace              │   │
│  │ Style     →   │  │ Pose     →   │  │ Character        →   │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
│                                                                 │
│  [ Copy Prompt ]  [ Download ]  [ Add to Collection ]           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Behavior**:
- Opens as a full-viewport overlay with `background: var(--surface-0)`.
- Image area: centered, `max-height: 70vh`, preserves aspect ratio.
- Progressive loading: thumbnail renders instantly (already cached from grid), full-res fades in (`opacity 0→1, 500ms`).
- Bottom panel: slides up from below (`translateY(20px)→0`, 200ms, staggered 100ms after image appears).
- **Back button** (`←`): navigates to previous/next image in the grid (arrow key support).
- **Keyboard**: `←`/`→` for prev/next image. `Escape` to close. `C` to copy prompt. `S` to transfer style.
- **Transition from grid**: The clicked image *expands* from its grid position to the full-screen view (shared element transition). Use `View Transitions API` where supported, CSS fallback otherwise.

**Action cards** (Transfer Style / Transfer Pose / Replace Character):
- `--surface-2` background, `--border-default` border, `rounded-xl`.
- Hover: border becomes `--border-accent`, subtle teal glow shadow.
- Click: opens the action flow (see section 5).
- Arrow icon (`→`) on right side, `--text-tertiary`, moves right 4px on hover.

**Secondary actions** (Copy / Download / Collect):
- Ghost buttons, `--text-secondary`, `--text-primary` on hover.
- Copy Prompt: copies to clipboard, button text changes to "Copied" with checkmark for 2s.
- Download: downloads full-res image.
- Add to Collection: opens a mini-dropdown with folder/collection selection.

### 4.6 AI Workspace Panel

Redesigned as a sliding panel from the right edge:

```
┌─────────────────────────────────────────────────┐
│  AI WORKSPACE                            ✕      │
│  Transfer Style                                  │
│  Run: run_abc123                                 │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌─── Reference ────────────────────────────┐   │
│  │  [thumbnail]  "Editorial dark portrait"  │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  ┌─── Status ───────────────────────────────┐   │
│  │  ● Analyzing reference style...          │   │
│  │  ● Building prompt structure...          │   │
│  │  ○ Generating output...                  │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  ┌─── Output ───────────────────────────────┐   │
│  │                                          │   │
│  │  [streaming prompt text in mono]         │   │
│  │                                          │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  [ Copy Package ]  [ Download All ]              │
│                                                  │
└─────────────────────────────────────────────────┘
```

**Behavior**:
- Width: `480px` on `≥1440px`, `420px` on `≥1024px`, full-width sheet on smaller.
- Slides in from right (`translateX(100%)→0`, 250ms, ease-out).
- Main content pushes left (does NOT overlay — the grid reflows to accommodate).
- **Status section**: Step-by-step progress. Completed steps get `--status-success` indicator. Active step pulses. Future steps are `--text-ghost`.
- **Output section**: Streaming text appears character-by-character in `Geist Mono`. Background `--surface-1` with `--border-subtle`.
- **Reference card**: Shows the source image thumbnail + prompt text. Visual anchor so the user remembers what triggered the run.
- **Error state**: Red-tinted card with `--status-error` left border. Clear error message + "Retry" button.

---

## 5) Few-Click Aha Flow (Core UX)

This is the signature interaction. The user goes from "I see an image I like" to "I have a usable prompt package" in 2-3 clicks.

### Flow: Transfer Style

```
Step 1: User hovers image in grid → sees quick action icons
Step 2: User clicks "Style" icon on hover overlay
    → OR: User opens detail view → clicks "Transfer Style" card
Step 3: Character selector appears (inline popover, not a new page)
    → Shows user's saved characters as small thumbnails
    → "Use original" option if they don't want character swap
    → Click a character → selected state (teal border)
Step 4: Click "Generate" → AI workspace panel slides in
    → Streaming output begins immediately
    → User can continue browsing while it generates
Step 5: Output complete → notification badge on workspace panel tab
    → User clicks to view → copy/download prompt package
```

**Total clicks for power user**: 3 (hover icon → select character → generate)
**Total clicks for explorer**: 4 (click image → click action card → select character → generate)

### Character Selector Popover

```
┌────────────────────────────────────┐
│  SELECT CHARACTER                  │
│                                    │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐     │
│  │ 🖼 │ │ 🖼 │ │ 🖼 │ │ +  │     │
│  │Luna│ │Nova│ │Mika│ │Add │     │
│  └────┘ └────┘ └────┘ └────┘     │
│                                    │
│  ─── or ───                        │
│  ○ Use original (no character)     │
│                                    │
│  [ Generate →]                     │
└────────────────────────────────────┘
```

- Appears as a floating popover anchored to the action trigger.
- Character thumbnails: 56px circles, `--border-default`. Selected: `--accent-primary` border, `--accent-subtle` glow.
- "Add" button: dashed border circle, opens character creation flow.
- "Use original": radio-style option below characters.
- "Generate" button: primary style (`--accent-primary` background, dark text), full width at bottom.
- Popover animation: scale(0.95)→1 + opacity, 150ms.

---

## 6) Component Specifications

### 6.1 Tag Chips (Used everywhere)

**Default state**:
- Background: transparent
- Border: `1px solid var(--border-default)`
- Text: `--text-secondary`, `Geist`, `--text-sm`
- Padding: `4px 12px`
- Radius: `9999px` (full pill)

**Hover state**:
- Border: `--border-strong`
- Text: `--text-primary`
- Background: `--surface-2`

**Active/Selected state**:
- Background: `--accent-subtle`
- Border: `1px solid var(--accent-primary)` at 30% opacity
- Text: `--accent-primary`

**With remove (×)**:
- Same as active + small `×` icon on right (12px), `--text-tertiary`
- `×` hover: `--accent-primary`

### 6.2 Buttons

**Primary** (reserved for THE main action on any screen):
- Background: `--accent-primary` (#00fffb)
- Text: `--teal-contrast` (dark), `Geist` 500
- Height: `36px`, padding `0 20px`
- Radius: `9999px` (pill)
- Hover: `brightness(0.9)`, subtle scale(1.02)
- Active: `brightness(0.8)`, scale(0.98)

**Secondary**:
- Background: `--surface-3`
- Border: `1px solid var(--border-default)`
- Text: `--text-primary`
- Height: `36px`
- Hover: `--surface-4`, border `--border-strong`

**Ghost**:
- Background: transparent
- Text: `--text-secondary`
- Height: `32px`
- Hover: `--text-primary`, background `--surface-2`

**Icon button**:
- `32px × 32px`, no border
- Icon: `--text-tertiary`
- Hover: `--text-primary`, background `--surface-2`, `rounded-lg`

### 6.3 Input Fields

**Text input**:
- Background: `--surface-4`
- Border: `1px solid var(--border-subtle)`
- Text: `--text-primary`, `Geist`, `--text-base`
- Placeholder: `--text-ghost`
- Height: `40px`, padding `0 16px`
- Radius: `12px`
- Focus: border `--accent-primary` at 50% opacity, `box-shadow: 0 0 0 3px var(--accent-glow)`

**Textarea**:
- Same as input but `min-height: 100px`, `padding: 12px 16px`
- Radius: `16px`
- For prompt text: use `Geist Mono`

**Search input** (in tag rail):
- Same as text input but `height: 32px`, `--text-sm`
- Magnifying glass icon on left, `--text-ghost`
- Radius: `9999px` (pill)

### 6.4 Command Palette

A power-user feature — `⌘K` opens a command palette for instant navigation and actions.

```
┌────────────────────────────────────────────┐
│  🔍 Type a command or search...            │
├────────────────────────────────────────────┤
│  QUICK ACTIONS                             │
│  ▸ Upload image or prompt                  │
│  ▸ Create new character                    │
│  ▸ Search all tags...                      │
│                                            │
│  RECENT                                    │
│  ▸ "Editorial portrait" prompt package     │
│  ▸ Last AI run: Transfer Style             │
│                                            │
│  NAVIGATION                                │
│  ▸ Go to Gallery                           │
│  ▸ Go to Library                           │
│  ▸ Go to Characters                        │
└────────────────────────────────────────────┘
```

- Centered overlay, `max-width: 560px`, `--surface-3` background
- Backdrop: `--surface-0` at 60% opacity + `backdrop-blur-xl`
- Input at top, results below (filtered as user types)
- Selected item: `--surface-4` background
- Keyboard navigation: arrow keys + enter
- Animation: scale(0.98)→1, opacity, 120ms

### 6.5 Upload Modal

Redesigned as a focused creation experience:

```
┌──────────────────────────────────────────────────┐
│                                                  │
│              ADD TO YOUR LIBRARY                 │
│    Drop images, paste URLs, or write prompts     │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │                                          │    │
│  │         [ drag & drop zone ]             │    │
│  │         click to browse files            │    │
│  │                                          │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  ─── or paste a URL ───                          │
│  ┌──────────────────────────────────────────┐    │
│  │  https://...                             │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  ─── add a prompt ───                            │
│  ┌──────────────────────────────────────────┐    │
│  │  Describe the image or paste a prompt... │    │
│  │                                          │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  Tags:  [ + Add tags ]                           │
│  Folder: [ Select folder ▾ ]                     │
│                                                  │
│             [ Upload & Organize ]                 │
│                                                  │
└──────────────────────────────────────────────────┘
```

- Centered modal, `max-width: 520px`
- Dropzone: dashed border `--border-default`, `--surface-1` background. On drag-over: border becomes `--accent-primary`, background `--accent-subtle`.
- Each section separated by subtle `─── or ───` divider with `--text-ghost` text.
- Tag input: inline tag creation. Type + Enter to add. Shows as pills.
- Folder selector: dropdown with existing folders + "Create new" option.
- Submit button: primary style, centered.

### 6.6 Empty States

Every empty state follows this pattern:
```
[Illustration/Icon — subtle, line-art, teal-tinted]

"No images yet"                     ← Instrument Serif, --text-xl
Add your first reference to         ← Geist, --text-sm, --text-secondary
start building your library.

[ Add Image ]                       ← Primary button
```

- Icon: thin line illustration, 48px, `--text-tertiary` with subtle teal tint
- Headline: `Instrument Serif`, `--text-xl`, `--text-primary`
- Body: `Geist`, `--text-sm`, `--text-secondary`, max-width 320px, centered
- CTA: primary button below
- The entire empty state is vertically centered in the available space

---

## 7) Motion & Animation System

### Philosophy
Motion is communication, not decoration. Every animation answers one of:
- **Where did this come from?** (origin animation)
- **What is happening?** (state transition)
- **Where is my attention needed?** (emphasis)

### Timing Tokens

```css
--duration-instant:  80ms;    /* Hover states, color changes */
--duration-fast:     150ms;   /* Popovers, tooltips, small reveals */
--duration-normal:   250ms;   /* Panel slides, modal opens */
--duration-slow:     400ms;   /* Page transitions, complex reveals */
--duration-glacial:  600ms;   /* Hero animations, onboarding */

--ease-out:          cubic-bezier(0.16, 1, 0.3, 1);     /* Elements entering */
--ease-in:           cubic-bezier(0.55, 0, 1, 0.45);    /* Elements exiting */
--ease-spring:       cubic-bezier(0.34, 1.56, 0.64, 1); /* Playful emphasis */
```

### Specific Animations

| Element | Animation | Duration | Easing |
|---------|-----------|----------|--------|
| Image hover scale | `scale(1) → scale(1.03)` | `--duration-fast` | `--ease-out` |
| Image overlay appear | `translateY(8px), opacity(0) → 0, 1` | `--duration-fast` | `--ease-out` |
| Tag chip add | `scale(0.8), opacity(0) → 1, 1` | `120ms` | `--ease-spring` |
| Tag chip remove | `scale(1), opacity(1) → 0.8, 0` | `100ms` | `--ease-in` |
| Category dropdown open | `translateY(-4px), opacity(0) → 0, 1` | `--duration-fast` | `--ease-out` |
| Detail view open | Shared element expand from grid | `--duration-normal` | `--ease-out` |
| Detail view close | Shared element contract to grid | `200ms` | `--ease-in` |
| Workspace panel slide | `translateX(100%) → 0` | `--duration-normal` | `--ease-out` |
| Workspace panel exit | `0 → translateX(100%)` | `200ms` | `--ease-in` |
| Modal appear | `scale(0.96), opacity(0) → 1, 1` | `--duration-normal` | `--ease-out` |
| Command palette appear | `scale(0.98), opacity(0) → 1, 1` | `120ms` | `--ease-out` |
| Stagger (grid load) | Each image delays by `index * 30ms` | `--duration-normal` | `--ease-out` |
| Loading shimmer | `translateX(-100%) → translateX(100%)` | `1.5s infinite` | `linear` |
| Success flash | Background flash `--accent-subtle` → `transparent` | `--duration-slow` | `ease-out` |

### Page Load Sequence

When the gallery loads:
1. Top bar fades in (0ms)
2. Tag rail slides down from top (50ms delay)
3. First row of images stagger in from bottom (100ms delay, 30ms per image)
4. Remaining images load naturally as they enter viewport

### Scroll Behavior

- **Tag rail**: Sticky, no animation on scroll. Always visible.
- **Top bar**: Subtle opacity shift on scroll — from 100% to 85% opacity with stronger blur.
- **Images**: Lazy load with fade-in (`opacity 0→1, 300ms`) as they enter the viewport.
- **No parallax**. No scroll-jacking. Smooth native scroll only.

---

## 8) Interaction Patterns

### 8.1 Keyboard Shortcuts (Power User Layer)

| Shortcut | Action |
|----------|--------|
| `⌘K` | Open command palette |
| `/` | Focus tag rail search |
| `G` then `G` | Go to Gallery (vim-style) |
| `G` then `L` | Go to Library |
| `G` then `C` | Go to Characters |
| `U` | Open upload modal |
| `Escape` | Close any overlay/modal/panel |
| `←` / `→` | Prev/next image in detail view |
| `C` | Copy prompt (when in detail view) |
| `S` | Transfer Style (when in detail view) |
| `P` | Transfer Pose (when in detail view) |
| `R` | Replace Character (when in detail view) |
| `Backspace` | Remove last active filter tag |
| `?` | Show keyboard shortcut help overlay |

### 8.2 Drag & Drop

- **Grid images** can be dragged to reorder (future: drag to collections).
- **External files** dragged anywhere on the page triggers the upload flow — the entire viewport becomes a dropzone with a full-screen overlay: `"Drop to add to library"` in `Instrument Serif`.
- **Full-page dropzone overlay**: `--surface-0` at 90% opacity, centered text, teal dashed border around the viewport edge.

### 8.3 Right-Click Context Menu

On image right-click in the grid:
```
┌────────────────────────┐
│ Transfer Style      S  │
│ Transfer Pose       P  │
│ Replace Character   R  │
│ ─────────────────────  │
│ Copy Prompt         C  │
│ Download Image         │
│ Add to Collection   →  │
│ ─────────────────────  │
│ View Details           │
│ Edit Tags              │
│ Delete                 │
└────────────────────────┘
```
- Custom context menu, not browser default.
- `--surface-3` background, `--border-default` border.
- Items: `--text-secondary`, hover: `--surface-4` + `--text-primary`.
- Keyboard shortcut hints right-aligned in `--text-ghost`.

### 8.4 Toast Notifications

Appear bottom-center of viewport, slide up from below:
```
┌──────────────────────────────────────┐
│  ✓  Prompt copied to clipboard       │
└──────────────────────────────────────┘
```
- `--surface-3` background, `--border-subtle` border
- Small (max-width 360px), pill-shaped (full radius)
- Success icon: `--status-success`. Error icon: `--status-error`.
- Auto-dismiss after 3s. Slide down to exit.
- Stack from bottom if multiple.

---

## 9) Loading & Skeleton States

### Grid Loading
- Show 12 skeleton placeholders in the masonry layout.
- Each skeleton: `--surface-1` background with shimmer animation.
- Vary heights randomly (200px–400px) to simulate natural masonry.
- Stagger the shimmer animation by index for visual flow.

### Image Loading (in card)
- Show `--surface-1` background.
- Subtle shimmer gradient sweeps left-to-right.
- Small image icon centered, `--text-ghost`, 24px.
- On load: fade in from `opacity 0→1, 300ms`.

### Panel/Modal Loading
- Content area shows 3 skeleton text lines (varying widths: 100%, 80%, 60%).
- Pulse animation on skeleton blocks.

### AI Workspace Streaming
- Cursor-style blinking indicator at the end of the streaming text.
- Text appears character by character (or chunk by chunk from SSE).
- Status steps animate from `○` (pending) to `●` (active, pulsing) to `✓` (done, --status-success).

---

## 10) Responsive Strategy

Desktop-first. This is a workstation tool, not a mobile app.

| Breakpoint | Behavior |
|------------|----------|
| `≥1440px` | Full experience. 5-col grid. Workspace panel pushes content. |
| `≥1024px` | 4-col grid. Workspace panel overlays (doesn't push). |
| `≥768px` | 3-col grid. Tag rail scrolls. Detail view is full-screen. |
| `≥480px` | 2-col grid. Top bar collapses to hamburger + logo. Tag rail becomes a single "Filters" button that opens a bottom sheet. |
| `<480px` | Not optimized. Show a "Best on desktop" message. Basic grid still works. |

---

## 11) Accessibility Requirements

- **Color contrast**: All text passes WCAG 2.1 AA against its background. `--text-primary` on `--surface-0` = 14.5:1 (passes AAA). `--text-secondary` on `--surface-0` = 7.1:1 (passes AA).
- **Focus indicators**: All interactive elements have visible focus rings (`box-shadow: 0 0 0 2px var(--accent-primary)`). Focus rings are ONLY visible on keyboard navigation (`:focus-visible`).
- **ARIA labels**: All icon buttons have `aria-label`. Image cards have `alt` text from prompt. Modal has `role="dialog"` + `aria-labelledby`.
- **Keyboard navigation**: Full app navigable via keyboard. Tab order follows visual layout. Escape closes overlays. Arrow keys work in grids and lists.
- **Reduced motion**: `@media (prefers-reduced-motion: reduce)` disables all animations, replaces with instant state changes.
- **Screen reader**: Gallery announces "Image gallery, N images" on load. Filter changes announce "Filtered to N images with tags: X, Y, Z".

---

## 12) Visual Hierarchy Rules

1. **Level 0 — Canvas**: `--surface-0`. The grid, the background. Always receding.
2. **Level 1 — Content**: Images, prompt text, primary data. Maximum contrast against canvas.
3. **Level 2 — Controls**: Buttons, inputs, tags. Visible but subordinate to content.
4. **Level 3 — Chrome**: Navigation, labels, metadata. Lowest contrast. Disappears when you're not looking for it.
5. **Level 4 — Overlays**: Modals, panels, popovers. Elevated via blur + shadow. Always temporary.

**Rule**: Never let Level 3 (chrome) compete with Level 1 (content). If the eye goes to the navigation before the images, the hierarchy is broken.

---

## 13) Technical Implementation Notes

### Font Loading
- Load `Instrument Serif` and `Geist` via `next/font/google` and `next/font/local` respectively.
- Use `font-display: swap` for body text, `font-display: optional` for display text (avoid layout shift for non-critical).
- Preload the `Geist` 400 and 500 weights (most used).

### CSS Architecture
- Continue using Tailwind CSS v4 with CSS variables.
- All new tokens defined in `app/globals.css` under `:root`.
- Component-specific animations defined in globals via `@keyframes`.
- Use `@layer components` for reusable patterns (tag-chip, action-card, etc.).

### Image Optimization
- Continue using `next/image` with `unoptimized` for Convex-served images.
- Thumbnails: 520px width (existing). Consider adding 260px for grid thumbnails.
- Full-res: loaded on-demand in detail view only.
- Blurhash: investigate adding blurhash to asset records for instant placeholder colors.

### State Management
- Filter state (selected tags): URL search params (`?tags=portrait,dark,moody`). This makes filtered views shareable/bookmarkable.
- Workspace panel state: local React state (ephemeral per session).
- Image detail view: URL route (`/image/[id]`) for deep-linking.

### View Transitions
- Use the View Transitions API (`document.startViewTransition`) for image detail open/close.
- Fallback: CSS `opacity` + `transform` transition for browsers without support.
- Assign `view-transition-name` dynamically to the clicked image card.

---

## 14) Pages & Routes

| Route | Page | Description |
|-------|------|-------------|
| `/` | Gallery | Main masonry grid with tag rail. Default view. |
| `/image/[id]` | Image Detail | Full-screen image view with actions. |
| `/library` | Library | Table/list view of all assets with advanced filtering. |
| `/characters` | Characters | Saved character profiles with thumbnails and metadata. |
| `/palettes` | Palettes | Palette list — grid of project color palettes. |
| `/palettes/[id]` | Palette Editor | Two-column editor with swatch manager + palette agent panel. |
| `/sign-in` | Sign In | WorkOS AuthKit sign-in flow. |
| `/sign-up` | Sign Up | WorkOS AuthKit sign-up flow. |
| `/callback` | Auth Callback | OAuth callback handler. |

---

## 15) Signature Moments (The 11-Star Details)

These are the micro-interactions that make users say "wow":

1. **Tag magnetism**: When you activate a filter tag in the dropdown, the pill visually "flies" from the dropdown to the active tag zone in the rail. Subtle arc trajectory.

2. **Grid breathing**: When filters change, images don't just swap — they crossfade. Outgoing images fade out (100ms), incoming images stagger fade in (50ms per item).

3. **Copy confirmation**: When you copy a prompt, the entire prompt text briefly highlights with a teal sweep animation (left-to-right, 300ms) before the toast appears.

4. **Streaming cursor**: The AI workspace streaming text has a custom cursor — a thin teal vertical bar that blinks and advances. It feels like watching a human type.

5. **Image entrance**: First-time images in the grid enter with a very subtle `scale(0.98)→1` + `opacity(0)→1`. Not enough to be "animated" — just enough to feel alive.

6. **Empty grid personality**: When no images match the current filters, the empty state shows the active filter tags as floating, slowly drifting pills over a very subtle grid pattern. Text reads: "Nothing here yet. Try loosening your filters."

7. **Workspace panel memory**: If you close the workspace panel and reopen it, it remembers your last run and shows the output. The user never loses their work.

8. **Keyboard hint**: On first use, a subtle bottom-bar appears: "Press ⌘K for quick actions · / to search tags · ? for all shortcuts". Fades after 10 seconds. Never shows again.

9. **Drag glow**: When dragging a file over the page, the entire viewport edge glows with a subtle teal border animation (breathing pulse). The dropzone isn't a small box — it's the entire window.

10. **Action confirmation**: After triggering "Transfer Style" and the run completes, the workspace panel's header briefly flashes with a `--status-success` glow, and the action label changes from "Transfer Style" to "Style Package Ready".

---

## 16) Color Palette Creator

### Purpose

Every project needs visual consistency. When an AI model generates 10 images for the same brand/character/campaign, the colors drift unless explicitly constrained. The Color Palette Creator is a dedicated workspace where users define, extract, and refine project-level color palettes that are automatically injected into every prompt package — ensuring every generated image stays on-brand.

**Why this matters**: Without a palette constraint, "dark moody portrait" can produce wildly different color temperatures across runs. With a palette, the agent adds precise color direction (`dominant: #1a1a2e deep navy, accent: #e94560 warm coral, skin: #ffd6a5 warm peach`) to every prompt, producing cohesive sets.

### Agent Architecture

The Color Palette Creator is backed by a **dedicated Agent SDK agent** — separate from the prompt construction agent.

**Palette Agent responsibilities**:
- **Extract**: Analyze uploaded reference images and extract dominant/accent/background color clusters using vision capabilities.
- **Harmonize**: Given a partial palette (e.g., user picks 2 colors), suggest complementary/analogous/triadic fills that create a harmonious set.
- **Name**: Generate human-readable, evocative names for each color swatch ("Midnight Ink", "Coral Ember", "Bone White") — not just hex codes.
- **Contextualize**: Assign usage roles to each color (background, accent, skin tone, clothing, lighting, environment) so the prompt agent knows *where* to apply each color.
- **Adapt**: Given a palette + a reference image, suggest palette adjustments to match the mood of the reference.

**Agent runtime**: Runs via Agent SDK worker (same infrastructure as prompt construction agent). Separate agent definition with its own system prompt and tool set. Uses vision model for image analysis.

### Route & Navigation

- **Route**: `/palettes` — accessible from the TopBar navigation.
- **TopBar update**: Add "Palettes" as a fourth nav item: `Gallery | Library | Characters | Palettes`.

### Page Layout — Palette List

```
┌─────────────────────────────────────────────────────────────────────┐
│  TopBar                                                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  YOUR PALETTES                              [ + New Palette ]       │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │ ████████████████ │  │ ████████████████ │  │ ████████████████ │  │
│  │ Midnight Studio  │  │ Summer Editorial │  │ Neon Brutalist   │  │
│  │ 6 colors · Active│  │ 5 colors         │  │ 4 colors         │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

- Grid of palette cards (3 columns on desktop, 2 on tablet, 1 on mobile).
- Each card: horizontal color bar (all swatches side by side), palette name, swatch count, "Active" badge if it's the current project palette.
- Card hover: subtle lift (`translateY(-2px)`) + `--border-strong`.
- Click a card → opens the palette editor.
- "+ New Palette" button: primary style, top-right.

### Palette Editor (Full Page)

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Back to Palettes          Midnight Studio          [ Set Active ]│
├────────────────────────────────┬────────────────────────────────────┤
│                                │                                    │
│   ┌────────────────────────┐   │   PALETTE AGENT                    │
│   │                        │   │                                    │
│   │  ████  ████  ████      │   │   What kind of palette do you      │
│   │  ████  ████  ████      │   │   want to create?                  │
│   │                        │   │                                    │
│   │  [ large swatch grid ] │   │   ○ Extract from images            │
│   │                        │   │   ○ Build from scratch             │
│   │                        │   │   ○ Adapt an existing palette      │
│   └────────────────────────┘   │                                    │
│                                │   ┌──────────────────────────┐     │
│   SWATCHES                     │   │ Drop reference images    │     │
│                                │   │ here to extract colors   │     │
│   ┌──────┐ Midnight Ink        │   └──────────────────────────┘     │
│   │██████│ #1a1a2e             │                                    │
│   │██████│ Background          │   [ Generate Palette → ]           │
│   └──────┘                     │                                    │
│                                │                                    │
│   ┌──────┐ Coral Ember         │                                    │
│   │██████│ #e94560             │                                    │
│   │██████│ Accent              │                                    │
│   └──────┘                     │                                    │
│                                │                                    │
│   ┌──────┐ Bone White          │                                    │
│   │██████│ #faf0e6             │                                    │
│   │██████│ Skin Tone           │                                    │
│   └──────┘                     │                                    │
│                                │                                    │
│   [ + Add Color ]              │                                    │
│                                │                                    │
├────────────────────────────────┴────────────────────────────────────┤
│  PREVIEW — How this palette affects generation                      │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                               │
│  │ ref  │ │ ref  │ │ ref  │ │ ref  │  (recent gallery images        │
│  │ img  │ │ img  │ │ img  │ │ img  │   tinted with palette overlay) │
│  └──────┘ └──────┘ └──────┘ └──────┘                               │
└─────────────────────────────────────────────────────────────────────┘
```

**Two-column split layout**:

**Left column — Swatch Editor**:
- **Large swatch grid** at top: all colors displayed as large rectangles side by side. Visual preview of the full palette. Click a swatch to select it for editing.
- **Swatch list** below: each swatch is a row with:
  - Color preview square (48px, rounded-lg)
  - Name (editable inline, `Geist`, `--text-primary`)
  - Hex code (`Geist Mono`, `--text-tertiary`, click-to-copy)
  - Role tag pill (`Background`, `Accent`, `Skin Tone`, `Clothing`, `Lighting`, `Environment`)
  - Delete icon (on hover only)
- **"+ Add Color"** button at bottom: opens a color picker popover.
- **Color picker**: Native color input + manual hex input + eyedropper (if available). `--surface-3` popover.
- **Drag to reorder** swatches (changes visual priority in the palette).

**Right column — Palette Agent Panel**:
- Chat-style interface with the dedicated Palette Agent.
- Agent offers three starting modes:
  1. **Extract from images**: User drops reference images → agent analyzes and proposes a palette.
  2. **Build from scratch**: User describes a mood/brand → agent suggests colors.
  3. **Adapt existing**: User selects a reference image → agent adjusts current palette to match.
- **Image dropzone**: Dashed border zone for dragging reference images into the agent.
- **"Generate Palette →"** button: primary style. Triggers the agent run.
- **Agent output**: Streams in as swatch proposals. Each proposed color appears as an interactive accept/reject/modify card.
- **Streaming UX**: Same blinking teal cursor + status steps as the main AI workspace.

**Bottom section — Preview**:
- Shows 4 recent gallery images with a subtle color overlay demonstrating how the palette would affect generation.
- Semi-transparent wash over each thumbnail using the palette's dominant color.
- Label: "How this palette guides generation" — purely illustrative.

### Swatch Data Model

```typescript
interface PaletteSwatch {
  id: string;
  hex: string;              // "#1a1a2e"
  name: string;             // "Midnight Ink"
  role: PaletteRole;        // "background" | "accent" | "skin" | "clothing" | "lighting" | "environment" | "custom"
  opacity?: number;         // 0–100, default 100
  notes?: string;           // Free text, e.g. "Use for deep shadows"
  order: number;            // Display/priority order
}

type PaletteRole = "background" | "accent" | "skin" | "clothing" | "lighting" | "environment" | "custom";

interface Palette {
  // Convex document fields
  name: string;             // "Midnight Studio"
  swatches: PaletteSwatch[];
  isActive: boolean;        // Only one palette active per user
  sourceAssetIds?: string[];// IDs of images used to extract this palette
  userId: string;
  createdAt: number;
  updatedAt: number;
}
```

### How the Palette Feeds into Generation

When the active palette exists and a user triggers any "aha" action (Transfer Style / Transfer Pose / Replace Character):

1. The prompt construction agent receives the active palette as structured context.
2. The agent injects color direction into the prompt package:
   ```
   COLOR PALETTE CONSTRAINT:
   - Dominant/Background: Midnight Ink (#1a1a2e) — deep navy, use for shadows and background depth
   - Accent: Coral Ember (#e94560) — warm coral, use for highlights, lips, accessories
   - Skin: Bone White (#faf0e6) — warm peach, use for skin tones
   - Environment: Storm Gray (#2d3436) — cool gray, use for architectural/environmental surfaces

   Apply these colors consistently. Do not introduce colors outside this palette
   unless explicitly needed for realism.
   ```
3. This constraint travels with the prompt package — whether the user exports it or executes in-app.

### Palette Agent Tool Definitions

| Tool | Description |
|------|-------------|
| `analyze_image_colors` | Accepts image reference, returns extracted color clusters with dominance percentages |
| `suggest_harmonious_colors` | Given 1–3 seed colors, returns harmonious completions (complementary, analogous, triadic, split-complementary) |
| `name_color` | Given a hex code, returns an evocative human-readable name |
| `assign_role` | Given a color + context description, suggests the best palette role |
| `save_palette` | Persists palette to Convex `palettes` table |
| `update_swatch` | Modifies a specific swatch in a palette |

### User Flows

**Creating a palette from images**:
1. User clicks "+ New Palette" → editor opens with empty swatch list.
2. User drags 3–5 reference images into the agent dropzone.
3. Agent analyzes images, extracts color clusters, proposes 5–7 swatches.
4. Each proposed swatch streams in as an interactive accept/reject card.
5. User accepts the ones they like → swatches populate the left column.
6. User can manually adjust names, roles, hex values.
7. User clicks "Set Active" → palette is injected into all future prompt packages.

**Creating a palette manually**:
1. User clicks "+ Add Color" repeatedly, picks colors via picker.
2. For each swatch: assigns a name and role.
3. Optionally asks the agent: "Suggest 3 more colors that complement these."
4. Agent streams suggestions as interactive cards.

**Using the palette during generation**:
1. User is on Gallery, clicks "Transfer Style" on an image.
2. Prompt construction agent detects an active palette.
3. Agent includes the palette constraint block in the output prompt package.
4. User sees the palette colors referenced in the output (visually indicated).
5. Generated images respect the color constraints.

### Keyboard Shortcuts (Palette Editor)

| Shortcut | Action |
|----------|--------|
| `N` | Add new swatch |
| `Delete` | Remove selected swatch |
| `A` | Set palette as active |
| `⌘Enter` | Trigger agent generation |
| `Escape` | Close color picker / back to list |

### Empty State

```
[Color wheel icon — thin line, teal-tinted]

"Define your visual language"              ← Instrument Serif, --text-xl
Create a color palette to keep every       ← Geist, --text-sm, --text-secondary
generated image consistent with your brand.

[ Create First Palette ]                   ← Primary button
```

### Palette Card Component

```
┌─────────────────────────────────────────┐
│ ██████ ██████ ██████ ██████ ██████      │  ← Color bar (swatches, equal width, flush)
│                                         │
│ Midnight Studio                         │  ← Name: Geist, 15px, --text-primary
│ 6 colors · Active                       │  ← Meta: Geist, 11px, --text-tertiary
│                                         │     "Active" badge in --teal-9 if active
└─────────────────────────────────────────┘
```

- Background: `--surface-1`
- Border: `1px solid var(--border-subtle)`
- Hover: border → `--border-default`, `translateY(-2px)`, subtle shadow
- Active badge: teal pill, `--accent-subtle` background, `--teal-9` text
- Radius: `16px`
- Color bar: rounded top corners matching card radius, no gap between swatches

### Agent Swatch Proposal Card

When the agent proposes a color, it appears as an interactive card in the agent panel:

```
┌────────────────────────────────────────────────┐
│  ████  Midnight Ink                            │
│        #1a1a2e · Background                    │
│        "Deep navy for shadows and depth"       │
│                                                │
│  [ Accept ]  [ Modify ]  [ Skip ]              │
└────────────────────────────────────────────────┘
```

- Large color swatch on left (40px square, `rounded-lg`).
- Name + hex + role + agent notes.
- Accept: adds swatch to palette with `animate-tag-enter`.
- Modify: opens color picker pre-filled with proposed hex.
- Skip: dismisses card with fade-out.
- Card background: `--surface-2`, border `--border-default`.
