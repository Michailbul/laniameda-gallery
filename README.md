# Laniameda AI UGC

UGC/influencer image workflow app with a gallery-first UX, Convex data layer, and dual runtime strategy (AI SDK + Agent SDK worker).

## Stack
- Next.js (App Router) + TypeScript
- Convex (queries, mutations, actions, file storage)
- WorkOS AuthKit + Convex auth provider
- AI SDK + AI Gateway (default runtime)
- Optional external worker path (Railway + Daytona + Claude Agent SDK)
- Bun package manager/runtime

## Local Setup
1. Install dependencies:
```bash
bun install
```
2. Copy env template:
```bash
cp .env.example .env.local
cp convex/.env.example convex/.env.local
```
3. Fill required env vars in `.env.local`.
4. Regenerate Convex types when schema/functions change:
```bash
bunx convex codegen
```

## Environment Strategy (Required)
- Local source of truth: `.env.local`
- Template/docs only: `.env.example`
- Avoid conflicting values across `.env` and `.env.local` (prefer removing `.env` for local work)
- Convex local env parity file (recommended): `convex/.env.local` with at least:
```bash
WORKOS_CLIENT_ID=...
```
- Convex dashboard env must also include `WORKOS_CLIENT_ID`.

Run env diagnostics before Telegram testing:
```bash
bun run env:doctor
```

## Run App
```bash
bun run dev
```

## Run Optional Agent Worker
```bash
bun run worker:dev
```

Worker endpoints:
- `GET /health`
- `POST /v1/runs/dispatch`
- `POST /v1/runs/:id/cancel`

## Scripts
- `bun run dev` (Next.js on `APP_PORT`, default `3317`)
- `bun run worker:dev` (worker on `WORKER_PORT`, default `8797`)
- `bun run dev:sim` (`dev-sim`: no ngrok/no real Telegram, Web simulator + worker path)
- `bun run dev:telegram` (`dev-telegram`: ngrok + webhook + app + worker)
- `bun run dev:all` (`dev-all`: `dev-telegram` + local `convex dev`)
- `bun run env:doctor:sim`
- `bun run env:doctor:telegram`
- `bun run build`
- `bun run lint`
- `bun test`

## Environment Profiles
Use named templates and keep `.env.local` as the active file:
- `.env.profile.dev-sim.example`
- `.env.profile.dev-telegram.example`
- `.env.profile.prod-telegram.example`

Set `APP_ENV_PROFILE` explicitly (`dev-sim`, `dev-telegram`, `prod-telegram`) so logs are easy to separate.

## Dev Sim Mode (Recommended Daily Flow)
This mode mimics Telegram ingest without ngrok/bot webhooks.

### 1) Setup
```bash
bun install
cp .env.example .env.local
cp convex/.env.example convex/.env.local
```

Minimum `.env.local` additions for dev-sim:
```bash
APP_ENV_PROFILE=dev-sim
DEV_TELEGRAM_SIM_ENABLED=true
DEV_TELEGRAM_SIM_AUTH_BYPASS=true
ENABLE_AGENT_WORKER=true
AGENT_WORKER_URL=http://127.0.0.1:8797
AGENT_WORKER_SHARED_SECRET=...
NEXT_PUBLIC_CONVEX_URL=...
CONVEX_URL=...
DAYTONA_API_KEY=...
DAYTONA_API_URL=...
DAYTONA_TARGET=...
AGENT_DUMMY_MODE=false
AI_GATEWAY_API_KEY=...
```

### 2) Validate env
```bash
bun run env:doctor:sim
```

### 3) Start stack
```bash
bun run dev:sim
```

### 4) Test in browser
Open:
- `/dev/telegram-sim` for ingress simulation
- `/api/dev/telegram/simulate/health` for simulator health

Expected behavior:
1. Run created with `source=dev_telegram` and `runtime=agent_worker`.
2. Worker stages media and runs Agent SDK in Daytona.
3. Ingest payload writes prompts/assets with owner scoping.
4. Streaming/final reply is logged to worker stdout (no Telegram outbound send).

## Dev Telegram Mode (Real Bot + ngrok)
Use this for production-like Telegram ingress tests.

### 1) Configure bot vars
```bash
APP_ENV_PROFILE=dev-telegram
DEV_TELEGRAM_SIM_ENABLED=false
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...
```

### 2) Validate env
```bash
bun run env:doctor:telegram
```

### 3) Start stack
```bash
bun run dev:telegram
```
or:
```bash
bun run dev:all
```

### 4) Verify webhook and health
```bash
curl -s http://127.0.0.1:${WORKER_PORT:-8797}/health
bun run telegram:webhook:info
```

## Prod Telegram Mode
For deployed app/worker testing:
- Keep `APP_ENV_PROFILE=prod-telegram`
- Keep `DEV_TELEGRAM_SIM_ENABLED=false`
- Use deployed webhook URL in `TELEGRAM_WEBHOOK_PUBLIC_URL`
- Run `bun run env:doctor -- --mode prod-telegram` before tests.

## Telegram Parity Map (dev_telegram vs telegram)
Identical:
1. Run lifecycle (`runs`, `run_events`, `run_artifacts`) and phases.
2. Worker claim/start/sandbox/media staging/runtime/ingest/finalize flow.
3. Ingest payload contract (`submit_ingest_payload`) and owner injection.
4. Dashboard visibility and owner-scoped Convex reads.

Different:
1. Ingress entrypoint: `/api/dev/telegram/simulate` vs `/api/telegram/webhook`.
2. Outbound delivery: `dev_telegram` logs to stdout; `telegram` sends/edit messages through Bot API.
3. No ngrok/webhook setup required in `dev-sim`.

## Troubleshooting
1. `no_ingest_payload`:
   - Ensure live mode (`AGENT_DUMMY_MODE=false`), and agent skill still calls `submit_ingest_payload` exactly once.
2. Worker dispatch failures:
   - Verify `AGENT_WORKER_URL` and `AGENT_WORKER_SHARED_SECRET` match in app/worker envs.
3. Daytona failures:
   - Re-check `DAYTONA_API_KEY`, `DAYTONA_API_URL`, `DAYTONA_TARGET`.
4. Dev simulator rejected:
   - Set `DEV_TELEGRAM_SIM_ENABLED=true`; use localhost unless `DEV_TELEGRAM_SIM_ALLOW_NON_LOCAL=true`.
5. Missing owner-scoped data in dashboard:
   - Verify run `userId` and ingest writes include `ownerUserId`.

## Deployment Split (Prod)
- Vercel: Next.js app/API routes (`/api/telegram/webhook`, `/api/ai/*`).
- Railway (or equivalent): `agent-worker` service.
- Convex Cloud: database + functions.
- In production, run each service independently (no combined script).

## Canonical AI APIs
- `POST /api/ai/runs/stream`
- `POST /api/ai/images/generate`
- `GET /api/ai/runs/:runId`
- `POST /api/ai/runs/:runId/cancel`
- `POST /api/dev/telegram/simulate` (dev-sim only)
- `GET /api/dev/telegram/simulate/health` (dev-sim only)
- `GET /api/dev/telegram/simulate/runs/:runId` (dev-sim only)

## Documentation
- Product foundation PRD: `agent-docs/PRD.md`
- Technical overview map: `agent-docs/TECHNICAL_OVERVIEW.md`
- Backend runtime baseline: `agent-docs/BACKEND_PRD.md`
- Convex backend setup: `agent-docs/BACKEND_CONVEX_SETUP.md`
- AI runtime guide: `agent-docs/AI_RUNTIME.md`
- Worker deployment: `agent-docs/DEPLOYMENT_AGENT_WORKER.md`
- Telegram engineering PRD: `agent-docs/TELEGRAM_AGENT_ENGINEERING_PRD.md`
- Telegram architecture diagrams: `agent-docs/TELEGRAM_AGENT_DIAGRAMS.md`
- Auth details: `agent-docs/AUTH.md`
- Progress/TODO: `agent-docs/PROGRESS.md`, `agent-docs/TODO.md`
