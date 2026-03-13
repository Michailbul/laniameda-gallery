# Environment Matrix

Last updated: 2026-03-07

This is the canonical env map for running `laniameda.gallery` locally and in production.

## 1) Local dev (`.env.local`)

Required to boot app:

```bash
NEXT_PUBLIC_CONVEX_URL=...
CONVEX_URL=...
SESSION_SECRET=... # min 32 chars
```

Recommended for local daily workflow (no Telegram widget domain dependency):

```bash
NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED=true
DEV_AUTH_BYPASS_ENABLED=true
DEV_AUTH_TELEGRAM_ID=278674008
DEV_AUTH_FIRST_NAME=Michael
NEXT_PUBLIC_DEV_OWNER_USER_ID=278674008
```

Required for curation controls in dev:

```bash
CURATION_ADMIN_SECRET=dev-curation-secret
CURATION_ADMIN_USER_IDS=278674008,telegram:278674008
NEXT_PUBLIC_CURATION_ADMIN_USER_IDS=278674008,telegram:278674008
```

Optional local simulator:

```bash
DEV_TELEGRAM_SIM_ENABLED=true
DEV_TELEGRAM_SIM_AUTH_BYPASS=true
DEV_TELEGRAM_SIM_ALLOW_NON_LOCAL=false
```

## 2) Vercel project env (Production)

Set these in Vercel for the Next.js app:

```bash
NEXT_PUBLIC_CONVEX_URL=...
CONVEX_URL=...
SESSION_SECRET=... # min 32 chars
TELEGRAM_LOGIN_BOT_TOKEN=...
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=...
KB_OWNER_USER_ID=278674008
CURATION_ADMIN_SECRET=...
CURATION_ADMIN_USER_IDS=278674008,telegram:278674008
NEXT_PUBLIC_CURATION_ADMIN_USER_IDS=278674008,telegram:278674008
AI_GATEWAY_API_KEY=... # required for /api/ai/* features
AI_RUNTIME_DEFAULT=ai_sdk
AI_TEXT_MODEL=anthropic/claude-sonnet-4.5
AI_IMAGE_MODEL_NANO_BANANA=google/gemini-3-pro-image
AI_IMAGE_MODEL_NANO_BANANA_FAST=google/gemini-2.5-flash-image
```

Production hardening:

```bash
NEXT_PUBLIC_DEV_AUTH_BYPASS_ENABLED=false
DEV_AUTH_BYPASS_ENABLED=false
DEV_TELEGRAM_SIM_ENABLED=false
DEV_TELEGRAM_SIM_AUTH_BYPASS=false
DEV_TELEGRAM_SIM_ALLOW_NON_LOCAL=false
APP_ENV_PROFILE=prod-telegram
```

## 3) Convex deployment env (Production)

Set these in Convex dashboard env vars:

```bash
TELEGRAM_NOTIFY_BOT_TOKEN=... # needed by convex/notifications.ts
CURATION_ADMIN_SECRET=...
CURATION_ADMIN_USER_IDS=278674008,telegram:278674008
KB_OWNER_USER_ID=278674008
```

Notes:
- `convex/notifications.ts` sends Telegram "Saved" notifications after ingest.
- Curation authorization in `convex/assets.ts` depends on Convex-side `CURATION_ADMIN_*` vars.

## 4) OpenClaw / laniameda-kb skill env

Required in the runtime where `laniameda-kb` script executes:

```bash
KB_OWNER_USER_ID=278674008
CONVEX_URL=https://<your-convex-deployment>.convex.cloud
```

Important:
- The canonical skill source lives in `skills/laniameda-kb/` inside this repo.
- Install that skill with `npx skills` so `skills check` / `skills update` can track GitHub-backed installs on VPS and other machines.
- The skill script now reads `CONVEX_URL` from env instead of hardcoding a deployment URL.

## 5) Telegram integration boundaries

- Web login widget domain allowlist is configured in BotFather via `/setdomain`.
- Ingestion is expected via OpenClaw skill -> Convex ingest action.
- This app does not expose a Telegram ingestion webhook route.
- Use separate bots/tokens:
  - Login bot: `TELEGRAM_LOGIN_BOT_TOKEN` + `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`
  - Notification bot: `TELEGRAM_NOTIFY_BOT_TOKEN` (Convex env)
- Legacy fallback during migration: `TELEGRAM_BOT_TOKEN` is still accepted by code for both paths, but should be phased out.

## 6) Smoke tests after env setup

1. Login test:
   - Open production URL.
   - Verify Telegram login succeeds (no `Bot domain invalid`).
2. Ingest test:
   - Send one prompt/image through OpenClaw.
   - Verify item appears in gallery.
   - Verify Telegram "✅ Saved" message arrives.
3. Curation test:
   - As admin, mark item public + featured.
   - Verify item appears in `Public` scope.
4. Security test:
   - Non-admin account cannot call curation route.
