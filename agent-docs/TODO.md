# TODO

Last updated: 2026-02-19

## Work Mode
- Frontend/design first.
- Backend/agent work is scoped to unlock frontend UX milestones.
- Scope focus: UGC/influencer image workflows only (no video).

## Sprint Lock (Current)
- Focus now on post-integration sprint:
  1. Agent tool-calling writes extracted outputs into Convex domain tables.
  2. Expand multimodal behavior for staged audio/video/voice.
  3. Connect run ledger outputs into dashboard workspace UX.
- Keep Telegram ingress/streaming path stable while adding these capabilities.

## Build Session Kickoff (Use First)
This is the execution order for the next conversation/build session:
1. [x] Run baseline checks: `bun run lint`, `bun test`, `bunx tsc --noEmit`.
2. [x] Complete P0 typecheck fixes before adding Telegram runtime code.
3. [x] Deliver streaming-first Telegram vertical slice end-to-end.
4. [ ] Implement agent write-path from worker runtime into domain tables (`prompts`, `assets`, tags/folders).
5. [ ] Re-run checks and update `PROGRESS.md` + `OBSERVATIONS.md` in the same change.

## Next Development Plan (Execution Order)
### P0) Engineering Baseline Stabilization (Do First)
- [x] Fix TypeScript baseline so `bunx tsc --noEmit` passes:
  - `components/ConvexClientProvider.tsx` (WorkOS/AuthKit type mismatch)
  - `components/upload-panel.tsx` (missing-arg typing issue)
  - `scripts/ingest-local-assets.ts` (typed upload/storage ID mismatches)
  - Bun test typings for `tests/*.test.ts`
- [x] Decide lint policy for generated files (`convex/_generated/*`) and make lint output signal-only for actionable warnings.
- [x] Replace remaining `<img>` usage in `components/upload-panel.tsx` with `next/image` or documented exception.

### P1) Telegram + Agent SDK Prototype (Primary Backend Goal)
- [x] Implement Telegram gateway/webhook receiver and normalized inbound envelope.
- [x] Create Telegram-triggered runs with `source=telegram`, `runtime=agent_worker`.
- [x] Download/validate/stage Telegram media into sandbox workspace (`media/inbound/...`).
- [x] Bind Agent SDK execution to workspace (`cwd` + scoped directories) for staged media access.
- [x] Send terminal run reply back to Telegram thread using stored routing metadata.
- [x] Add idempotency for duplicate Telegram updates and retries.

### P2) Runtime Refactor + Cleanup
- [x] Remove redundant compatibility run APIs (`/api/runs*`) in seed-stage codebase; keep `/api/ai/*` as only run API surface.
- [ ] Evaluate schema cleanup for image-only scope (e.g., `assets.kind="video"` deprecation plan with migration).
- [x] Extract and implement OpenClaw Telegram hardening patterns (webhook hardening, dedupe, media retry, thread routing).
- [x] Refactor worker orchestration/runtime for maintainability (helper decomposition + shared phases + runtime-loop dedupe).
- [ ] Optimize Daytona startup path (avoid re-uploading Agent SDK package every run).

## Track A — Frontend, UX, and Design (Primary)
> **Full frontend sprint plan**: See `agent-docs/FRONTEND_TODO.md`
> **Design specification**: See `agent-docs/FRONTEND_DESIGN_PRD.md`
### A1) Core Navigation and Dashboard
- [x] Build gallery page with Convex-backed filters and search
- [x] Build detail view modal
- [x] Add upload dropzone, prompt input, URL input, and metadata fields
- [ ] Add copy-prompt button with clear success feedback
- [ ] Add workspace split view/sidebar with tabbed results (references, prompt package, generated outputs)

### A2) Smart Filters and Discovery UX
- [x] Expose tag and folder filtering
- [ ] Design and ship “smart filter” presets for UGC tasks (pose, framing, lighting, setting, intent)
- [ ] Add quick-save filter views for repeat workflows
- [ ] Add dense keyboard-first filter interactions for power users

### A3) Few-Click Aha Flow
- [x] Add card-level actions: `Transfer Style`, `Transfer Pose`, `Replace Character`
- [ ] Add “choose your saved character” selector in the action flow
- [x] Build prompt package preview panel (prompt + referenced files + source provenance)
- [ ] Add one-click export/download for prompt package assets

### A4) UI Quality and Accessibility
- [x] Improve image loading with `next/image` and skeleton states
- [x] Remove global auth paywall redirects; keep app publicly viewable in guest mode
- [ ] Accessibility pass for keyboard navigation and screen readers
- [ ] End-to-end UI polish pass on spacing, hierarchy, and interaction clarity

## Track B — Backend, Agents, and Integrations (Secondary)
### B1) Convex Data and APIs
- [x] Define schema for assets/prompts/tags/folders
- [x] Add indexes for filter/search paths
- [x] Implement core gallery and metadata mutations/queries

### B2) Ingest Agent
- [x] Implement `/api/ingest` for files/prompts/URLs
- [x] Add idempotency and metadata extraction
- [x] Generate/store 520px thumbnails
- [ ] Harden ingest tests for prompt-only, file-only, and URL payloads
- [ ] Add integration-ready ingest contracts for Telegram payloads
- [ ] Add auto-routing logic for agent-based folder/tag assignment from external sources
- [x] Implement Telegram gateway/webhook handler that normalizes inbound text/media/link/document payloads
- [x] Persist Telegram source metadata (chat/thread/message IDs) in run input for deterministic reply routing

### B3) Prompt Construction Agent
- [x] Implement external worker runtime skeleton with Anthropic Agents SDK + Daytona sandbox lifecycle
- [x] Add AI SDK runtime path and canonical `/api/ai/*` endpoints
- [x] Persist run records in Convex (`runs`, `run_events`, `run_artifacts`) and expose run APIs
- [x] Extend run schema with runtime/provider/model/mode/usage metadata
- [x] Define secure dispatch contract (canonical run API -> worker HMAC-signed `/v1/runs/dispatch`) for optional worker path
- [ ] Define skill contracts for style transfer, pose transfer, and character replacement
- [ ] Harden resume path with explicit `session_id` continuation semantics
- [x] Stage Telegram attachments into sandbox workspace before Agent SDK execution (`media/inbound/...`)
- [x] Bind Agent SDK execution to run workspace (`cwd` + scoped additional directories) for staged file access
- [x] Execute Agent SDK in streaming-first mode inside Daytona sandbox for Telegram runs
- [x] Materialize worker prompt-package output into `prompts` table with run-scoped idempotency key
- [ ] Add tool-calling persistence contract so agent can create/update prompts/assets/tags/folders directly

### B4) Execute-in-App Pipeline
- [x] Implement async run lifecycle status transitions (`queued -> claimed -> running -> terminal`)
- [x] Add cancel endpoint contract (`/api/ai/runs/:id/cancel` and worker cancellation hook)
- [x] Add canonical AI API routes (`/api/ai/runs/stream`, `/api/ai/images/generate`, run read/cancel)
- [ ] Add action-level auth guards (prompt sign-in only on like/save/upload/edit interactions)
- [ ] Add provider abstraction for generation execution
- [ ] Add retries + failure classification policy (workflow component / backoff policy)
- [ ] Connect execution outputs to workspace sidebar tabs
- [x] Add Telegram reply sender (final text responses) using run source metadata
- [x] Add Telegram idempotency for duplicate webhook/update delivery

## Track C — Quality, Docs, and Operations
- [x] Basic helper tests (`ingestHelpers`)
- [ ] Unit tests for Convex functions
- [ ] Integration tests for ingest + gallery
- [x] Integration harness for Telegram webhook -> dispatch -> streaming completion path
- [ ] Add worker HTTP signature-path integration tests (`/v1/runs/dispatch`, `/v1/runs/:id/cancel`)
- [ ] Rerun `bun run build` on unrestricted host (currently blocked by CSS worker permission issue)
- [x] Expand `README.md` with setup/scripts and local dev flow
- [ ] Add `/api/ingest` API documentation
- [x] Add backend worker deployment docs (Railway + Daytona)
- [ ] Resolve outstanding product/technical gap decisions listed in `PRD.md` section 13 and `BACKEND_PRD.md` section 11

## Completed Admin / Housekeeping
- [x] Add completed admin test task for TODO flow (2026-01-28)
- [x] Configure WorkOS AuthKit and Convex auth integration
