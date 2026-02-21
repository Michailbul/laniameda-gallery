# Backend Convex Setup

Last updated: 2026-02-13

## Current Convex Runtime
- Stack: Convex functions (queries/mutations/actions) + storage.
- Auth: WorkOS JWT validation via `convex/auth.config.ts`.
- Existing ingestion action: `ingest:ingestFromApi`.

## New Run Tables
Defined in `convex/schema.ts`:
1. `runs`
2. `run_events`
3. `run_artifacts`

These support durable run orchestration and stream/event reconstruction.

`runs` now also stores AI runtime metadata:
- `runtime`
- `provider`
- `model`
- `mode`
- `usage`

## New Run Functions
Defined in `convex/runs.ts`:
1. `createRun`
2. `claimRun`
3. `setRunRunning`
4. `appendRunEvent`
5. `completeRun`
6. `failRun`
7. `cancelRun`
8. `resumeRun`
9. `getRun`
10. `listRunsByUser`

## Integration Path
- Next.js API routes call Convex via `ConvexHttpClient` + function refs.
- Worker service calls the same run functions for orchestration state.
- Frontend can poll/subscribe to `getRun` and `listRunsByUser`.

## Required Commands After Pull
1. `bun install`
2. `bunx convex codegen`
3. `bun run lint`
4. `bun test`

## Environment Configuration
### Next.js/API process
- `CONVEX_URL` (or `NEXT_PUBLIC_CONVEX_URL`)
- `AI_GATEWAY_API_KEY`
- `AI_RUNTIME_DEFAULT`
- `ENABLE_AGENT_WORKER`
- `AI_TEXT_MODEL`
- `AI_IMAGE_MODEL_NANO_BANANA`
- `AI_IMAGE_MODEL_NANO_BANANA_FAST`
- Optional worker fallback env (`AGENT_WORKER_URL`, `AGENT_WORKER_SHARED_SECRET`)

### Convex deployment
- `WORKOS_CLIENT_ID`

### Worker (uses Convex URL to call mutations/queries)
- `CONVEX_URL`

## Recommended Convex Components (Next Phases)
1. `@convex-dev/workflow` for durable retries and long-running orchestration.
2. `@convex-dev/rate-limiter` for per-user run throttling.
3. `@convex-dev/persistent-text-streaming` for streaming persistence ergonomics.
4. `@convex-dev/workos-authkit` if durable user sync/events are needed.
5. Payments (plan-only for now):
   - `@convex-dev/stripe`
   - `@convex-dev/polar`

## Known Notes
- Convex actions are still capped in duration; external worker remains the fallback for long-running workflows.
- Current AI endpoints persist compact run logs (milestones, final artifacts, usage) instead of full token-by-token transcript storage.
