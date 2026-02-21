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
- `bun run dev:telegram` (start ngrok + set webhook + app + worker)
- `bun run dev:all` (start ngrok + set webhook + app + worker + `convex dev`)
- `bun run build`
- `bun run lint`
- `bun test`
- `bun run worker:dev`
- `bun run worker:start`
- `bun run env:doctor`
- `bun run telegram:webhook:set`
- `bun run telegram:webhook:info`
- `bun run telegram:webhook:delete`

## What Should Work Now (Verification Baseline)
After successful setup, this should work end-to-end:
1. Telegram update reaches `/api/telegram/webhook` and passes secret/body guards.
2. Convex run is created with:
   - `source=telegram`
   - `runtime=agent_worker`
   - source metadata (`sourceChatId`, `sourceThreadId`, `sourceMessageId`, `sourceUpdateId`)
3. Worker claims run, creates Daytona sandbox, stages media to `media/inbound/...`.
4. Agent SDK executes in streaming-first mode inside Daytona.
5. Run events/artifact persist in Convex (`runs`, `run_events`, `run_artifacts`).
6. Telegram receives terminal reply message from worker.

## Deterministic Dev Spin-Up (Required)
Use this exact sequence for consistent local development.

### Step 1) Install and sync env templates
```bash
bun install
cp .env.example .env.local
cp convex/.env.example convex/.env.local
```

### Step 2) Fill required `.env.local` vars
Minimum required for Telegram + worker path:
```bash
NEXT_PUBLIC_CONVEX_URL=...
CONVEX_URL=...
ENABLE_AGENT_WORKER=true
APP_PORT=3317
WORKER_PORT=8797
AGENT_WORKER_URL=http://127.0.0.1:8797
AGENT_WORKER_SHARED_SECRET=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...
DAYTONA_API_KEY=...
DAYTONA_API_URL=...
DAYTONA_TARGET=...
```

Optional but recommended:
```bash
TELEGRAM_WEBHOOK_MAX_BODY_BYTES=1000000
TELEGRAM_WEBHOOK_BODY_TIMEOUT_MS=30000
TELEGRAM_MEDIA_MAX_BYTES=20000000
TELEGRAM_MEDIA_DIRECT_BLOCK_MAX_BYTES=5000000
AGENT_STREAMING_MODE=true
AGENT_STREAMING_SINGLE_FALLBACK=true
AGENT_DUMMY_MODE=false
```

### Step 3) Validate env health before startup
```bash
bun run env:doctor
```
Expected: no `Errors:` block.

### Step 4) Start stack (recommended one-command)
```bash
bun run dev:all
```
This bootstraps:
- ngrok tunnel and `TELEGRAM_WEBHOOK_PUBLIC_URL`
- Telegram webhook registration
- Next.js app
- worker
- local `convex dev`

If you already run Convex elsewhere, use:
```bash
bun run dev:telegram
```

### Step 5) Check service health
```bash
curl -s http://127.0.0.1:${WORKER_PORT:-8797}/health
bun run telegram:webhook:info
```
Expected:
- worker health returns `{ "ok": true, ... }`
- webhook info shows your current ngrok/app URL and no recent delivery errors

### Step 6) Live Telegram verification
1. Send a plain text message to your bot.
2. Confirm bot returns `Run <id> completed...`.
3. Send a message with an image or PDF.
4. Confirm run also completes and reply is posted in the same chat/thread.

### Step 7) Quality gates before/after changes
```bash
bun run lint
bun test
bunx tsc --noEmit
```

## Telegram MVP Sprint Setup
### 1) Create Telegram bot
Use [@BotFather](https://t.me/BotFather):
- `/newbot` -> create bot
- copy bot token into `TELEGRAM_BOT_TOKEN`

### 2) Configure local env (`.env.local`)
Minimum for Telegram ingress MVP:
```bash
NEXT_PUBLIC_CONVEX_URL=...
CONVEX_URL=...
ENABLE_AGENT_WORKER=true
APP_PORT=3317
WORKER_PORT=8797
AGENT_WORKER_URL=http://127.0.0.1:8797
AGENT_WORKER_SHARED_SECRET=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...
TELEGRAM_WEBHOOK_PUBLIC_URL=https://<your-public-domain-or-tunnel>
TELEGRAM_WEBHOOK_MAX_BODY_BYTES=1000000
TELEGRAM_MEDIA_MAX_BYTES=20000000
AGENT_DUMMY_MODE=false
DAYTONA_API_KEY=...
DAYTONA_API_URL=...
DAYTONA_TARGET=...
```

Worker execution scoping (optional, recommended when running worker outside project root):
```bash
AGENT_WORKSPACE_CWD=/absolute/path/to/project
AGENT_ADDITIONAL_DIRECTORIES=/absolute/path/to/project,/absolute/path/to/project/media
```

### 3) Start services
In terminal 1:
```bash
bun run dev
```
In terminal 2:
```bash
bun run worker:dev
```

Optional one-command startup (recommended for Telegram dev):
```bash
bun run dev:telegram
```

Full local stack one-command startup (includes local Convex process):
```bash
bun run dev:all
```

If you have a reserved ngrok domain and want a stable public URL:
```bash
NGROK_DOMAIN=your-domain.ngrok-free.app bun run dev:telegram
```

### 4) Register webhook
```bash
bun run telegram:webhook:set
bun run telegram:webhook:info
```

### 5) Validate end-to-end
1. Send a message to your bot in Telegram.
2. Confirm webhook returns success.
3. Confirm a run is created in Convex with:
   - `source=telegram`
   - `runtime=agent_worker`

Current sprint acceptance target is Telegram -> backend run creation and observability.
Current verified baseline includes Telegram ingress, streaming worker execution in Daytona, Convex run ledger updates, and terminal Telegram replies.

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
