# Development and Production Workflows

Last updated: 2026-02-22

This project now has two supported operating modes.

## 1) Mode A: Local Web Simulator (No Telegram, No ngrok)

Use this for daily development. It runs the same core pipeline:
- ingress -> Convex run create -> worker dispatch -> Daytona sandbox -> Agent SDK -> Convex ingest -> user reply output

The only difference is reply delivery:
- `dev_telegram` writes streamed/final assistant text to worker stdout instead of Telegram Bot API.

### 1.1 Required env profile
Set these in `.env.local` (or copy from `.env.profile.dev-sim.example`):

```bash
APP_ENV_PROFILE=dev-sim
DEV_TELEGRAM_SIM_ENABLED=true
DEV_TELEGRAM_SIM_AUTH_BYPASS=true
ENABLE_AGENT_WORKER=true
AGENT_WORKER_URL=http://127.0.0.1:8797
```

Also set your normal Convex/Daytona/AI keys.

### 1.2 Start and test
1. Validate env:
```bash
bun run env:doctor:sim
```
2. Start stack:
```bash
bun run dev:sim
```
3. Open simulator:
   - `http://localhost:3317/dev/telegram-sim`
4. Submit message text/links/media.
5. Confirm:
   - run source is `dev_telegram`
   - worker logs streaming deltas and final reply to stdout
   - Convex run status reaches `completed` (or deterministic failure reason)
   - prompts/assets are written with owner scoping.

### 1.3 Why this mode exists
- No bot setup
- No webhook registration
- No ngrok dependency
- Full worker/daytona/ingest fidelity

## 2) Mode B: Real Telegram Bot (Production-like / Production)

Use this to validate real Telegram delivery or run production traffic.

## 2.1 URL mapping (critical)
Telegram must call the **web app** webhook route, not the worker.

1. Telegram webhook URL:
   - `https://<your-vercel-domain>/api/telegram/webhook`
2. Worker URL:
   - `https://<your-railway-worker-domain>`
   - used internally by web app as `AGENT_WORKER_URL`
   - never used as Telegram webhook URL

## 2.2 Deploy order
1. Deploy worker to Railway:
   - start command: `bun run worker:start`
   - verify worker health: `GET /health`
2. Deploy app to Vercel:
   - include Telegram webhook route and dispatch settings
3. Configure env in both services:
   - shared secret must match between app and worker
   - app points `AGENT_WORKER_URL` to Railway worker
4. Set Telegram webhook to Vercel URL:
```bash
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...
TELEGRAM_WEBHOOK_PUBLIC_URL=https://<your-vercel-domain>
bun run telegram:webhook:set
```
5. Validate webhook:
```bash
bun run telegram:webhook:info
```
6. Send test Telegram message and verify:
   - webhook ingress logs in Vercel
   - dispatch logs from app to worker
   - run execution logs in Railway worker
   - run/events/artifacts in Convex
   - streamed/final reply appears in Telegram chat.

## 2.3 Dev Telegram mode (local bot test with ngrok)
If you need real bot testing locally:

```bash
bun run env:doctor:telegram
bun run dev:telegram
```

This mode auto-manages ngrok + webhook registration and still uses your local app/worker.

## 3) End-to-end verification checklist

Run this checklist after major backend changes:

1. `bun run lint`
2. `bun test`
3. `bunx tsc --noEmit`
4. `bunx convex codegen`
5. Mode A happy path (text/link/media)
6. Mode A failure path (`no_ingest_payload` or `no_usable_prompt`)
7. Mode B Telegram happy path

## 4) Environment profile separation

Use profile templates as references:
- `.env.profile.dev-sim.example`
- `.env.profile.dev-telegram.example`
- `.env.profile.prod-telegram.example`

Keep `.env.local` as the active file in local development.
