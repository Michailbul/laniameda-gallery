# CLAUDE.md — laniameda.gallery

## Product stance

`laniameda.gallery` is becoming a dynamic, agentic website/app.

- The user-facing interaction should stay lightweight.
- The backend should own durable logic, normalization, and future enrichment hooks.
- Hardcoded frontend-only workflows are a last resort.
- Prefer schemas, backend actions, templates/defaults, and metadata contracts that can later support:
  - additional pillars
  - user-configurable save flows
  - semantic search
  - generative classification
  - under-the-hood agent behaviors

## Current implementation rule

Do not overbuild generic abstractions before the product earns them.

- Ship the current scoped feature cleanly.
- Keep contracts extensible.
- Separate V1 explicit user metadata from future agent-derived metadata.

## Backend bias

For gallery save flows:

- treat visual preview as mandatory for gallery-visible entries
- keep mutations idempotent
- prefer dedicated backend contracts over overloading generic ingest routes
- keep extension/backend boundaries authenticated even for single-user flows

## Repo expectations

- Use `bun`
- Run `bun run lint` and `bun test` after changes
- If `convex/schema.ts` changes, run `bunx convex codegen` and `bunx convex dev` when possible

## Convex ground truth

- This repo's gallery backend is `dev:perfect-buffalo-375`.
- The canonical gallery cloud URL is `https://perfect-buffalo-375.convex.cloud`.
- Do not trust inherited shell Convex env blindly. If CLI behavior does not match the repo, check exported `CONVEX_*` / `NEXT_PUBLIC_CONVEX_URL` vars and prefer the repo env files plus `scripts/lib/convex-dev-env.ts`.
- For local app runtime, `.env.local` must stay aligned with the gallery backend (`CONVEX_URL`, `NEXT_PUBLIC_CONVEX_URL`, and `CONVEX_DEPLOYMENT` all pointing at `perfect-buffalo-375`).

## Current handoff

Design extension save is in frontend-completion mode.

- Treat the backend as complete for V1 unless a manual extension test exposes a concrete defect.
- Use `agent-docs/features/design-extension-save/HANDOFF.md` as the task handoff for the next pass.
- The next agent should finish template UX, one-click extension flow, and live validation.
- Once frontend work is fully done, update project docs and remove the remaining backlog/TODO entry rather than leaving it open.
