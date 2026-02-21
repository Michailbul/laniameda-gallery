# Backend PRD — Dual Runtime Foundation

Last updated: 2026-02-18

## 1) Goal
Deliver a production-ready backend runtime for AI workflows with:
- Next.js route handlers for short-lived web execution.
- Convex as source of truth for run state, events, and artifacts.
- AI SDK + AI Gateway for fast web/dashboard runs.
- Agent SDK worker (sandboxed) for heavy Telegram workflows.

## 2) Scope (Current)
- Canonical `/api/ai/*` endpoints for streaming prompt-package and image generation.
- Compact run persistence in Convex (`runs`, `run_events`, `run_artifacts`).
- Runtime metadata persistence (`runtime`, `provider`, `model`, `mode`, `usage`).
- Auth-required AI execution with guest-readable gallery.
- Per-user API rate limits.
- Telegram-triggered run path using `source=telegram` and `runtime=agent_worker`.

## 3) Out of Scope (Current)
- Durable long-running orchestration as default.
- Full transcript persistence for each stream part.
- Payments entitlement enforcement.

## 4) Architecture
1. Frontend calls canonical AI APIs under `/api/ai/*` for web-first runs.
2. Telegram gateway/service receives webhook updates for chat-triggered runs.
3. Ingress layer validates request, normalizes payload, and creates run in Convex (`queued`) with runtime metadata.
4. AI SDK runtime executes directly in Next route (`ai_sdk` path) for short web jobs.
5. Agent SDK runtime executes in worker (`agent_worker` path) for heavy Telegram workflows.
6. Runtime persists compact progress/status events in Convex.
7. Runtime writes final artifacts + usage + terminal status.

## 5) Run Contracts
### Status
`queued | claimed | running | waiting_input | completed | failed | canceled`

### Runtime
`ai_sdk | agent_worker`

### Provider
`gateway | provider_direct`

### Mode
`prompt_package | image_generate`

### Intent
`transfer_style | transfer_pose | replace_character | ingest | execute`

### Source
`dashboard | telegram | api`

## 6) API Endpoints
### Canonical
- `POST /api/ai/runs/stream`
- `POST /api/ai/images/generate`
- `GET /api/ai/runs/:runId`
- `POST /api/ai/runs/:runId/cancel`

## 7) Security Defaults
- AI endpoints require signed-in user (`ensureSignedIn: true`).
- Per-user rate limiting on generation endpoints.
- Allowlisted image model aliases.
- No secrets persisted in Convex run payloads/events.
- Worker dispatch remains HMAC-signed when worker path is used.

## 8) Env Vars
Core:
- `NEXT_PUBLIC_CONVEX_URL`
- `CONVEX_URL`
- `AI_GATEWAY_API_KEY`
- `AI_RUNTIME_DEFAULT`
- `ENABLE_AGENT_WORKER`
- `AI_TEXT_MODEL`
- `AI_IMAGE_MODEL_NANO_BANANA`
- `AI_IMAGE_MODEL_NANO_BANANA_FAST`

Optional (worker enabled only):
- `AGENT_WORKER_URL`
- `AGENT_WORKER_SHARED_SECRET`
- `ANTHROPIC_API_KEY`
- `DAYTONA_API_KEY`
- `DAYTONA_API_URL`
- `DAYTONA_TARGET`

## 9) Acceptance Criteria
- Authenticated requests can create and complete AI runs via `/api/ai/*`.
- Guest requests to `/api/ai/*` are rejected (`401`).
- Alias validation rejects unknown `modelAlias` values.
- Prompt-package stream returns partial updates and terminal output.
- Image generation returns data URL and persists image artifact.
- Cancel endpoint updates run status and aborts active local execution.
- Telegram-triggered runs appear in Convex with `source=telegram` and stream status/events to completion.

## 10) Telegram Build Contract
- Engineering implementation details: `agent-docs/TELEGRAM_AGENT_ENGINEERING_PRD.md`
- Architecture/flow diagrams: `agent-docs/TELEGRAM_AGENT_DIAGRAMS.md`

## 11) Unresolved Technical Gaps
1. Telegram ingress topology:
   - decide if webhook runs in Next.js app process first, or dedicated gateway from day one.
2. Idempotency strategy:
   - finalize key schema for update/message/media-group dedupe across retries.
3. Attachment limits:
   - hard size/MIME policy and fallback behavior per media type.
4. Tooling boundary:
   - finalize exact allowed tool set for ingestion agent runs vs future editing/generation runs.
5. Ownership/licensing metadata:
   - define required fields for crawled/shared sources before broad rollout.
6. Free vs paid behavior:
   - define backend enforcement points for browse/copy/execute boundaries.

## 12) OpenClaw Reuse Targets
For Telegram ingress hardening and media reliability, reuse these OpenClaw strategies:
1. Webhook fail-closed config (secret required, bounded request body, timeout return mode).
2. Update dedupe keys for idempotency (`update_id`, callback/message fallback keys).
3. Media download retry policy with explicit oversized-file handling and graceful placeholder fallback.
4. Thread/topic routing helpers for DM/group/forum separation.
Reference repo: `https://github.com/openclaw/openclaw`.

## 13) Immediate Implementation Sequence
Execute in this order for next build session:
1. Fix typecheck baseline and keep lint/tests green.
2. Add Telegram webhook/gateway receiver with normalized envelope contract.
3. Create runs in Convex (`source=telegram`, `runtime=agent_worker`) and dispatch worker.
4. Implement staged media workflow into run workspace before Agent SDK call.
5. Bind Agent SDK runtime to workspace path scope and persist run events/artifacts.
6. Send terminal Telegram replies from worker based on stored routing metadata.
