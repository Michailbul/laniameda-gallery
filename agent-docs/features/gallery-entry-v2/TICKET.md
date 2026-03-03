# Ticket: Gallery Entry V2 (Hover Actions + Multi-Image/Prompt Entry Model)

## Goal

Upgrade gallery records from a single image + single prompt view into an **entry model** that can hold:

- multiple images
- multiple prompts
- prompt/image mapping per item

And update the dashboard UX so image actions are available directly on hover.

---

## Why this is needed

Current UX and data model are optimized for one image per card with actions in the right panel.
Requested behavior:

1. Action buttons (`transfer style`, `transfer pose`, `replace character`) should be on image hover overlay, not hidden in side-panel tabs.
2. Right side panel should support carousel navigation when one entry has multiple images.
3. One entry can contain arrays of prompts and images where each image can map to one prompt.

---

## Scope

### 1) Convex schema and backend (data model)

- [ ] Add entry-level data model in `convex/schema.ts` (new table(s) for grouped entry records and ordered entry items)
- [ ] Represent per-item mapping between `asset` and `prompt` (1:1 item mapping inside an entry)
- [ ] Add indexes for:
  - owner + createdAt
  - owner + pillar + createdAt
  - public/feed access patterns
- [ ] Keep backward compatibility for existing rows (`assets` + `prompts` without entry grouping)
- [ ] Add migration/backfill strategy from current single-item rows into entry structure
- [ ] Update ingest path(s) to create entry records idempotently
- [ ] Update API/query layer to return entry-shaped payloads for gallery list + detail panel

### 2) Frontend dashboard UX

- [ ] Move action triggers from side-panel Actions tab into image hover/focus overlay on cards
- [ ] Ensure actions are keyboard accessible (focus-visible + Enter/Space), not hover-only
- [ ] Add side-panel carousel for selected entry:
  - next/prev controls
  - optional thumbnail rail or pagination dots
  - index indicator (e.g. `2/6`)
- [ ] Bind prompt/details panel to currently selected carousel item
- [ ] Keep independent scrolling behavior (main grid vs side panel) after carousel integration
- [ ] Keep mobile behavior aligned (swipe and panel controls for multi-image entries)

### 3) Agent ingest and docs

- [ ] Update `agent-docs/AGENT_INGEST_SKILL_CONTEXT.md` with new entry payload contract
- [ ] Update `agent-docs/BACKEND_CONVEX_SETUP.md` with entry model + indexes + migration notes
- [ ] Update `agent-docs/PROGRESS.md` after shipping
- [ ] Add examples for agents that populate data:
  - single-item entry
  - multi-item entry with prompt/image mapping
- [ ] Document compatibility rules so legacy single-image ingests still work

---

## Acceptance Criteria

- [ ] A gallery card can expose action buttons directly on hover/focus overlay.
- [ ] Selecting an entry with multiple images opens a functional carousel in the detail panel.
- [ ] Prompt text shown in detail panel matches the currently active image item.
- [ ] Convex queries return stable entry payloads with deterministic item ordering.
- [ ] Existing assets/prompts remain visible after migration (no data loss).
- [ ] Docs are updated so ingest agents can send valid entry-shaped payloads.

---

## Risks / Notes

- Migration complexity: legacy single-item rows need safe default entry mapping.
- Performance: entry hydration (items + prompts + assets) can increase query load; use indexes and limit payload size.
- UX complexity: hover actions must not conflict with existing click-to-open/select behaviors.

---

## Suggested execution order

1. Backend schema + query shape + migration plan
2. Frontend data adapter for entry payload
3. Hover action overlay + side-panel carousel UI
4. Agent ingest contract and documentation updates
