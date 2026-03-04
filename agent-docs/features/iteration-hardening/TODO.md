# Iteration Hardening TODOs

Last updated: 2026-03-04
Owner: Michael + Codex
Status: In progress

## Scope
Improve security, iteration speed, and design-system consistency while staying aligned with project guidelines and the warm editorial direction.

## P0 — Do first

- [x] `SEC-01` Lock down destructive Convex mutations
  - Convert dangerous public mutations to internal/admin-only.
  - Add/adjust tests proving they are not publicly callable and core flows are unaffected.
  - Target files: `convex/assets.ts`, `convex/prompts.ts`, related tests/docs.

- [x] `AUTH-01` Unify owner/actor authorization boundaries
  - Introduce shared owner/actor assertion helpers.
  - Remove duplicated owner-candidate resolution logic across Convex + API routes.
  - Ensure folder/asset/prompt ownership checks all use one canonical path.

- [x] `DS-01` Design token enforcement pass
  - Remove hardcoded colors/shadows/font sizes from high-traffic surfaces.
  - Ensure components rely on tokens in `app/globals.css` / `design-system/tokens.css`.
  - Add lint guardrails for inline hardcoded visual styles.

## P1 — Next

- [x] `DS-02` Build reusable UI primitives for fast iteration
  - Create shared primitives: `VaultCard`, `StatTile`, `AuthPanel`, `FilterChip`.
  - Migrate sidebar + auth + filter UI to use these primitives.

- [x] `PERF-01` Refactor gallery queries to reduce N+1 lookups
  - Optimize tag/prompt/url assembly in `listGalleryAssets` and `listPublicGalleryAssets`.
  - Keep owner/public behavior unchanged.
  - Add regression/perf-oriented tests where possible.

- [x] `REL-01` Scope-safe gallery filters and state reset
  - Enforce folder filter usage only in `mine` scope (avoid stale `folderId` in public queries).
  - Clear stale selected folder IDs if no longer valid for loaded folder list.
  - Reset selected detail panel state when switching gallery scopes.
  - Add helper tests for scope/filter normalization behavior.

## Product Management Track (no telemetry scope)

- [x] `PM-01` Product scorecard and success criteria
  - Define one north-star metric and 3–4 supporting metrics (non-telemetry implementation for now).
  - Document baseline assumptions and review cadence.

- [x] `PM-02` Now / Next / Later roadmap refresh
  - Re-rank backlog by impact, effort, and risk.
  - Align with Gallery Entry V2 and dashboard polish direction.

## Execution Notes

- Always run after each task:
  - `bun run lint`
  - `bun test`
- If Convex schema changes:
  - run `bunx convex dev` once.
