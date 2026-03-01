# Laniameda Design System

> The portable brand language for **laniameda** — a warm editorial aesthetic for creative AI tools.

This folder is the **single source of truth** for visual identity across all laniameda projects. Drop it into any new repo and use it to stay on-brand.

---

## Quick Start

1. Copy `tokens.css` into your project's global stylesheet (or `@import` it)
2. Reference `tokens.json` for tooling integration (Figma plugins, Storybook, etc.)
3. Read the docs below for usage guidance

## Contents

| File | What it covers |
|------|---------------|
| [`00-overview.md`](./00-overview.md) | Brand identity, visual philosophy, atmosphere |
| [`01-colors.md`](./01-colors.md) | Full color palette, semantic roles, pillar theming |
| [`02-typography.md`](./02-typography.md) | Font families, type scale, usage rules |
| [`03-spacing-layout.md`](./03-spacing-layout.md) | Spacing scale, grid system, breakpoints, dimensions |
| [`04-elevation-shadows.md`](./04-elevation-shadows.md) | Shadow system, depth hierarchy, glass surfaces |
| [`05-motion.md`](./05-motion.md) | Timing tokens, easing curves, animation keyframes |
| [`06-components.md`](./06-components.md) | Buttons, cards, pills, panels, navigation, inputs |
| [`07-iconography.md`](./07-iconography.md) | Icon library, sizing conventions, usage patterns |
| [`08-accessibility.md`](./08-accessibility.md) | Focus rings, reduced motion, scrollbar, selection |
| [`tokens.css`](./tokens.css) | Portable CSS custom properties (copy into any project) |
| [`tokens.json`](./tokens.json) | Machine-readable design tokens (W3C-compatible) |

## Tech Context (Origin Project)

- **Framework**: Next.js (App Router) + TypeScript
- **Styling**: Tailwind CSS v4 + CSS custom properties
- **Icons**: Lucide React
- **Fonts**: Geist Sans, Geist Mono, Instrument Serif (display)
- **Components**: Custom (CVA-based variants, no heavy UI library dependency)

## Design Philosophy in One Sentence

> Warm paper surfaces, ink-dark text, coral accents — a studio console that lets content be the hero.

---

*Last updated: 2026-03-01*
