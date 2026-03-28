# Designs Pillar — Skills & Workflows Library

> The designs pillar is NOT an image gallery. It's a design skills/workflows/tools reference library with visual references attached.

Last updated: 2026-03-26

---

## 1. Problem

The designs pillar currently renders identically to creators/cars/dump — masonry grid of image cards. But design content isn't "pretty pictures to scroll." It's:

- **Workflows**: "How to build a scroll-driven animation"
- **Tool references**: "Use GSAP ScrollTrigger for this effect"
- **Visual references**: Screenshots/iframes of websites/components I like
- **Agent-ready prompts**: One-click copy to paste into Claude/agent

A masonry grid doesn't surface any of this. The designs pillar needs its own view.

---

## 2. User Story

> I want to create a scroll-driven animation. I open the designs pillar. I see a card called "Scroll-Driven Parallax Hero" with a screenshot of the effect. I click it — a fullscreen modal opens showing the workflow steps, tools used, a reference screenshot, and a one-click copyable agent prompt. I copy the prompt, paste it into Claude, and it knows exactly how to build it.

---

## 3. Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Expand behavior | **Fullscreen modal** | Not inline accordion, not separate page. Modal keeps context. |
| Default view | **Structured card grid** | Not masonry. Cards are title+tools+summary dominant, not image dominant. |
| Content unit | **Skill/workflow card** | Not individual images. The card IS the design reference. |
| Agent prompt | **Illustrative for now** | Will evolve. Not the focus of Phase 1 frontend. |
| Data source | **`designInspirations` table** | Not `assets`. Assets are linked as visual references. |

---

## 4. Card Design — Collapsed (Grid View)

```
┌─────────────────────────────────┐
│  [screenshot / thumbnail]       │
│                                 │
├─────────────────────────────────┤
│  Scroll-Driven Parallax Hero    │  ← title
│                                 │
│  GSAP · ScrollTrigger · CSS     │  ← tool tags (prominent)
│                                 │
│  Pin hero section, map scroll   │  ← one-line summary
│  progress to parallax layers    │
│                                 │
│  stripe.com ↗                   │  ← source domain (if exists)
└─────────────────────────────────┘
```

**Card hierarchy:**
1. Visual reference (screenshot) — context, not content
2. Title — what this skill/technique is
3. Tool tags — what you'd use to build it
4. Summary — one-liner of what it achieves
5. Source domain — where you saw it

**Card sizing:** Larger than image pillar cards. ~300-360px wide. Fixed aspect ratio for the image portion, flexible text area below.

---

## 5. Fullscreen Modal — Expanded View

```
┌──────────────────────────────────────────────────────────┐
│  [×]                                          [Copy All] │
│                                                          │
│  SCROLL-DRIVEN PARALLAX HERO                             │
│  ════════════════════════════                             │
│                                                          │
│  ┌────────────────────────────────────────────┐          │
│  │                                            │          │
│  │     [large screenshot / iframe preview]    │          │
│  │                                            │          │
│  └────────────────────────────────────────────┘          │
│  source: stripe.com/sessions  ↗                          │
│                                                          │
│  ── TOOLS ────────────────────────────────────           │
│  ┌──────┐ ┌──────────────┐ ┌────────────────┐           │
│  │ GSAP │ │ ScrollTrigger │ │ CSS transforms │           │
│  └──────┘ └──────────────┘ └────────────────┘           │
│                                                          │
│  ── WHAT IT DOES ─────────────────────────────           │
│  Pin a hero section and map scroll progress to           │
│  translateY + opacity on parallax layers. Frame-         │
│  perfect sync with scrub: true.                          │
│                                                          │
│  ── WORKFLOW ─────────────────────────────────           │
│  1. Pin the hero section with ScrollTrigger              │
│  2. Map scroll progress to translateY + opacity          │
│  3. Use scrub: true for frame-perfect sync               │
│  4. Add will-change: transform for GPU acceleration      │
│                                                          │
│  ── AGENT PROMPT ─────────────────────────────           │
│  ┌──────────────────────────────────────────┐            │
│  │ Build a scroll-driven parallax hero      │  [📋 COPY] │
│  │ section using GSAP ScrollTrigger. Pin    │            │
│  │ the hero, map scroll progress to...      │            │
│  └──────────────────────────────────────────┘            │
│                                                          │
│  ── VISUAL REFERENCES ────────────────────────           │
│  [thumb] [thumb] [thumb]  ← linked assets/screenshots   │
│                                                          │
│  ── TAGS ─────────────────────────────────────           │
│  animation · scroll · parallax · hero · web              │
└──────────────────────────────────────────────────────────┘
```

**Modal sections (top to bottom):**

| Section | Content | Notes |
|---|---|---|
| Header | Title + close + "Copy All" button | |
| Visual reference | Large screenshot or iframe | The reference site/component |
| Source | Domain + link to original | Clickable ↗ |
| Tools | Tool tag chips (prominent) | What you'd use to build this |
| Summary | What this technique achieves | 2-3 sentences max |
| Workflow | Numbered steps | The "how to" — may be empty for simple references |
| Agent prompt | Copyable text block | One-click copy. Illustrative for now. |
| Visual references | Linked asset thumbnails | Optional — additional screenshots |
| Tags | Technique/category tags | Secondary to tool tags |

---

## 6. How Designs Pillar Differs From Other Pillars

| Aspect | Creators / Cars / Dump | Designs |
|---|---|---|
| Content unit | Image + prompt | Skill/workflow card |
| Grid type | Masonry (image-dominant) | Structured cards (title-dominant) |
| Card shows | Image, hover reveals prompt | Title, tools, summary, thumbnail |
| Expand to | Side panel | Fullscreen modal |
| Primary CTA | Copy prompt | Copy agent prompt |
| Data source | `assets` table | `designInspirations` table |
| Tags shown | Style, model, content type | Tools used, technique type |
| Source URL | Optional/minor | Prominent — "where I saw this" |
| Workflow steps | N/A | Core content |

---

## 7. Filter Bar — Designs-Specific

When pillar=designs, the filter bar adapts:

**Type chips** (from `inspirationType`):
- All · Website · Landing Page · Dashboard · Component · Mobile · Motion · Branding

**Platform chips:**
- All · Web · iOS · Android · Cross-platform

**Tool filter** (new — filter by tool tags):
- Searchable dropdown or chip row of tool names

**Sort:**
- Newest · A-Z · Most referenced

---

## 8. Data Model — What Needs to Change

Current `designInspirations` fields that map directly:
- `title` → card title
- `summary` → card summary + modal summary
- `sourceUrl` / `sourceDomain` → source link
- `inspirationType` → type filter chips
- `platform` → platform filter
- `assetId` → linked screenshot
- `tagIds` → technique tags

**New fields needed:**

| Field | Type | Purpose |
|---|---|---|
| `workflowSteps` | `string[]` | Numbered steps in the modal |
| `agentPrompt` | `string` | The one-click copy text |
| `toolNames` | `string[]` | Primary tools (GSAP, Figma, etc.) — displayed as prominent chips, filterable |

---

## 9. Frontend Components

| Component | Purpose |
|---|---|
| `DesignSkillCard` | Collapsed card for grid (thumbnail + title + tools + summary + source) |
| `DesignSkillModal` | Fullscreen modal with all sections |
| `DesignSkillGrid` | Structured card grid (replaces masonry when pillar=designs) |
| `DesignToolChip` | Tool tag chip (distinct style from regular tags) |

**Dashboard integration:**
```tsx
// In dashboard.tsx
{selectedPillar === "designs"
  ? <DesignSkillGrid ... />
  : <MasonryGrid ... />
}
```

---

## 10. Scope

### Phase 1 (this feature)
- Pillar-aware dashboard switching (masonry vs. design grid)
- `DesignSkillCard` with title, tools, summary, thumbnail, source
- `DesignSkillModal` fullscreen with all sections
- Agent prompt section (illustrative — static text block with copy)
- Designs-specific filter chips (type, platform)
- Schema additions: `workflowSteps`, `agentPrompt`, `toolNames`

### Not Phase 1
- Iframe preview of source sites
- Tool-based filtering (can use tag filtering for now)
- Auto-generating agent prompts from workflow steps
- Workflow step editor UI
- Related skills / "see also" connections
