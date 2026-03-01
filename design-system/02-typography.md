# 02 — Typography

## Philosophy

Typography follows an **editorial print** hierarchy: a humanist serif for display moments, a clean geometric sans for body text, and a technical monospace for labels and data. The combination evokes a high-end art catalogue with a modern digital backbone.

---

## Font Families

### 1. Geist Sans — Body & UI Text

- **Source**: Vercel Geist font family
- **CSS variable**: `--font-sans`
- **Fallback stack**: `system-ui, -apple-system, sans-serif`
- **Character**: Clean, geometric, highly legible at small sizes. Neutral enough to recede behind content.
- **Use**: All body text, navigation labels, form inputs, metadata, descriptions

### 2. Geist Mono — Labels & Data

- **Source**: Vercel Geist Mono
- **CSS variable**: `--font-mono`
- **Fallback stack**: `ui-monospace, monospace`
- **Character**: Technical, precise, industrial. Evokes command-line interfaces and engineering readouts.
- **Use**: Section labels (uppercase), counters, timestamps, badge text, button labels (brutalist variants), model names, vault stats

### 3. Instrument Serif — Display & Hero

- **Source**: Google Fonts (`Instrument_Serif`, weight 400)
- **CSS variable**: `--font-display`
- **Fallback stack**: `Georgia, "Times New Roman", serif`
- **Character**: Warm, editorial, slightly calligraphic. Brings humanity and craft to headlines.
- **Use**: Hero text, empty state messages, sheet headers, brand wordmark. **Always used in italic** for display moments.
- **Loading**: `display: swap`, Latin subset only

---

## Type Scale

A fixed 7-tier scale. **No font sizes outside this scale.** No hardcoded `px` values in components.

| Tier | CSS Token | Size | Line Height | Use |
|------|-----------|------|-------------|-----|
| **micro** | `--text-micro` | 10px | 1.4 | Section labels, uppercase mono tracking (0.4em). Applied via `.text-micro` utility class |
| **xs** | `--text-size-xs` | 11px | ~1.4 | Badges, timestamps, sidebar labels, nav items, vault stats, model counts |
| **sm** | `--text-size-sm` | 13px | ~1.5 | Body text, button labels, tag pills, navigation items, form labels |
| **base** | `--text-size-base` | 15px | ~1.6 | Primary content text, descriptions, detail panel body |
| **lg** | `--text-size-lg` | 18px | ~1.5 | Section headings, sheet titles, panel headers |
| **xl** | `--text-size-xl` | 24px | ~1.3 | Page headings, major section titles |
| **display** | `--text-size-2xl` / `--text-size-3xl` | 32–48px | ~1.2 | Hero text, empty state messages (Instrument Serif italic) |

---

## Weight System

| Weight | Value | Use |
|--------|-------|-----|
| **Regular** | 400 | Body text, descriptions, standard content |
| **Medium** | 500 | Navigation labels, tag pills, interactive text, mono labels |
| **Semibold** | 600 | Active nav items, selected tags, usernames, stat values |
| **Bold** | 700 | Sparingly — only for maximum emphasis headings |

---

## Letter Spacing

Letter spacing is a key part of the brutalist-editorial hybrid identity.

| Context | Tracking | Example |
|---------|----------|---------|
| **Micro labels** | `0.4em` | `VAULT STATS`, section headers |
| **Uppercase mono labels** | `0.12em–0.22em` | Button text, tag labels, sidebar categories |
| **Active nav items** | `0.1em` | Wider than inactive (`0.08em`) for emphasis |
| **Standard text** | Normal | Body, descriptions, prompts |
| **Brand wordmark** | `-0.01em` | Slightly tightened for elegance |

---

## Text Transform Patterns

| Pattern | Where |
|---------|-------|
| `uppercase` | All mono labels, section headers, button text, nav items, badge text, model names |
| `italic` | Display/hero text (Instrument Serif), brand suffix ("Gallery"), sheet headers |
| Normal case | Body text, prompts, descriptions, user content |

---

## Responsive Behavior

The type scale is **fixed** — it does not change at breakpoints. The editorial aesthetic relies on consistent proportions. Layout density changes (column counts, sidebar collapse) handle responsive adaptation instead.

---

## Anti-aliasing

```css
body {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

Applied globally via Tailwind's `antialiased` class on `<body>`.

---

## Usage Examples

### Section Label (Micro)
```css
font-size: var(--text-micro);      /* 10px */
font-family: var(--font-mono);
font-weight: 600;
text-transform: uppercase;
letter-spacing: 0.22em;
color: var(--text-tertiary);
```

### Sidebar Nav Item
```css
font-size: 11px;                   /* xs tier */
font-family: var(--font-mono);
font-weight: 500;                  /* 600 when active */
text-transform: uppercase;
letter-spacing: 0.08em;            /* 0.1em when active */
```

### Card Badge (Model Name)
```css
font-size: 9px;
font-family: var(--font-mono);
font-weight: 500;
text-transform: uppercase;
letter-spacing: wider;
```

### Display / Hero Text
```css
font-family: var(--font-display);  /* Instrument Serif */
font-style: italic;
font-size: var(--text-size-2xl);   /* 32px or larger */
color: var(--text-primary);
```

---

## Rules

- ❌ No font sizes outside the 7-tier scale
- ❌ No hardcoded `px` sizes in components — use CSS tokens
- ❌ No sans-serif for display/hero text — always use `--font-display`
- ❌ No serif for UI labels — always use `--font-mono` or `--font-sans`
- ✅ Mono labels are **always uppercase** with intentional letter-spacing
- ✅ Display text is **always italic** Instrument Serif
- ✅ Body text uses **Geist Sans** at regular (400) or medium (500) weight
