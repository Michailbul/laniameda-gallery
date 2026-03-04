# Roadmap Refresh — Now / Next / Later

Last updated: 2026-03-04
Owner: Product + Engineering
Context anchors:
- `agent-docs/BACKLOG.md`
- `agent-docs/features/gallery-entry-v2/TICKET.md`
- `agent-docs/features/dashboard-polish/SPRINT.md`

---

## Prioritization Method

Scoring dimensions:
- Impact (1-5): User and product value
- Effort (1-5): Delivery cost (higher = more expensive)
- Risk (1-5): Execution or migration risk (higher = riskier)
- Priority index = `Impact - (Effort + Risk) / 2`

Goal:
- Keep execution aligned with Gallery Entry V2 while avoiding feature sprawl.

---

## Now (Current Sprint Window)

### 1) UI-05 — Gallery Entry V2 foundation

- Impact: 5
- Effort: 5
- Risk: 4
- Why now:
  - Unlocks multi-image/multi-prompt data model and hover actions.
  - Core to future iteration velocity and action workflows.

### 2) Dashboard Polish carryover (SP-series hardening)

- Impact: 4
- Effort: 3
- Risk: 2
- Why now:
  - Directly improves day-to-day operator speed and perceived quality.
  - Low migration risk, immediate UX return.

### 3) Query/interaction reliability follow-ups (post PERF-01)

- Impact: 4
- Effort: 2
- Risk: 2
- Why now:
  - Supports WAVE north-star by reducing friction in browse -> action loop.

---

## Next (After current window)

### 1) AUTH-01/AUTH-02 WorkOS + account linking phases

- Impact: 4
- Effort: 4
- Risk: 3
- Why next:
  - Important for identity durability and multi-login consistency.
  - Should follow entry model stabilization to avoid parallel migration complexity.

### 2) ING-01 Agent auto-classification into pillars

- Impact: 4
- Effort: 3
- Risk: 2
- Why next:
  - Improves organization coverage and downstream findability.

### 3) UI-04 Related tags/prompts in side panel

- Impact: 3
- Effort: 4
- Risk: 2
- Why next:
  - Extends reuse loops after entry-model work lands.

---

## Later (Defer unless signals change)

### 1) AI-01 Image -> Prompt Generator

- Impact: 3
- Effort: 4
- Risk: 3
- Defer reason:
  - High upside, but depends on stable entry model and prompt quality baselines.

### 2) INF-01 Deployment pipeline hardening

- Impact: 3
- Effort: 3
- Risk: 2
- Defer reason:
  - Valuable, but less user-facing than current product-loop improvements.

### 3) ICE-02 Public gallery share links

- Impact: 2
- Effort: 3
- Risk: 2
- Defer reason:
  - Nice-to-have until core creation and curation loops mature.

---

## Reassessment Triggers

Re-rank immediately if either happens:
1. WAVE north-star drops 2 consecutive weeks.
2. Gallery Entry V2 delivery risk increases (schema migration complexity or regressions).
3. Auth friction becomes top blocker in weekly review notes.

---

## Delivery Notes

- Keep work packaged as vertical slices (backend + frontend + tests + docs).
- Preserve design-system token discipline and shared primitive usage.
- Avoid adding new scope unless it clearly improves WAVE or removes blocker risk.
