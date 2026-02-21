# AI Runtime (Dual Path)

Last updated: 2026-02-18

## Goal
Use dual runtime paths:
- AI SDK + AI Gateway for short-lived prompt and image jobs.
- Agent SDK worker for heavy Telegram-driven workflows.

## Runtime Modes
- `ai_sdk` (default)
- `agent_worker` (optional, only when `ENABLE_AGENT_WORKER=true`)

## Telegram Runtime Policy
- Keep both runtimes enabled in product architecture.
- For Telegram-heavy workflows, prefer `agent_worker` (Agent SDK + sandbox).
- Keep `ai_sdk` as default for short-lived web/dashboard requests.

## Canonical API Endpoints
- `POST /api/ai/runs/stream`
- `POST /api/ai/images/generate`
- `GET /api/ai/runs/:runId`
- `POST /api/ai/runs/:runId/cancel`

No compatibility run API surface is maintained in this seed-stage codebase.

## Run Persistence
Convex remains source of truth with compact run logs:
- `runs`
- `run_events`
- `run_artifacts`

`runs` now stores runtime metadata:
- `runtime`
- `provider`
- `model`
- `mode`
- `usage`

## Model Strategy
- Text default: `anthropic/claude-sonnet-4.5`
- Alias mapping:
  - `nano_banana_pro -> google/gemini-3-pro-image`
  - `nano_banana_fast -> google/gemini-2.5-flash-image`

## Security and Guardrails
- `/api/ai/*` requires WorkOS auth (`ensureSignedIn: true`).
- Gallery browsing stays available in guest mode.
- Per-user rate limits applied at API layer.
- Model aliases are allowlisted; unknown aliases are rejected.

## Key Env Vars
- `AI_GATEWAY_API_KEY`
- `AI_RUNTIME_DEFAULT`
- `ENABLE_AGENT_WORKER`
- `AI_TEXT_MODEL`
- `AI_IMAGE_MODEL_NANO_BANANA`
- `AI_IMAGE_MODEL_NANO_BANANA_FAST`

Worker env is optional unless `ENABLE_AGENT_WORKER=true`.

When `ENABLE_AGENT_WORKER=true` and `AGENT_DUMMY_MODE=false`, worker live mode requires:
- `AI_GATEWAY_API_KEY`
- `DAYTONA_API_KEY`
- `DAYTONA_API_URL`
- `DAYTONA_TARGET`

Worker gateway/skills controls:
- `AGENT_GATEWAY_BASE_URL` (default `https://ai-gateway.vercel.sh`)
- `AGENT_SKILLS_ENABLED` (default `true`)
- `AGENT_SETTING_SOURCES` (default `project`)
