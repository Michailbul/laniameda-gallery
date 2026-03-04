# Product Scorecard — Iteration Hardening

Last updated: 2026-03-04
Owner: Product + Engineering
Review cadence: Weekly (Monday), monthly trend review on first Monday
Scope note: Non-telemetry implementation. Metrics rely on existing Convex tables and manual snapshotting.

---

## North-Star Metric

### NSM: Weekly Actionable Vault Entries (WAVE)

Definition:
- Count of owner-scoped assets created in the last 7 days that are both:
  1. linked to a prompt (`promptId` present), and
  2. used in at least one dashboard-triggered run (`runs.source = "dashboard"` and matching intent/action flow).

Why this is the north star:
- Captures end-to-end value: ingest -> organization -> reuse/action.
- Aligns with current direction (Gallery Entry V2, faster action loops, studio workflow quality).

Primary source tables:
- `assets`
- `prompts`
- `runs`
- `run_artifacts` (as needed for verification of output usage)

---

## Supporting Metrics

### S1: Weekly Owner Asset Throughput

Definition:
- Number of assets created in last 7 days for the primary owner(s).

Purpose:
- Detect ingest regression quickly.

Source:
- `assets.createdAt`, `assets.ownerUserId`

### S2: Organization Coverage

Definition:
- `%` of owner assets with non-empty `folderId`.

Purpose:
- Measures whether folder functionality is actually used (feature health proxy).

Source:
- `assets.folderId`, `assets.ownerUserId`

### S3: Prompt Attachment Coverage

Definition:
- `%` of owner assets with `promptId` populated.

Purpose:
- Ensures gallery records remain action-ready for generation workflows.

Source:
- `assets.promptId`, `assets.ownerUserId`

### S4: Public Curation Quality Rate

Definition:
- `%` of public assets (`isPublic=true`) that are also featured (`isFeatured=true`).

Purpose:
- Quality signal for community-facing surface, not just volume.

Source:
- `assets.isPublic`, `assets.isFeatured`, `assets.curatedAt`

---

## Baseline Assumptions (Initial)

- Baseline window: 2026-03-01 to 2026-03-07
- If historical windows are missing complete records, treat first full week after this date as baseline week 0.
- Until dedicated telemetry exists, comparisons use:
  - weekly absolute counts,
  - 4-week rolling average (manual spreadsheet snapshot).

---

## Review Protocol

Weekly checklist:
1. Snapshot NSM + supporting metrics.
2. Compare against prior week and 4-week average.
3. Label each metric status: `up`, `flat`, `down`.
4. Record top 1 blocker and top 1 next experiment.

Monthly checklist:
1. Validate metric definitions still match product direction.
2. Re-rank roadmap items using metric movement + delivery cost.

---

## Decision Rules

- If NSM declines 2 consecutive weeks:
  - prioritize reliability/performance fixes over new UI polish.
- If throughput is stable but organization coverage drops:
  - prioritize folder and filtering usability.
- If prompt attachment drops:
  - prioritize ingest/prompt mapping quality and entry-model migration tasks.
