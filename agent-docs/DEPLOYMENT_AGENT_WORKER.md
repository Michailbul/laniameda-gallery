# Deployment — Agent Worker (Railway + Daytona)

Last updated: 2026-02-18

This deployment is optional in the current architecture and is used only when `ENABLE_AGENT_WORKER=true`.

## Service Topology
1. Web app (Next.js): creates/cancels runs and reads run status.
2. Convex: stores all run state/events/artifacts.
3. Agent worker (Railway): executes long-running orchestration.
4. Daytona: per-run sandbox lifecycle.

## Runtime Command
- Railway start command: `bun run worker:start`

## Health Endpoint
- `GET /health`

## Required Worker Env Vars
- `CONVEX_URL`
- `AGENT_WORKER_SHARED_SECRET`
- `AI_GATEWAY_API_KEY`
- `DAYTONA_API_KEY`
- `DAYTONA_API_URL`
- `DAYTONA_TARGET`
- `PORT` (Railway sets this)

Optional:
- `AGENT_WORKER_ID`
- `AGENT_MODEL`
- `AGENT_MAX_TURNS`
- `AGENT_ALLOWED_TOOLS`
- `AGENT_GATEWAY_BASE_URL` (default `https://ai-gateway.vercel.sh`)
- `AGENT_SKILLS_ENABLED`
- `AGENT_SETTING_SOURCES`
- `DAYTONA_AUTO_STOP_MINUTES`
- `ANTHROPIC_API_KEY` (legacy/direct mode only; not used in default gateway path)

## Security Requirements
- Keep `AGENT_WORKER_SHARED_SECRET` identical in web and worker envs.
- Do not expose worker URL publicly without signature checks.
- Do not enable Agent SDK bypass permissions in production.
- Keep allowed tool list minimal and intent-scoped.

## Request Signing Contract
Headers required for signed worker endpoints:
- `x-agent-timestamp` (unix seconds)
- `x-agent-signature` (`v1:<sha256-hmac>`)

Payload signature format:
- HMAC-SHA256 over: `${timestamp}.${rawBody}`

## Rollout Checklist
1. Deploy worker service to Railway.
2. Set worker env vars.
3. Set `AGENT_WORKER_URL` + `AGENT_WORKER_SHARED_SECRET` in web env.
4. Verify `/health`.
5. Create test run via `/api/ai/runs/stream` with `runtime=agent_worker`.
6. Confirm Convex status transitions and artifact persistence.
