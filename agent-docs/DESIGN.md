# Design System & UI Direction

Last updated: 2026-02-01

## Product UI Summary (PM View)
We are running a dark, gallery-first interface optimized for creative people. The visual language is editorial + luxury: quiet, cinematic surfaces, high-contrast text, and a single warm accent for primary actions. The UI prioritizes content density (small type, tight controls) and reduces chrome so imagery remains the hero, while still feeling smooth and modern.

This is a deliberate “studio console” aesthetic with refinement over flash. It should feel expensive, precise, and calm.

## Current Theme Identity
- **Audience**: Creative professionals; visually literate users.
- **Mode**: Dark-only (no light mode planned yet).
- **Workspace**: Single workspace for now.
- **Palette**: Low-saturation blue/graphite surfaces with a warm, orange-red accent.
- **Contrast**: High contrast for primary text; muted midtones for metadata.
- **Tone**: Editorial + luxury; content-focused, minimal chrome, smooth transitions.
- **Shape language**: Mostly sharp corners (many components use `rounded-none`), even though base radius tokens exist.
- **Density**: Compact; most UI controls are `h-7`/`h-8` with `text-xs`.

## Design Tokens (Current)
Source of truth:
- `tailwind.config.ts` (token values)
- `app/globals.css` (CSS variables + theme mapping)

Key tokens:
- **Background**: `oklch(0.12 0.01 260)`
- **Surface/Card**: `oklch(0.16 0.01 260)`
- **Primary Accent**: `oklch(0.70 0.18 20)` (warm orange-red)
- **Border**: `oklch(0.28 0.01 260)`
- **Muted Text**: `oklch(0.55 0 0)`
- **Radius base**: `--radius: 0.5rem` (but many components override to squared)

Token families are already defined for:
- `background`, `foreground`, `primary`, `secondary`, `muted`, `accent`, `destructive`
- `border`, `input`, `ring`
- `chart-1`..`chart-5`
- `sidebar` tokens (unused today, but ready)

## Typography
Current stack:
- `Manrope`, `Sora`, `Inter` fallback.

Usage pattern:
- Uppercase micro-labels with wide tracking (`tracking-[0.3em]` to `0.5em`).
- Compact sizes (`text-[10px]` to `text-sm`), typically `text-xs`.
- Headlines are simple, low-weight, minimal ornamentation.

## Common Design Language (Shared Vocabulary)
This is the style system we should carry across all new screens:
- **Materials**: Dark, low-chroma surfaces; soft overlays; subtle blur and glass-like layers.
- **Light & shadow**: Minimal elevation; thin outlines and soft shadows instead of heavy cards.
- **Color behavior**: One primary accent; no competing secondary accents.
- **Type**: Editorial labels (uppercase, tracked); restrained body sizes; no oversized UI chrome.
- **Rhythm**: Tight spacing; consistent gaps; deliberate negative space around hero content.
- **Motion**: Smooth, low-friction transitions; avoid busy micro-animations.
- **Iconography**: Minimal, thin-line icons; use sparingly as supportive cues.
- **Imagery**: High contrast, sharp detail; keep the grid clean and cinematic.
- **Interaction tone**: Quiet confidence—no loud hover states, no neon effects.

## Motion & Effects
Motion is subtle and utility-first:
- `tw-animate-css` for component-level animation helpers.
- A custom shimmer keyframe for image loading skeletons.
- Focused on hover and subtle transitions; no large-scale page motion.

## Layout & Surfaces
Structural patterns used today:
- **Sticky header** (filter/tabs).
- **Masonry grid** for assets (gallery-first).
- **Side filter sheet** (overlay + blur).
- **Modal** for detail view (image focus).
- **Manual ingest panel** with dense fields and dashed dropzones.

Surfaces use `bg-background` and `bg-secondary` with low opacity overlays and subtle borders, creating a layered, quiet feel without high contrast blocks.

## Component Library & UI Tech
Current system:
- **Tailwind CSS v4** for styling and tokens (`@theme` inline with CSS variables).
- **shadcn/ui** base styles (`shadcn/tailwind.css`) and custom `components/ui/*`.
- **Radix primitives** (via shadcn and `radix-ui` dependency).
- **Icons**: `lucide-react`, `@hugeicons/react`.
- **Animations**: `tw-animate-css`.

This is a **hybrid utility + component system**: tokens are centralized, but the UI layer is mostly Tailwind classes and custom component wrappers.

## Component System Capabilities (What We Can Do Now)
We already have building blocks for:
- Buttons, inputs, textareas, badges, dropdowns, selects, comboboxes
- Dialogs, tables, cards
- A consistent form field pattern (labels, helper text, error states)
- Grid/list layouts and modals

This means we can scale the interface without bringing in a new UI framework if we stay within the current aesthetic.

## Design System Options (PM-Level Choices)
Below are the realistic paths, in increasing scope.

### Option A — Refine Current System (Lowest Risk)
Keep Tailwind + shadcn/ui, but formalize the token usage.
- Define a type scale (xs/sm/md/lg) and spacing scale usage by component.
- Align all components to the same radius/shape language (sharp vs rounded).
- Add consistent elevation tokens (shadows or outlines).
Impact: fast, minimal refactor, preserves velocity.

### Option B — Multi-Theme Tokens (Future)
Stay with the same system, but introduce multiple theme maps.
- Add a light theme or branded theme when needed.
- Use CSS variables to swap token sets (no component rewrite).
Impact: moderate, very scalable brand expression.

### Option C — Component-First Design System
Lean into shadcn/ui as a formal design system.
- Establish canonical variants (primary, ghost, subtle, danger).
- Move repeated class patterns into `components/ui/*` variants.
Impact: cleaner, more consistent UI with faster assembly.

### Option D — Switch to a Full UI System (Largest Scope)
Adopt a packaged system (Radix Themes, Mantine, Chakra) to enforce structure.
- Gains: faster prototyping, built-in accessibility and theming.
- Costs: heavier refactor, style mismatch with the current visual language.
Impact: highest scope; only worth it if we want a dramatic shift in process.

## How We Would Change the Design System (Practical Steps)
The current system is token-driven, so we can change the look without rewriting UI.

Primary levers:
1. **Palette + tone**  
   Update `tailwind.config.ts` and `app/globals.css` tokens (background, surfaces, primary).
2. **Shape language**  
   Normalize `rounded-none` vs `rounded-*` in `components/ui/*`.
3. **Density & scale**  
   Standardize control heights (`h-8`, `h-9`, `h-10`) and typography sizes.
4. **Component variants**  
   Expand `cva` variants in `components/ui/*` for consistent usage.
5. **Motion**  
   Add a single page-load and panel transition sequence for polish.

Recommended order if we choose to evolve:
- Lock the token palette + radius.
- Normalize button/input/form styles.
- Apply the style to high-traffic screens (gallery, modal, upload).

## AI Agent UX Foundations (Design-First)
To make the product feel like a trustworthy creative AI tool, we should standardize these UI patterns:
- **Run objects**: Every agent operation becomes a visible “run” with inputs, tools, outputs, and artifacts.
- **Provenance**: Show source and timestamp beneath agent outputs and assets.
- **Status language**: Consistent “Thinking / Running Tool / Waiting” chip styles.
- **Confidence cues**: Warnings for low confidence or unresolved steps.
- **History & memory**: Surface recent runs and saved prompts as first-class UI.

## Suggested Direction (Now)
- Choose **Option A** now to refine the current system without slowing delivery.
- Keep **dark-only** and **single workspace** in scope for MVP.
- Begin implementing the **AI Agent UX Foundations** on new features immediately.

## Component Rules (Editorial + Luxury)
Use these rules as the shared system for all new UI work.

### Buttons
- **Primary**: warm accent fill, minimal shadow, medium weight, no gradients.
- **Secondary**: low-contrast surface fill, subtle border.
- **Ghost**: no fill, hover only; avoid loud color shifts.
- **Sizes**: default height `h-9`, compact `h-8`, avoid extra tall.
- **Shape**: squared or gently rounded, consistent across all buttons.

### Inputs & Textareas
- **Background**: muted surface, no strong borders; use thin outline on focus.
- **Text**: `text-xs` to `text-sm` only; avoid large input type.
- **Placeholder**: low-contrast, never brighter than metadata text.
- **Spacing**: internal padding consistent with button height.

### Tags / Chips / Status
- **Status chips**: single-line, uppercase or small caps feel.
- **Colors**: one accent for “active/primary”; neutral for all else.
- **Density**: very compact; no pill monsters.

### Cards / Tiles
- **Surface**: subtle separation using border and shadow, not heavy fills.
- **Padding**: consistent 16–24px; avoid mixed padding sizes within a card.
- **Corners**: same radius as buttons/inputs.

### Modals / Sheets
- **Backdrop**: dark blur overlay, not pure black.
- **Frame**: soft border with muted shadow; avoid heavy elevation.
- **Close actions**: top-right icon, quiet hover state.

### Tables & Lists
- **Row height**: compact; keep typography small.
- **Header**: muted, uppercase or tracked labels.
- **Dividers**: thin, low-contrast; no zebra striping unless required.

### Empty States
- **Tone**: calm and encouraging, not playful.
- **Content**: one short headline + one sentence + one action.

### Navigation & Tabs
- **Tabs**: quiet, text-first; emphasize active with weight + subtle underline or contrast.
- **Sidebars**: low contrast, content-focused, no bright separators.

### Motion
- **Hover**: minimal, 100–200ms; avoid bounce.
- **Open/close**: soft fade + slight scale.
- **Loading**: shimmer or subtle pulse only; no spinners unless blocking.

If the goal is to create a distinct brand identity:
- Choose **Option B** (multi-theme tokens) immediately.
